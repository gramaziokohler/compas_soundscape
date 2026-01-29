from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
import pyroomacoustics as pra
import math

# --- REPLACE STL WITH TRIMESH ---
try:
    import trimesh
except ImportError as err:
    print(
        "The trimesh package is required for .obj files. "
        "Install it with `pip install trimesh`"
    )
    raise err

# Update this path to your .obj file
obj_path = Path("G:/My Drive/03_ETH Acoustic/02_Work/00_Case studies/HIL D24-1/HIL_D24-1_acoustic_mesh_tri.obj")

# --- 2. CUSTOM OBJ PARSER (Preserves Quads) ---
def load_obj_as_quads(path):
    """
    Parses an OBJ file and returns a list of faces.
    Each face is a numpy array of shape (3, 4) -> (coords, points).
    """
    vertices = []
    faces = []
    
    with open(path, 'r') as f:
        for line in f:
            if line.startswith('v '):
                # Parse vertex: v x y z
                parts = line.strip().split()
                vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])
            
            elif line.startswith('f '):
                # Parse face: f v1/vt1/vn1 v2...
                parts = line.strip().split()
                face_indices = []
                for part in parts[1:]:
                    # Handle formats: v, v/vt, v//vn
                    idx_str = part.split('/')[0]
                    # OBJ is 1-indexed, Python is 0-indexed
                    face_indices.append(int(idx_str) - 1)
                
                # Retrieve coordinates for this face
                # Transpose to (3, N) for PyRoomAcoustics
                face_coords = np.array([vertices[i] for i in face_indices]).T 
                faces.append(face_coords)
                
    return faces

# Load the data
quad_faces = load_obj_as_quads(obj_path)
print(f"Loaded {len(quad_faces)} quad faces.")

# --- EXISTING LOGIC FOR GRID GENERATION ---

# z_values = np.array([face[2, :] for face in quad_faces])  # Extract Z-coordinates
# mean_z = np.mean(z_values, axis=1)  # Mean Z for each triangle face
# sorted_indices = np.argsort(mean_z)

# # Select the lowest faces to determine the floor plane
# lowest_indices = sorted_indices[0]
# faces = quad_faces[lowest_indices]
# print(f"Using face : {faces}")


# 1. Extract Z-coordinates and calculate the mean Z for each face
z_values = np.array([face[:, 2] for face in quad_faces]) 
mean_z = np.mean(z_values, axis=1)

# 2. Create a boolean mask where mean_z is less than 0.2
mask = mean_z < 0.2

# 3. Convert quad_faces to a numpy array to allow masking
quad_faces_array = np.array(quad_faces)

# 4. Now the masking will work perfectly
faces = quad_faces_array[mask]

# Optional: If you specifically need the indices of these faces

print(f"Found {len(faces)} faces with Z < 0.2")


# test_material_abs = {
#     "description": "Example floor material",
#     "coeffs": [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
#     "center_freqs": [125, 250, 500, 1000, 2000, 4000, 8000],
# }

# # scattering parameters
# test_material_scat = {
#     "description": "Theatre Audience",
#     "coeffs": [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
#     "center_freqs": [125, 250, 500, 1000, 2000, 4000, 8000],
# }

# # create a list of materials
# test_material = pra.make_materials((test_material_abs, test_material_scat))


materials = pra.make_materials(
    ceiling=(0.1, 0.05),
    floor=(0.1, 0.05),
    east=(0.1, 0.05),
    west=(0.1, 0.05),
    north=(0.1, 0.05),
    south=(0.1, 0.05),
)



def create_grid(faces, spacing, z_height=0.0, margin=0.0):
    """
    Creates a grid of points aligned with the mean plane of the input mesh faces,
    aligned with the world axes (bounding box) rather than PCA variance.
    
    Returns:
    - mic_array: (3, N) numpy array where each column is a coordinate [x, y, z]^T.
    """
    # 1. Flatten vertices to a point cloud
    points = np.asarray(faces).reshape(-1, 3)
    
    # 2. Compute Mean Plane via SVD (Keep Normal Calculation)
    centroid = np.mean(points, axis=0)
    centered_points = points - centroid
    
    # SVD to get the Normal Vector
    cov_matrix = np.dot(centered_points.T, centered_points)
    _, _, Vt = np.linalg.svd(cov_matrix)
    
    # We only keep the Normal from SVD
    normal = Vt[2] 
    
    # 3. Determine Grid Axes (Simplify: Align with World/Bounding Box)
    # Check if the plane is roughly horizontal (floor/ceiling)
    if np.abs(normal[2]) > 0.99:
        # Plane is Floor/Ceiling: Align with World X
        u_axis = np.array([1.0, 0.0, 0.0])
    else:
        # Plane is a Wall/Slope: Align U with "Horizontal" relative to World Z
        world_up = np.array([0.0, 0.0, 1.0])
        u_axis = np.cross(world_up, normal)
        u_axis = u_axis / np.linalg.norm(u_axis) # Normalize
        
    # V axis is simply perpendicular to Normal and U
    v_axis = np.cross(normal, u_axis)
    
    # 4. Project mesh points to this new stable 2D local plane
    u_coords = np.dot(centered_points, u_axis)
    v_coords = np.dot(centered_points, v_axis)
    
    # 5. Define Bounds (The Bounding Box edges)
    u_min, u_max = np.min(u_coords) - margin, np.max(u_coords) + margin
    v_min, v_max = np.min(v_coords) - margin, np.max(v_coords) + margin
    
    # 6. Generate Grid
    u_grid_vals = np.arange(u_min, u_max + spacing / 1000.0, spacing)
    v_grid_vals = np.arange(v_min, v_max + spacing / 1000.0, spacing)
    
    U_grid, V_grid = np.meshgrid(u_grid_vals, v_grid_vals, indexing='ij')
    
    u_flat = U_grid.flatten()
    v_flat = V_grid.flatten()
    
    # 7. Reconstruct 3D points
    u_vecs = u_flat[:, np.newaxis] * u_axis[np.newaxis, :]
    v_vecs = v_flat[:, np.newaxis] * v_axis[np.newaxis, :]
    z_vec = z_height * normal[np.newaxis, :]
    
    # Points as (N, 3) initially
    points_rows = centroid + u_vecs + v_vecs + z_vec
    
    # 8. Transpose to match (3, N) requirement
    mic_array = points_rows.T
    
    return mic_array

