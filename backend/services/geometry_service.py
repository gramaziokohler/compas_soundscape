# backend/services/geometry_service.py
# Geometry Processing Service

import os
import shutil
from fastapi import UploadFile, HTTPException
from compas.datastructures import Mesh
from compas.geometry import Sphere
from compas_ifc.model import Model
import rhino3dm

from utils.helpers import rotate_y_up_to_z_up
from config.constants import OBJ_ROTATE_Y_TO_Z


class GeometryService:
    """Service for processing 3D geometry files"""

    @staticmethod
    def create_sphere_geometry(position: list, radius: float = 0.2):
        """Create a sphere mesh at given position"""
        sphere = Sphere(radius=radius, point=position)
        mesh = Mesh.from_shape(sphere, u=16, v=16)

        vertices = list(mesh.vertices_attributes('xyz'))
        faces = [mesh.face_vertices(fkey) for fkey in mesh.faces()]

        return {"vertices": vertices, "faces": faces}

    @staticmethod
    def process_obj_file(file_path: str):
        """Process OBJ file and return geometry with face-to-entity mapping"""
        # Parse OBJ file to extract groups
        groups = []
        current_group = None
        vertices = []  # Global vertex list (1-indexed in OBJ)

        with open(file_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue

                parts = line.split()
                if not parts:
                    continue

                # Vertex definition
                if parts[0] == 'v':
                    x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                    vertices.append([x, y, z])

                # Object/Group definition
                elif parts[0] in ('o', 'g'):
                    # Save previous group if exists
                    if current_group and current_group['faces']:
                        groups.append(current_group)

                    # Start new group
                    name = ' '.join(parts[1:]) if len(parts) > 1 else f"Object_{len(groups)}"
                    current_group = {
                        'name': name,
                        'faces': [],
                        'index': len(groups)  # Group index for entity mapping
                    }

                # Face definition
                elif parts[0] == 'f':
                    # Initialize default group if no group was specified
                    if current_group is None:
                        current_group = {
                            'name': 'default',
                            'faces': [],
                            'index': 0
                        }

                    # Parse face (format: f v1 v2 v3 or f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3)
                    face_vertices = []
                    for vertex_str in parts[1:]:
                        # Get only the vertex index (ignore texture/normal)
                        vertex_idx = int(vertex_str.split('/')[0]) - 1  # OBJ is 1-indexed
                        face_vertices.append(vertex_idx)
                    current_group['faces'].append(face_vertices)

        # Add last group
        if current_group and current_group['faces']:
            groups.append(current_group)

        # If no groups were defined, create one default group
        if not groups:
            groups.append({
                'name': 'Mesh',
                'faces': [],
                'index': 0
            })

        # Build unified mesh with face_entity_map
        all_vertices = []
        all_faces = []
        face_entity_map = []  # Maps face index to group/entity index

        # Conditionally rotate vertices from Y-up to Z-up based on OBJ_ROTATE_Y_TO_Z constant
        if OBJ_ROTATE_Y_TO_Z:
            all_vertices = [rotate_y_up_to_z_up(v) for v in vertices]
        else:
            all_vertices = vertices

        # Add all faces with entity mapping
        for group in groups:
            for face in group['faces']:
                all_faces.append(face)
                face_entity_map.append(group['index'])  # Map this face to its group

        return {"vertices": all_vertices, "faces": all_faces, "face_entity_map": face_entity_map}

    @staticmethod
    def process_stl_file(file_path: str):
        """Process STL file and return geometry"""
        mesh = Mesh.from_stl(file_path)
        vertices = list(mesh.vertices_attributes('xyz'))
        vertices = [rotate_y_up_to_z_up(v) for v in vertices]
        faces = [mesh.face_vertices(fkey) for fkey in mesh.faces()]
        return {"vertices": vertices, "faces": faces}

    @staticmethod
    def process_ifc_file(file_path: str):
        """Process IFC file and return combined geometry with face-to-entity mapping"""
        try:
            model = Model(file_path, load_geometries=True)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load IFC file: {str(e)}")

        all_vertices = []
        all_faces = []
        face_entity_map = []  # Maps face index to entity index
        vertex_offset = 0

        entities = []
        if hasattr(model, 'building_elements'):
            entities = model.building_elements

        if not entities:
            for entity_type in ["IfcWall", "IfcSlab", "IfcColumn", "IfcBeam", "IfcDoor", "IfcWindow", "IfcRoof", "IfcStair"]:
                try:
                    type_entities = model.get_entities_by_type(entity_type)
                    entities.extend(type_entities)
                except:
                    pass

        for i, entity in enumerate(entities):
            try:
                if not hasattr(entity, 'geometry'):
                    continue

                geom = entity.geometry
                if geom is None:
                    continue

                mesh = None
                if isinstance(geom, Mesh):
                    mesh = geom
                elif hasattr(geom, 'to_mesh'):
                    mesh = geom.to_mesh()
                elif hasattr(geom, 'to_vertices_and_faces'):
                    vertices, faces = geom.to_vertices_and_faces()
                    mesh = Mesh.from_vertices_and_faces(vertices, faces)

                if mesh and mesh.number_of_vertices() > 0:
                    vertices = list(mesh.vertices_attributes('xyz'))
                    vertices = [rotate_y_up_to_z_up(v) for v in vertices]
                    all_vertices.extend(vertices)

                    for fkey in mesh.faces():
                        face_vertices = mesh.face_vertices(fkey)
                        adjusted_face = [v + vertex_offset for v in face_vertices]
                        all_faces.append(adjusted_face)
                        face_entity_map.append(i)  # Map this face to entity index i

                    vertex_offset += len(vertices)

                    if (i + 1) % 10 == 0:
                        print(f"Processed {i + 1}/{len(entities)} entities")

            except Exception as e:
                print(f"Skipping entity {i}: {e}")
                continue

        if len(all_vertices) == 0:
            raise HTTPException(status_code=400, detail="No geometry found in IFC file.")

        return {"vertices": all_vertices, "faces": all_faces, "face_entity_map": face_entity_map}

    @staticmethod
    def rhino_geom_to_mesh(geom):
        """Convert Rhino geometry to COMPAS mesh"""
        try:
            if isinstance(geom, rhino3dm.Mesh):
                vertices = [[v.X, v.Y, v.Z] for v in geom.Vertices]
                faces = []
                for i in range(geom.Faces.Count):
                    face = geom.Faces[i]
                    if len(face) == 4 and face[2] != face[3]:
                        faces.append([face[0], face[1], face[2], face[3]])
                    else:
                        faces.append([face[0], face[1], face[2]])
                if vertices:
                    return Mesh.from_vertices_and_faces(vertices, faces)

            elif isinstance(geom, rhino3dm.Brep):
                mp = rhino3dm.MeshingParameters.Default
                rhino_mesh = geom.GetMesh(rhino3dm.MeshType.Default, mp)
                if rhino_mesh:
                    vertices = [[v.X, v.Y, v.Z] for v in rhino_mesh.Vertices]
                    faces = []
                    for i in range(rhino_mesh.Faces.Count):
                        face = rhino_mesh.Faces[i]
                        if len(face) == 4 and face[2] != face[3]:
                            faces.append([face[0], face[1], face[2], face[3]])
                        else:
                            faces.append([face[0], face[1], face[2]])
                    if vertices:
                        return Mesh.from_vertices_and_faces(vertices, faces)

            elif isinstance(geom, rhino3dm.Extrusion):
                brep = geom.ToBrep(False)
                if brep:
                    mp = rhino3dm.MeshingParameters.Default
                    rhino_mesh = brep.GetMesh(rhino3dm.MeshType.Default, mp)
                    if rhino_mesh:
                        vertices = [[v.X, v.Y, v.Z] for v in rhino_mesh.Vertices]
                        faces = []
                        for i in range(rhino_mesh.Faces.Count):
                            face = rhino_mesh.Faces[i]
                            if len(face) == 4 and face[2] != face[3]:
                                faces.append([face[0], face[1], face[2], face[3]])
                            else:
                                faces.append([face[0], face[1], face[2]])
                        if vertices:
                            return Mesh.from_vertices_and_faces(vertices, faces)
        except:
            pass

        return None

    @staticmethod
    def process_3dm_file(file_path: str):
        """Process Rhino 3DM file and return geometry with face-to-entity mapping"""
        try:
            file3dm = rhino3dm.File3dm.Read(file_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load 3DM file: {str(e)}")

        all_vertices = []
        all_faces = []
        face_entity_map = []  # Maps face index to entity index
        vertex_offset = 0
        entity_index = 0  # Track actual entities (skip failed ones)

        for i, obj in enumerate(file3dm.Objects):
            try:
                geom = obj.Geometry
                if geom is None:
                    continue

                if isinstance(geom, rhino3dm.InstanceReference):
                    continue

                mesh = GeometryService.rhino_geom_to_mesh(geom)

                if mesh and mesh.number_of_vertices() > 0:
                    vertices = list(mesh.vertices_attributes('xyz'))
                    vertices = [rotate_y_up_to_z_up(v) for v in vertices]
                    all_vertices.extend(vertices)

                    for fkey in mesh.faces():
                        face_vertices = mesh.face_vertices(fkey)
                        adjusted_face = [v + vertex_offset for v in face_vertices]
                        all_faces.append(adjusted_face)
                        face_entity_map.append(entity_index)  # Map this face to current entity

                    vertex_offset += len(vertices)
                    entity_index += 1

                if (i + 1) % 20 == 0:
                    print(f"Processed {i + 1}/{len(file3dm.Objects)} objects")

            except Exception as e:
                if i % 20 == 0:
                    print(f"Skipping object {i}: {e}")
                continue

        if len(all_vertices) == 0:
            raise HTTPException(status_code=400, detail="No geometry found in 3DM file.")

        return {"vertices": all_vertices, "faces": all_faces, "face_entity_map": face_entity_map}

    @staticmethod
    def extract_entity_layers_from_3dm(file_path: str):
        """Extract entity-to-layer mapping from 3DM file"""
        try:
            file3dm = rhino3dm.File3dm.Read(file_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load 3DM file: {str(e)}")

        entities = []
        entity_index = 0

        for i, obj in enumerate(file3dm.Objects):
            try:
                geom = obj.Geometry
                if geom is None:
                    continue

                if isinstance(geom, rhino3dm.InstanceReference):
                    continue

                mesh = GeometryService.rhino_geom_to_mesh(geom)

                if mesh and mesh.number_of_vertices() > 0:
                    # Get layer information
                    layer_index = obj.Attributes.LayerIndex
                    layer = file3dm.Layers[layer_index] if layer_index < len(file3dm.Layers) else None
                    layer_name = layer.Name if layer else "Default"

                    entities.append({
                        "index": entity_index,
                        "layer": layer_name
                    })
                    entity_index += 1

            except Exception as e:
                continue

        return entities
