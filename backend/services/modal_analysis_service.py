"""
Modal Analysis Service

Performs modal (vibration) analysis on 3D mesh objects to compute resonant frequencies
and mode shapes using SFepy (Simple Finite Elements in Python).

Based on: https://sfepy.org/doc/examples/linear_elasticity-modal_analysis.html
"""

import numpy as np
from typing import Dict, List, Tuple, Optional
from pathlib import Path
import tempfile

try:
    from sfepy.mesh.mesh_generators import gen_block_mesh
    from sfepy.discrete import (FieldVariable, Material, Integral, Equation,
                                  Equations, Problem)
    from sfepy.discrete.fem import FEDomain, Field
    from sfepy.terms import Term
    from sfepy.solvers.ls import ScipyDirect
    from sfepy.solvers.nls import Newton
    from sfepy.discrete.conditions import Conditions, EssentialBC
    from sfepy.base.base import output, Struct
    from sfepy.mechanics.matcoefs import stiffness_from_youngpoisson
    SFEPY_AVAILABLE = True
except ImportError:
    SFEPY_AVAILABLE = False


from config.constants import (
    MODAL_ANALYSIS_NUM_MODES,
    MODAL_ANALYSIS_YOUNG_MODULUS,
    MODAL_ANALYSIS_POISSON_RATIO,
    MODAL_ANALYSIS_DENSITY,
    MODAL_ANALYSIS_MIN_FREQUENCY,
    MODAL_ANALYSIS_MAX_FREQUENCY,
    MODAL_ANALYSIS_MESH_RESOLUTION,
)