def plot_rt60_2d(source_pos, receivers_pos, values, title="RT60 Distribution"):
    """
    Plots a 2D gradient map (heatmap) of RT60 values.
    """
    fig, ax = plt.subplots(figsize=(10, 8))
    
    # 1. Extract X and Y coordinates (ignoring Z height for the 2D map)
    x = receivers_pos[0, :]
    y = receivers_pos[1, :]
    
    # 2. Flatten values to match coordinate shape
    z = np.array(values).flatten()

    # 3. Create the Filled Contour Plot (Gradient)
    if len(x) > 3: # Need at least 3 points for tricontourf
        contour = ax.tricontourf(x, y, z, levels=100, cmap='viridis')
        cbar = fig.colorbar(contour, ax=ax)
        cbar.set_label(title, rotation=270, labelpad=15)
    else:
        print("Not enough points to plot contour.")

    ax.scatter(source_pos[0], source_pos[1], c='red', s=30, alpha=0.9, label='Source Position')
    ax.scatter(x, y, c='white', s=20, alpha=0.9, label='Receiver Positions')

    # 5. Styling
    ax.set_xlabel('Room X [m]')
    ax.set_ylabel('Room Y [m]')
    
    # Ensure the room proportions are correct
    ax.set_aspect('equal')
    
    plt.show()

####################################

# Create microphone grid
points = create_grid(faces, spacing=4, z_height=1.2, margin=-0.5)

size_reduc_factor = 1.0  
freq_s = 16000

# Create Room Walls from vectors
walls = []
for w in quad_faces:
    walls.append(
        pra.wall_factory(
            w,
            [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],            
            [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05] 
        )
    )

room = pra.Room(
            walls,
            fs=freq_s,
            max_order=3,
            ray_tracing=False,
            air_absorption=True,
            use_rand_ism = False,
            max_rand_disp = 0.05
        )



# room_dim = [13.72, 9.72, 4.14]
# room = (
#     pra.ShoeBox(
#         room_dim,
#         materials= materials,
#         fs=16000,
#         max_order=3,
#         ray_tracing=True,
#         air_absorption=True,
#     )
# )

data_x = """
 -1.24849286 -1.24849286 -1.24849286 -1.24849286 -1.24849286 -1.24849286
 10.75150714 10.75150714 10.75150714 10.75150714 10.75150714
"""

data_y = """
  0.6436661   1.63542414  2.62718219  3.61894023  4.61069827  5.60245631
  6.59421435  7.58597239  8.57773044  9.56948848 10.56124652
"""

data_z = """
  0.87797655  0.84426582  0.8105551   0.77684437  0.74313365  0.70942292
  0.6757122   0.64200147  0.60829074  0.57458002  0.54086929
"""

# 2. Parse the strings into Numpy arrays
# sep=' ' tells numpy to split the string by whitespace
x = np.fromstring(data_x, sep=' ')
y = np.fromstring(data_y, sep=' ')
z = np.fromstring(data_z, sep=' ')

# 3. Stack them into a single 3-row matrix (like your original list)
# points = np.vstack([x, y, z])

# Filter points that are outside the room
mask = [room.is_inside(p) for p in points.T]
filtered_points = points[:, mask]

print(f"Generated {points.shape[1]} points, {filtered_points.shape[1]} are inside the room.")
print(points)

# if filtered_points.shape[1] == 0:
#     print("Error: No microphones are inside the room geometry. Check normals/mesh integrity.")
#     exit()

room.plot(img_order=0)
# plt.show()

source_pos = [2.0, 5.0, 1.0]
room.add_source(source_pos)

mic_array = pra.MicrophoneArray(filtered_points, fs=freq_s)
room.add_microphone_array(mic_array)

print("Starting Ray Tracing...")
room.set_ray_tracing(n_rays=8000)
room.image_source_model()
room.ray_tracing()
print("Computing RIR...")
room.compute_rir()

rt60 = np.zeros((len(room.rir), len(room.rir[0])))
db_levels = np.zeros((len(room.rir), len(room.rir[0])))

for i in range(len(room.rir)):
    for j in range(len(room.rir[i])):
        if len(room.rir[i][j]) == 0:
            continue
            
        rt60[i][j] = pra.experimental.rt60.measure_rt60(room.rir[i][j], fs=freq_s)
        if rt60[i][j] < 1.60:
            plt.plot(room.rir[i][j])
        
        # Calculate RMS Amplitude and dB
        rms_amplitude = np.sqrt(np.mean(room.rir[i][j]**2))
        if rms_amplitude > 0:
            db_level = 20 * np.log10(rms_amplitude)
        else:
            db_level = -100 # Silence floor
            
        db_levels[i][j] = db_level
        
        # print(f"Mic {j}: RMS {rms_amplitude:.5f}, Level {db_level:.2f} dB, RT60 {rt60[i][j]:.2f}s")

plt.figure()
# room.plot(img_order=0)
# room.plot_rir()
# plt.show()
plot_rt60_2d(source_pos, filtered_points, rt60, title="RT60 (s)")

