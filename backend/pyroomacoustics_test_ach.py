
from pathlib import Path
import matplotlib.pyplot as plt
import pyroomacoustics as pra
print(pra.__version__)

try:
    from stl import mesh
except ImportError as err:
    print(
        "The numpy-stl package is required for this example. "
        "Install it with `pip install numpy-stl`"
    )
    raise err

stl_path = Path("G:/My Drive/03_ETH Acoustic/02_Work/00_Case studies/HIL D24-1/HIL_D24-1_acoustic_mesh_no_furniture.stl")


the_mesh = mesh.Mesh.from_file(stl_path)
ntriang, nvec, npts = the_mesh.vectors.shape

freq_s = 16000

walls = []
for w in range(ntriang):
    walls.append(
        pra.wall_factory(
            the_mesh.vectors[w].T,
            # material.energy_absorption["coeffs"],
            [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],            
            # material.scattering["coeffs"],
            [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05] 
        )
    )

room = pra.Room(
            walls,
            fs=freq_s,
            max_order=3,
            ray_tracing=False,
            air_absorption=False,
            use_rand_ism = False,
            max_rand_disp = 0.05
        )

source_pos = [2.0, 6.0, 1.0]
rec_pos = [2.0, 1.0, 1.5] 
room.add_source(source_pos)
room.add_microphone(rec_pos)

room.set_ray_tracing(n_rays=16000)
# room.image_source_model()
# room.ray_tracing()
room.compute_rir()
rt60 = pra.experimental.rt60.measure_rt60(room.rir[0][0], fs=freq_s, plot=True)
print("RT60:", rt60)
room.plot_rir()


room.plot(img_order=0)
plt.show()