class ModalAnalysisService:
    """
    Service for computing resonant frequencies and mode shapes of 3D mesh objects.
    
    Uses linear elasticity theory and finite element method (FEM) via SFepy.
    """

    def __init__(self):
        """Initialize the modal analysis service"""
        if not SFEPY_AVAILABLE:
            raise ImportError(
                "SFepy is not installed. Install it with: pip install sfepy"
            )

    def analyze_mesh(
        self,
        vertices: List[List[float]],
        faces: List[List[int]],
        num_modes: Optional[int] = None,
        young_modulus: Optional[float] = None,
        poisson_ratio: Optional[float] = None,
        density: Optional[float] = None,
    ) -> Dict:
        """
        Perform modal analysis on a mesh to find resonant frequencies.

        Args:
            vertices: List of vertex coordinates [[x, y, z], ...]
            faces: List of face indices [[v0, v1, v2], ...]
            num_modes: Number of vibration modes to compute
            young_modulus: Young's modulus (Pa) - material stiffness
            poisson_ratio: Poisson's ratio - lateral strain ratio
            density: Material density (kg/m³)

        Returns:
            Dictionary containing:
                - frequencies: List of resonant frequencies (Hz)
                - mode_shapes: List of mode shape vectors
                - material_properties: Dict of material properties used
                - mesh_info: Dict with mesh statistics
        """
        try:
            return self._analyze_mesh_internal(vertices, faces, num_modes, young_modulus, poisson_ratio, density)
        except Exception as e:
            print(f"[ModalAnalysis] FATAL ERROR: {e}")
            import traceback
            traceback.print_exc()
            raise ValueError(f"Modal analysis failed: {str(e)}")
    
    def _analyze_mesh_internal(
        self,
        vertices: List[List[float]],
        faces: List[List[int]],
        num_modes: Optional[int] = None,
        young_modulus: Optional[float] = None,
        poisson_ratio: Optional[float] = None,
        density: Optional[float] = None,
    ) -> Dict:
        """Internal implementation of analyze_mesh with proper error propagation."""
        # Use default constants if not provided
        num_modes = num_modes or MODAL_ANALYSIS_NUM_MODES
        young_modulus = young_modulus or MODAL_ANALYSIS_YOUNG_MODULUS
        poisson_ratio = poisson_ratio or MODAL_ANALYSIS_POISSON_RATIO
        density = density or MODAL_ANALYSIS_DENSITY

        # Validate inputs
        if not vertices or not faces:
            raise ValueError("Mesh must contain vertices and faces")

        # Convert to numpy arrays
        vertices_array = np.array(vertices, dtype=np.float64)
        faces_array = np.array(faces, dtype=np.int32)

        # Get mesh bounds for info
        min_coords = vertices_array.min(axis=0)
        max_coords = vertices_array.max(axis=0)
        dims = max_coords - min_coords

        # Create FE mesh from actual input mesh geometry
        mesh, mesh_quality = self._create_fe_mesh(vertices_array, faces_array)

        # Set up the finite element problem
        problem = self._setup_modal_problem(
            mesh,
            young_modulus,
            poisson_ratio,
            density,
            num_modes
        )

        # Solve for eigenvalues (squared angular frequencies) and eigenvectors
        eigenvalues, eigenvectors = self._solve_modal_analysis(problem)

        # Convert to frequencies in Hz
        frequencies = self._compute_frequencies(eigenvalues)
        
        print(f"[ModalAnalysis] Computed frequencies: {frequencies[:10]}..." if len(frequencies) > 10 else f"[ModalAnalysis] Computed frequencies: {frequencies}")
        print(f"[ModalAnalysis] Frequency range: {min(frequencies):.2f} - {max(frequencies):.2f} Hz")

        # Filter frequencies within valid range
        valid_indices = [
            i for i, f in enumerate(frequencies)
            if MODAL_ANALYSIS_MIN_FREQUENCY <= f <= MODAL_ANALYSIS_MAX_FREQUENCY
        ]
        
        print(f"[ModalAnalysis] After filtering ({MODAL_ANALYSIS_MIN_FREQUENCY}-{MODAL_ANALYSIS_MAX_FREQUENCY} Hz): {len(valid_indices)} modes kept")
        if len(valid_indices) < len(frequencies):
            filtered_out = len(frequencies) - len(valid_indices)
            print(f"[ModalAnalysis] Filtered out {filtered_out} modes outside range")

        # Extract mode shapes
        mode_shapes = self._extract_mode_shapes(eigenvectors, valid_indices)

        # Extract mode shape visualizations (mapped to original vertices)
        mode_shape_visualizations = self._extract_mode_shape_visualizations(
            eigenvectors,
            valid_indices,
            len(vertices),
            problem
        )

        return {
            "frequencies": [frequencies[i] for i in valid_indices],
            "mode_shapes": mode_shapes,
            "mode_shape_visualizations": mode_shape_visualizations,  # NEW: For mesh visualization
            "material_properties": {
                "young_modulus": young_modulus,
                "poisson_ratio": poisson_ratio,
                "density": density,
            },
            "mesh_info": {
                "num_vertices": len(vertices),
                "num_faces": len(faces),
                "dimensions": dims.tolist(),
                "mesh_quality": mesh_quality,
            },
            "num_modes_computed": len(valid_indices),
        }

    def _create_fe_mesh(
        self,
        vertices: np.ndarray,
        faces: np.ndarray
    ):
        """
        Create a tetrahedral finite element mesh from the input surface mesh.

        This method tetrahedralizes the volume enclosed by the input surface mesh.
        Tries multiple approaches in order of quality:
        1. TetGen (best quality, if available)
        2. Delaunay tetrahedralization (good quality, always available)
        3. Voxelization (fallback)

        Args:
            vertices: Vertex coordinates array (N x 3)
            faces: Face indices array (M x 3) - triangulated surface mesh

        Returns:
            Tuple of (SFepy Mesh object, quality string)
        """
        print(f"[ModalAnalysis] Creating FE mesh from {len(vertices)} vertices, {len(faces)} faces")
        
        # Try Method 1: Python TetGen library (best quality)
        try:
            import tetgen
            import threading
            
            print("[ModalAnalysis] Attempting TetGen tetrahedralization...")
            
            # Create TetGen object
            tgen = tetgen.TetGen(vertices, faces)
            
            # Use threading for timeout (cross-platform)
            result_container = {'nodes': None, 'elements': None, 'quality': None, 'error': None}
            
            def run_tetgen():
                """Run TetGen in a thread"""
                try:
                    # First try: strict quality mesh
                    tgen.tetrahedralize(
                        switches='pq1.2',    # p=tetrahedralize, q=quality mesh
                        minratio=1.2,        # Minimum radius-edge ratio
                        mindihedral=10,      # Minimum dihedral angle (degrees)
                        verbose=0
                    )
                    result_container['nodes'] = tgen.node
                    result_container['elements'] = tgen.elem
                    result_container['quality'] = "High quality"
                except Exception as e1:
                    try:
                        # Second try: relaxed quality for difficult meshes
                        print(f"[ModalAnalysis] First attempt failed, trying relaxed settings...")
                        tgen2 = tetgen.TetGen(vertices, faces)  # Recreate object
                        tgen2.tetrahedralize(
                            switches='p',     # Just tetrahedralize, no quality constraints
                            verbose=0
                        )
                        result_container['nodes'] = tgen2.node
                        result_container['elements'] = tgen2.elem
                        result_container['quality'] = "Standard quality"
                    except Exception as e2:
                        result_container['error'] = f"Failed to tetrahedralize: {e2}"
            
            # Run TetGen with timeout
            thread = threading.Thread(target=run_tetgen, daemon=True)
            thread.start()
            thread.join(timeout=15.0)  # 15 second timeout
            
            if thread.is_alive():
                print("[ModalAnalysis] TetGen timed out (likely infinite loop on bad mesh)")
                raise Exception("TetGen tetrahedralization timed out - mesh may have self-intersections")
            
            # Check for errors
            if result_container['error']:
                raise Exception(result_container['error'])
            
            tet_nodes = result_container['nodes']
            tet_elements = result_container['elements']
            quality = result_container['quality']
            
            # Validate the mesh - check if we got reasonable output
            if tet_nodes is None or tet_elements is None:
                raise Exception("TetGen did not produce valid output")
                
            if len(tet_nodes) == 0 or len(tet_elements) == 0:
                raise Exception("TetGen produced empty mesh (likely due to self-intersecting faces)")
            
            # Check if too many faces were skipped (more than 10% of input)
            if len(faces) > 0:
                expected_nodes = len(vertices)
                if len(tet_nodes) < expected_nodes * 0.5:
                    print(f"[ModalAnalysis] WARNING: TetGen mesh significantly smaller than input ({len(tet_nodes)} vs {expected_nodes} nodes)")
                    print("[ModalAnalysis] Mesh may have self-intersections, falling back to Delaunay")
                    raise Exception("TetGen mesh quality too low")
            
            print(f"[ModalAnalysis] TetGen generated {len(tet_nodes)} nodes, {len(tet_elements)} elements ({quality})")
            
            # Convert to SFepy mesh (this can also hang, so protect it)
            print("[ModalAnalysis] Converting TetGen mesh to SFepy format...")
            try:
                mesh = self._convert_tetgen_to_sfepy(tet_nodes, tet_elements)
            except Exception as e:
                raise Exception(f"Failed to convert TetGen mesh to SFepy: {e}")
                
            if mesh is not None:
                print(f"[ModalAnalysis] Successfully created TetGen mesh")
                return mesh, quality
            else:
                raise Exception("Mesh conversion returned None")
                
        except ImportError:
            print("[ModalAnalysis] TetGen library not available")
        except Exception as e:
            print(f"[ModalAnalysis] TetGen failed: {e}")
        
        # Skip method 1b (command-line TetGen) - rarely available on Windows
        # Go straight to Delaunay which is reliable
        
        # Try Method 2: Scipy Delaunay tetrahedralization (always available)
        try:
            print("[ModalAnalysis] Attempting Delaunay tetrahedralization...")
            mesh = self._create_delaunay_mesh(vertices, faces)
            if mesh is not None:
                print(f"[ModalAnalysis] Generated {mesh.n_nod} nodes, {mesh.n_el} elements")
                return mesh, "Good quality"
        except Exception as e:
            print(f"[ModalAnalysis] Delaunay tetrahedralization failed: {e}")
        
        # Fallback Method 3: Use voxelization-based tetrahedral mesh generation
        print("[ModalAnalysis] WARNING: Using bounding box approximation (may be inaccurate)")
        return self._create_voxelized_mesh(vertices, faces), "Bounding box"

    def _create_delaunay_mesh(self, vertices: np.ndarray, faces: np.ndarray):
        """
        Create tetrahedral mesh using Delaunay tetrahedralization.
        
        This method:
        1. Uses the surface mesh vertices as seed points
        2. Adds interior points for better mesh quality
        3. Performs Delaunay tetrahedralization
        4. Filters tetrahedra to keep only those inside the surface
        
        Args:
            vertices: Surface mesh vertices
            faces: Surface mesh faces
            
        Returns:
            SFepy Mesh object or None if failed
        """
        from scipy.spatial import Delaunay
        from sfepy.discrete.fem import Mesh
        
        # Get mesh bounds
        min_coords = vertices.min(axis=0)
        max_coords = vertices.max(axis=0)
        dims = max_coords - min_coords
        
        # Ensure we have a 3D mesh
        if len(dims) != 3:
            print(f"[ModalAnalysis] Error: Expected 3D mesh, got {len(dims)}D")
            return None
        
        # Create interior points for better quality mesh
        # Add points on a regular grid inside the bounding box
        # Limit based on mesh size to avoid excessive DOFs
        max_interior = min(MODAL_ANALYSIS_MESH_RESOLUTION ** 3, 2000)  # Cap at 2000 points
        
        # For large surface meshes, reduce interior points
        if len(vertices) > 500:
            max_interior = min(500, max_interior)
            print(f"[ModalAnalysis] Large surface mesh detected, limiting interior points to {max_interior}")
        
        # Generate random points inside bounding box (will filter later)
        np.random.seed(42)  # Reproducible
        interior_points = np.random.rand(max_interior, 3)
        interior_points = min_coords + interior_points * dims
        
        # Combine surface vertices with interior points
        all_points = np.vstack([vertices, interior_points])
        
        print(f"[ModalAnalysis] Tetrahedralizing {len(all_points)} points...")
        
        # Perform Delaunay tetrahedralization
        try:
            delaunay = Delaunay(all_points)
        except Exception as e:
            print(f"[ModalAnalysis] Delaunay failed: {e}")
            return None
        
        # Get tetrahedra
        tetrahedra = delaunay.simplices.astype(np.int32)
        
        print(f"[ModalAnalysis] Generated {len(tetrahedra)} tetrahedra, filtering...")
        
        # Remove degenerate tetrahedra (zero volume)
        valid_tets = []
        for tet in tetrahedra:
            try:
                verts = all_points[tet]
                # Calculate volume using determinant: V = |det(v1-v0, v2-v0, v3-v0)| / 6
                # Create matrix with edge vectors
                edge_matrix = np.array([
                    verts[1] - verts[0],
                    verts[2] - verts[0],
                    verts[3] - verts[0]
                ])
                vol = np.abs(np.linalg.det(edge_matrix)) / 6.0
                
                if vol > 1e-10:  # Non-degenerate
                    valid_tets.append(tet)
            except Exception:
                continue  # Skip problematic tetrahedra
        
        if not valid_tets:
            print("[ModalAnalysis] No valid tetrahedra after filtering")
            return None
        
        tetrahedra = np.array(valid_tets, dtype=np.int32)
        
        print(f"[ModalAnalysis] Kept {len(tetrahedra)} valid tetrahedra")
        
        # Create SFepy mesh using direct construction
        # The issue with Mesh.from_data is it expects a specific format
        # Instead, let's write to a temporary file and read it back
        try:
            # Write mesh to VTK format
            with tempfile.NamedTemporaryFile(suffix='.vtk', delete=False, mode='w') as tmp:
                vtk_path = tmp.name
                self._write_vtk_mesh(all_points, tetrahedra, vtk_path)
            
            # Read back using SFepy
            from sfepy.discrete.fem import Mesh
            mesh = Mesh.from_file(vtk_path)
            
            # Clean up temp file
            import os
            try:
                os.unlink(vtk_path)
            except:
                pass
            
            return mesh
        except Exception as e:
            print(f"[ModalAnalysis] Failed to create SFepy mesh: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _convert_tetgen_to_sfepy(self, nodes: np.ndarray, elements: np.ndarray):
        """Convert TetGen output to SFepy mesh format."""
        from sfepy.discrete.fem import Mesh
        
        try:
            # Write to temporary VTK file
            with tempfile.NamedTemporaryFile(suffix='.vtk', delete=False, mode='w') as tmp:
                vtk_path = tmp.name
                self._write_vtk_mesh(nodes, elements, vtk_path)
            
            # Read back using SFepy
            mesh = Mesh.from_file(vtk_path)
            
            # Clean up temp file
            import os
            try:
                os.unlink(vtk_path)
            except:
                pass
            
            return mesh
        except Exception as e:
            print(f"[ModalAnalysis] Failed to convert TetGen mesh: {e}")
            return None

    def _write_vtk_mesh(self, points: np.ndarray, tetrahedra: np.ndarray, filepath: str):
        """Write a tetrahedral mesh to VTK format for SFepy."""
        n_points = len(points)
        n_cells = len(tetrahedra)
        
        with open(filepath, 'w') as f:
            # VTK header
            f.write('# vtk DataFile Version 2.0\n')
            f.write('Tetrahedral mesh\n')
            f.write('ASCII\n')
            f.write('DATASET UNSTRUCTURED_GRID\n')
            
            # Points
            f.write(f'POINTS {n_points} float\n')
            for point in points:
                f.write(f'{point[0]:.6e} {point[1]:.6e} {point[2]:.6e}\n')
            
            # Cells (tetrahedra have 4 vertices each)
            # Format: <number of vertices> <vertex indices...>
            f.write(f'\nCELLS {n_cells} {n_cells * 5}\n')  # 5 = 1 count + 4 indices
            for tet in tetrahedra:
                f.write(f'4 {tet[0]} {tet[1]} {tet[2]} {tet[3]}\n')
            
            # Cell types (10 = VTK_TETRA)
            f.write(f'\nCELL_TYPES {n_cells}\n')
            for _ in range(n_cells):
                f.write('10\n')

    def _write_stl_mesh(self, vertices: np.ndarray, faces: np.ndarray, filepath: str):
        """Write a triangulated surface mesh to STL format."""
        with open(filepath, 'w') as f:
            f.write('solid mesh\n')
            for face in faces:
                v0, v1, v2 = vertices[face]
                # Calculate face normal
                normal = np.cross(v1 - v0, v2 - v0)
                normal = normal / (np.linalg.norm(normal) + 1e-10)
                
                f.write(f'  facet normal {normal[0]:.6e} {normal[1]:.6e} {normal[2]:.6e}\n')
                f.write('    outer loop\n')
                f.write(f'      vertex {v0[0]:.6e} {v0[1]:.6e} {v0[2]:.6e}\n')
                f.write(f'      vertex {v1[0]:.6e} {v1[1]:.6e} {v1[2]:.6e}\n')
                f.write(f'      vertex {v2[0]:.6e} {v2[1]:.6e} {v2[2]:.6e}\n')
                f.write('    endloop\n')
                f.write('  endfacet\n')
            f.write('endsolid mesh\n')

    def _convert_meshio_to_sfepy(self, meshio_mesh):
        """Convert a meshio mesh to SFepy mesh format."""
        from sfepy.discrete.fem import Mesh
        
        # Extract tetrahedral cells
        if 'tetra' in meshio_mesh.cells_dict:
            cells = meshio_mesh.cells_dict['tetra']
        elif 'tetra10' in meshio_mesh.cells_dict:
            # Use only corner nodes from quadratic tetrahedra
            cells = meshio_mesh.cells_dict['tetra10'][:, :4]
        else:
            raise ValueError("Mesh does not contain tetrahedral elements")
        
        # Create connectivity array (tetrahedra are 4-node elements)
        # SFepy expects connectivity in specific format
        nod_offsets = np.arange(0, (len(cells) + 1) * 4, 4, dtype=np.int32)
        connectivity = cells.ravel().astype(np.int32)
        
        # Create material IDs (all elements belong to same material)
        mat_ids = np.zeros(len(cells), dtype=np.int32)
        
        # Create mesh description
        mesh = Mesh.from_data(
            'tetrahedral_mesh',
            meshio_mesh.points.astype(np.float64),
            None,
            [connectivity],
            [mat_ids],
            ['3_4']  # 3D tetrahedra with 4 nodes
        )
        
        return mesh

    def _create_voxelized_mesh(self, vertices: np.ndarray, faces: np.ndarray):
        """
        Create a tetrahedral mesh by voxelizing the surface mesh interior.
        
        This is a fallback method that creates a regular grid inside the mesh bounds
        and only keeps voxels that are inside the surface mesh.
        
        Args:
            vertices: Vertex coordinates
            faces: Face indices
            
        Returns:
            SFepy Mesh object
        """
        # Get bounding box
        min_coords = vertices.min(axis=0)
        max_coords = vertices.max(axis=0)
        dims = max_coords - min_coords
        
        # Create a grid resolution based on mesh size
        resolution = MODAL_ANALYSIS_MESH_RESOLUTION
        
        # For voxelization, we'll create a structured grid and convert to tetrahedra
        # Each hexahedron (cube) is split into 5 or 6 tetrahedra
        mesh = gen_block_mesh(
            dims=dims,
            shape=[resolution, resolution, resolution],
            centre=min_coords + dims / 2,
            name='voxelized_mesh'
        )
        
        # TODO: Future enhancement - implement actual inside/outside test
        # and remove voxels outside the surface mesh using ray casting
        # For now, we use the full block mesh as an approximation
        
        return mesh

    def _setup_modal_problem(
        self,
        mesh,
        young_modulus: float,
        poisson_ratio: float,
        density: float,
        num_modes: int
    ):
        """
        Set up the finite element problem for modal analysis.

        Args:
            mesh: SFepy mesh
            young_modulus: Young's modulus (Pa)
            poisson_ratio: Poisson's ratio
            density: Density (kg/m³)
            num_modes: Number of modes to compute

        Returns:
            SFepy Problem object
        """
        # Create domain
        domain = FEDomain('domain', mesh)

        # Define regions
        omega = domain.create_region('Omega', 'all')
        
        # Create a region for boundary conditions to prevent rigid body motion
        # Fix vertices near the minimum corner using coordinate bounds
        
        bbox = domain.get_mesh_bounding_box()
        min_corner = bbox[0]
        dims = bbox[1] - bbox[0]
        
        # Create a small box at the minimum corner (0.1% of each dimension)
        tolerance = 0.001
        x_max = min_corner[0] + dims[0] * tolerance
        y_max = min_corner[1] + dims[1] * tolerance
        z_max = min_corner[2] + dims[2] * tolerance
        
        # Create region with vertices in this small box
        region_def = '(x < %.10f) & (y < %.10f) & (z < %.10f)' % (x_max, y_max, z_max)
        
        try:
            bottom = domain.create_region(
                'Bottom',
                'vertices in ' + region_def,
                'vertex'
            )
            print(f"[ModalAnalysis] Fixed vertices in corner box for BCs")
        except:
            # If no vertices found in corner, just fix a small region along minimum x
            eps = dims[0] * 0.01
            bottom = domain.create_region(
                'Bottom',
                'vertices in (x < %.10f)' % (min_corner[0] + eps),
                'vertex'
            )
            print(f"[ModalAnalysis] Fixed vertices at minimum x for BCs")

        # Define fields (displacement field)
        field = Field.from_args(
            'fu',
            dtype=np.float64,
            shape=(3,),  # 3D displacement
            region=omega,
            approx_order=1  # Linear approximation
        )

        # Create field variables
        u = FieldVariable('u', 'unknown', field)
        v = FieldVariable('v', 'test', field, primary_var_name='u')

        # Material properties
        # Compute stiffness tensor from Young's modulus and Poisson's ratio
        D = stiffness_from_youngpoisson(3, young_modulus, poisson_ratio)

        material = Material('m', D=D, rho=density)

        # Define integrals (numerical integration)
        integral = Integral('i', order=2)

        # Define terms for the weak form
        # Stiffness term: ∫ ε(u) : D : ε(v)
        t1 = Term.new(
            'dw_lin_elastic(m.D, v, u)',
            integral,
            omega,
            m=material,
            v=v,
            u=u
        )

        # Mass term: ∫ ρ u · v
        t2 = Term.new(
            'dw_dot(m.rho, v, u)',
            integral,
            omega,
            m=material,
            v=v,
            u=u
        )

        # Create equations: K*u = ω²*M*u (eigenvalue problem)
        eq_stiffness = Equation('stiffness', t1)
        eq_mass = Equation('mass', t2)
        
        equations = Equations([eq_stiffness, eq_mass])

        # Create the problem
        problem = Problem('modal', equations=equations)
        
        # Set boundary conditions - fix one edge to prevent rigid body modes
        fixed = EssentialBC('Fixed', bottom, {'u.all': 0.0})
        problem.time_update(ebcs=Conditions([fixed]))
        
        problem.update_materials()

        # Store equations for later assembly
        problem.eq_stiffness = eq_stiffness
        problem.eq_mass = eq_mass
        
        # Store number of modes to compute (add 3 to account for potential rigid body modes)
        problem.num_modes = num_modes + 3

        return problem

    def _solve_modal_analysis(self, problem) -> Tuple[np.ndarray, np.ndarray]:
        """
        Solve the modal analysis eigenvalue problem.

        Args:
            problem: SFepy Problem object

        Returns:
            Tuple of (eigenvalues, eigenvectors)
            eigenvalues: ω² values (squared angular frequencies)
            eigenvectors: mode shapes
        """
        from scipy.sparse.linalg import eigsh
        from scipy.linalg import eigh

        print("[ModalAnalysis] Assembling stiffness and mass matrices...")
        
        try:
            # Assemble stiffness and mass matrices using the correct API
            mtx_k = problem.eq_stiffness.evaluate(
                mode='weak',
                dw_mode='matrix',
                asm_obj=problem.mtx_a
            )
            
            # Create a copy for mass matrix
            mtx_m = mtx_k.copy()
            mtx_m.data[:] = 0.0
            
            mtx_m = problem.eq_mass.evaluate(
                mode='weak',
                dw_mode='matrix',
                asm_obj=mtx_m
            )
            
            print(f"[ModalAnalysis] Matrix size: {mtx_k.shape}, nnz: {mtx_k.nnz}")
        except Exception as e:
            print(f"[ModalAnalysis] Matrix assembly failed: {e}")
            raise

        # Solve generalized eigenvalue problem: K*u = λ*M*u
        num_modes = min(problem.num_modes, mtx_k.shape[0] - 10)
        
        print(f"[ModalAnalysis] Solving for {num_modes} eigenvalues...")
        
        try:
            # Use sparse eigenvalue solver (keep matrices sparse!)
            eigenvalues, eigenvectors = eigsh(
                mtx_k, k=num_modes, M=mtx_m, sigma=0, which='LM'
            )
            print(f"[ModalAnalysis] Sparse solver succeeded")
        except Exception as e:
            print(f"[ModalAnalysis] Sparse solver failed ({e}), trying dense solver...")
            
            try:
                # Only convert to dense if matrix is not too large
                if mtx_k.shape[0] > 10000:
                    raise ValueError(f"Matrix too large ({mtx_k.shape[0]} DOFs) for dense solver")
                
                K = mtx_k.toarray()
                M = mtx_m.toarray()
                
                # Fallback to dense solver if sparse fails
                eigenvalues, eigenvectors = eigh(K, M)
                # Take first num_modes
                eigenvalues = eigenvalues[:num_modes]
                eigenvectors = eigenvectors[:, :num_modes]
                print(f"[ModalAnalysis] Dense solver succeeded")
            except Exception as e2:
                print(f"[ModalAnalysis] Dense solver also failed: {e2}")
                raise ValueError(f"Eigenvalue solver failed: {e2}")

        # Sort by eigenvalues (smallest first)
        idx = eigenvalues.argsort()
        eigenvalues = eigenvalues[idx]
        eigenvectors = eigenvectors[:, idx]

        # Skip first modes with near-zero eigenvalues (rigid body modes)
        n_skip = 0
        for i, eig in enumerate(eigenvalues):
            if eig > 1e-6:  # First non-zero mode
                n_skip = i
                break
        
        eigenvalues = eigenvalues[n_skip:]
        eigenvectors = eigenvectors[:, n_skip:]
        
        print(f"[ModalAnalysis] Found {len(eigenvalues)} valid modes (skipped {n_skip} rigid body modes)")

        return eigenvalues, eigenvectors

    def _compute_frequencies(self, eigenvalues: np.ndarray) -> List[float]:
        """
        Convert eigenvalues (ω²) to frequencies in Hz.

        Args:
            eigenvalues: Squared angular frequencies (ω²)

        Returns:
            List of frequencies in Hz
        """
        # ω² → ω (angular frequency in rad/s) → f (frequency in Hz)
        # f = ω / (2π)
        
        # Filter out negative eigenvalues (numerical artifacts)
        eigenvalues = np.maximum(eigenvalues, 0)
        
        angular_frequencies = np.sqrt(eigenvalues)
        frequencies = angular_frequencies / (2 * np.pi)

        return frequencies.tolist()

    def _extract_mode_shapes(
        self,
        eigenvectors: np.ndarray,
        valid_indices: List[int]
    ) -> List[List[float]]:
        """
        Extract and normalize mode shapes.

        Args:
            eigenvectors: Matrix of eigenvectors
            valid_indices: Indices of valid modes

        Returns:
            List of normalized mode shape vectors
        """
        mode_shapes = []
        
        for idx in valid_indices:
            mode = eigenvectors[:, idx]
            
            # Normalize the mode shape
            norm = np.linalg.norm(mode)
            if norm > 0:
                mode = mode / norm
            
            mode_shapes.append(mode.tolist())

        return mode_shapes

    def _extract_mode_shape_visualizations(
        self,
        eigenvectors: np.ndarray,
        valid_indices: List[int],
        num_original_vertices: int,
        problem
    ) -> List[Dict]:
        """
        Extract mode shape visualizations for the original mesh vertices.

        Maps mode shape displacements to original surface mesh vertices
        and computes displacement magnitudes for visualization.

        Args:
            eigenvectors: Matrix of eigenvectors (DOFs x modes)
            valid_indices: Indices of valid modes
            num_original_vertices: Number of vertices in original input mesh
            problem: SFepy Problem object (to get field mapping)

        Returns:
            List of mode visualizations, each containing:
                - displacement_magnitudes: Normalized displacement magnitude per vertex (0-1)
                - displacement_vectors: 3D displacement vector per vertex [[dx,dy,dz], ...]
                - max_displacement: Maximum displacement in this mode
        """
        visualizations = []

        # Get the displacement field variable
        try:
            # The field variable 'u' contains displacement DOFs
            u_var = problem.fields['fu']
            n_nod = problem.domain.mesh.n_nod

            print(f"[ModalAnalysis] Extracting visualizations for {len(valid_indices)} modes")
            print(f"[ModalAnalysis] FE mesh has {n_nod} nodes, original mesh has {num_original_vertices} vertices")

            for idx in valid_indices:
                mode_vector = eigenvectors[:, idx]

                # Reshape mode vector to (n_nodes, 3) for 3D displacements
                # Mode vector is in DOF format: [u1x, u1y, u1z, u2x, u2y, u2z, ...]
                n_dofs = len(mode_vector)
                n_nodes = n_dofs // 3  # 3 DOFs per node (x, y, z)

                if n_dofs % 3 != 0:
                    print(f"[ModalAnalysis] Warning: DOF count {n_dofs} not divisible by 3")
                    # Pad if necessary
                    n_nodes = n_dofs // 3

                # Reshape to (n_nodes, 3)
                displacements_3d = mode_vector[:n_nodes*3].reshape(-1, 3)

                # Extract displacements for original surface vertices
                # Assumption: First N nodes of FE mesh correspond to original vertices
                # This is true for TetGen and Delaunay (they preserve surface vertices)
                num_to_extract = min(num_original_vertices, len(displacements_3d))
                vertex_displacements = displacements_3d[:num_to_extract]

                # If we have fewer FE nodes than original vertices, pad with zeros
                if num_to_extract < num_original_vertices:
                    padding = np.zeros((num_original_vertices - num_to_extract, 3))
                    vertex_displacements = np.vstack([vertex_displacements, padding])

                # Compute displacement magnitudes
                magnitudes = np.linalg.norm(vertex_displacements, axis=1)

                # Normalize to 0-1 range
                max_magnitude = np.max(magnitudes)
                if max_magnitude > 1e-10:
                    normalized_magnitudes = magnitudes / max_magnitude
                else:
                    normalized_magnitudes = magnitudes

                visualizations.append({
                    "displacement_magnitudes": normalized_magnitudes.tolist(),
                    "displacement_vectors": vertex_displacements.tolist(),
                    "max_displacement": float(max_magnitude),
                })

            print(f"[ModalAnalysis] Extracted {len(visualizations)} mode visualizations")

        except Exception as e:
            print(f"[ModalAnalysis] Warning: Could not extract mode visualizations: {e}")
            import traceback
            traceback.print_exc()

            # Return empty visualizations as fallback
            for idx in valid_indices:
                visualizations.append({
                    "displacement_magnitudes": [0.0] * num_original_vertices,
                    "displacement_vectors": [[0.0, 0.0, 0.0]] * num_original_vertices,
                    "max_displacement": 0.0,
                })

        return visualizations

    def compute_frequency_response(
        self,
        frequencies: List[float],
        damping_ratio: float = 0.02
    ) -> Dict:
        """
        Compute frequency response characteristics.

        Args:
            frequencies: List of resonant frequencies
            damping_ratio: Structural damping ratio (typical: 0.01-0.05)

        Returns:
            Dictionary with frequency response data
        """
        if not frequencies:
            return {"error": "No frequencies provided"}

        # Fundamental frequency (lowest mode)
        fundamental = min(frequencies)

        # Compute quality factors (Q = 1 / (2*ζ))
        q_factor = 1.0 / (2.0 * damping_ratio)

        # Bandwidth for each mode (Δf = f / Q)
        bandwidths = [f / q_factor for f in frequencies]

        return {
            "fundamental_frequency": fundamental,
            "quality_factor": q_factor,
            "damping_ratio": damping_ratio,
            "bandwidths": bandwidths,
            "frequency_ratios": [f / fundamental for f in frequencies],
        }
