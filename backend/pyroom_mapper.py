from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from mpl_toolkits import mplot3d

import pyroomacoustics as pra
import math

try:
    from stl import mesh
except ImportError as err:
    print(
        "The numpy-stl package is required for this example. "
        "Install it with `pip install numpy-stl`"
    )
    raise err



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
    # If normal is parallel to World Z (0,0,1), cross product fails/is unstable.
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
    # Adding spacing/1000 ensures inclusion of the upper bound if it aligns perfectly
    u_grid_vals = np.arange(u_min, u_max + spacing / 1000.0, spacing)
    v_grid_vals = np.arange(v_min, v_max + spacing / 1000.0, spacing)
    
    U_grid, V_grid = np.meshgrid(u_grid_vals, v_grid_vals, indexing='ij')
    
    u_flat = U_grid.flatten()
    v_flat = V_grid.flatten()
    
    # 7. Reconstruct 3D points
    # Reshape for broadcasting: (N, 1) * (1, 3) -> (N, 3)
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
    
    Args:
        receivers_pos (np.array): Shape (3, N) - The microphone coordinates.
        values (np.array): Shape (S, N) or (N,) - The RT60 values.
        title (str): Plot title.
    """
    fig, ax = plt.subplots(figsize=(10, 8))
    
    # 1. Extract X and Y coordinates (ignoring Z height for the 2D map)
    x = receivers_pos[0, :]
    y = receivers_pos[1, :]
    
    # 2. Flatten values to match coordinate shape
    z = np.array(values).flatten()

    # 3. Create the Filled Contour Plot (Gradient)
    # levels=100 ensures a very smooth gradient transition
    contour = ax.tricontourf(x, y, z, levels=100, cmap='viridis')
    ax.scatter(source_pos[0], source_pos[1], c='red', s=30, alpha=0.9, label='Source Position')
    #ax.legend()
    ax.scatter(x, y, c='white', s=20, alpha=0.9, label='Receiver Positions')

    # 4. Add Colorbar
    cbar = fig.colorbar(contour, ax=ax)
    cbar.set_label(title, rotation=270, labelpad=15)

    # 5. Styling
    # ax.set_title(title)
    ax.set_xlabel('Room X [m]')
    ax.set_ylabel('Room Y [m]')
    
    # Ensure the room proportions are correct (1 meter is visually equal on X and Y)
    ax.set_aspect('equal')
    
    plt.show()
####################################



# stl_path = Path("G:/My Drive/03_ETH Acoustic/02_Work/Focalization benchmark/Elipsoid_410_207_small.stl")
stl_path = Path("G:/My Drive/03_ETH Acoustic/02_Work/Focalization benchmark/Elipsoid_split.stl")

the_mesh = mesh.Mesh.from_file(stl_path)
ntriang, nvec, npts = the_mesh.vectors.shape


# Select listenning area
# z_values = the_mesh.vectors[:,:,2]  # Extract Z-coordinates
# mean_z = np.mean(z_values, axis=1)  # Mean Z for each triangle face
# mask = mean_z < 0.2
# faces = the_mesh.vectors[mask]
print(f"Found {len(the_mesh.vectors)} faces ")

# create grid of points for microphone placement
# points = create_grid(faces, spacing=1.5, z_height=1.5, margin=-0.5)
# print(points)


material = pra.Material(energy_absorption="rough_concrete")
# material = pra.Material(energy_absorption="mineral_wool_50mm_70kgm3") # alpha~0.65
freq_s = 16000

# center = [5,5,2]
# square = pra.beamforming.square_2D_array(center, M=5, N=5, phi=90, d=1)
walls = []
for w in range(ntriang):
    walls.append(
        pra.wall_factory(
            the_mesh.vectors[w].T,
            # material.energy_absorption["coeffs"],
            [0.001]*7,            
            # material.scattering["coeffs"],
            [0.001]*7, 
        )
    )

room = pra.Room(
            walls,
            fs=freq_s,
            max_order=2,
            ray_tracing=False,
            air_absorption=False,
            use_rand_ism = False,
            max_rand_disp = 0
        )

# mask = [room.is_inside(p) for p in points.T]
# filtered_points = points[:, mask]
# print(f"Generated {points.shape[1]} points, {filtered_points.shape[1]} are inside the room.")


filtered_points = [
    # X coordinates
    [0, 0, 0, 0, 0, 0, 0, 0, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -1, -1, -1, -1, -1, -1, -1, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -2, -2, -2, -2, -2, -2, -2, -2.5, -2.5, -2.5, -2.5, -2.5, -2.5, -2.5, -3, -3, -3, -3, -3, -3.5, -3.5, -3.5, -3.5, -4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1, 1, 1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 2, 2, 2, 2, 2, 2, 2, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 3, 3, 3, 3, 3, 3.5, 3.5, 3.5, 3.5, 4],
    
    # Y coordinates
    [0, 0.5, 1, 1.5, 2, -0.5, -1, -1.5, -1.5, -1, -0.5, 2, 1.5, 1, 0.5, 0, 0, 0.5, 1, 1.5, -0.5, -1, -1.5, -1.5, -1, -0.5, 1.5, 1, 0.5, 0, 0, 0.5, 1, 1.5, -0.5, -1, -1.5, -1.5, -1, -0.5, 1.5, 1, 0.5, 0, 0, 0.5, 1, -0.5, -1, -0.5, 1, 0.5, 0, 0, -1.5, -1, -0.5, 2, 1.5, 1, 0.5, 0, 0, 0.5, 1, 1.5, -0.5, -1, -1.5, -1.5, -1, -0.5, 1.5, 1, 0.5, 0, 0, 0.5, 1, 1.5, -0.5, -1, -1.5, -1.5, -1, -0.5, 1.5, 1, 0.5, 0, 0, 0.5, 1, -0.5, -1, -0.5, 1, 0.5, 0, 0],
    
    # Z coordinates
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
]

filtered_points = np.array(filtered_points)

source_pos = [2.93, 0.0, 0.0]
room.add_source(source_pos)
# room.add_microphone(filtered_points[:,0])
mic_array = pra.MicrophoneArray(filtered_points, fs=freq_s)
room.add_microphone_array(mic_array)
# room.set_ray_tracing(n_rays=10000, receiver_radius=0.5, hist_bin_size=0.004)
# room.image_source_model()
# room.ray_tracing()
room.compute_rir()
# room.plot_rir()



rt60 = np.zeros((len(room.rir), len(room.rir[0])))
db_levels = np.zeros((len(room.rir), len(room.rir[0])))
# print(f"RIR length: {sample_count} samples")

for i in range(len(room.rir)):
    for j in range(len(room.rir[i])):
        rt60[i][j] = pra.experimental.rt60.measure_rt60(room.rir[i][j], fs=freq_s)
        # 3. Calculate RMS (Root Mean Square) Amplitude
        rms_amplitude = np.sqrt(np.mean(room.rir[i][j]**2))
        # rms_amplitude = np.sum(room.rir[i][j]**2)
        # 4. Convert to dB
        # Note: This is dB relative to the digital scale (dBFS-like), not physical SPL
        db_level = 20 * np.log10(rms_amplitude)
        #db_level = 10 * np.log10(rms_amplitude)
        db_levels[i][j] = db_level
        # print(f"RMS Amplitude: {rms_amplitude}")
        # print(f"Digital Level: {db_level:.2f} dB")
        # #rt60 = room.measure_rt60()
        # print(f"Calculated RT60: {rt60[i][j]} seconds")

plot_rt60_2d(source_pos, filtered_points, db_levels, title="Db levels")

# plt.figure()
# room.plot(img_order=0)
# plt.show()