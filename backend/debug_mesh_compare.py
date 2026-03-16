"""Quick test: apply the same weld+non-manifold cleanup to the service mesh."""
import numpy as np
import sys
sys.path.insert(0, ".")
from services.pyroomacoustics_service import PyroomacousticsService

npz = np.load("debug_welded_mesh.npz")
verts_before = npz["vertices"]
faces_before = npz["faces"]

print(f"Before cleanup: {len(verts_before)} verts, {len(faces_before)} faces")

# Edge analysis before
def edge_stats(face_list, label):
    edge_count = {}
    for f in face_list:
        n = len(f)
        for j in range(n):
            e = tuple(sorted([f[j], f[(j + 1) % n]]))
            edge_count[e] = edge_count.get(e, 0) + 1
    total = len(edge_count)
    boundary = sum(1 for c in edge_count.values() if c == 1)
    nm = sum(1 for c in edge_count.values() if c > 2)
    print(f"  {label}: {total} edges, {boundary} boundary, {nm} non-manifold")
    return nm

edge_stats(faces_before.tolist(), "Before")

# Simulate: convert to lists and run weld_mesh
# (faces_before is already welded from the first pass, but without non-manifold fix)
# We need to run the full weld again from scratch to test the new code.
# Reconstruct the original indexed mesh by un-sharing vertices:
all_verts = []
all_faces = []
for f in faces_before:
    offset = len(all_verts)
    for vi in f:
        all_verts.append(verts_before[vi].tolist())
    all_faces.append([offset, offset + 1, offset + 2])

print(f"\nReconstructed raw mesh: {len(all_verts)} verts, {len(all_faces)} faces")

# Run the updated weld_mesh
verts_after, faces_after, _, _ = PyroomacousticsService.weld_mesh(
    all_verts, all_faces, None, None
)

print(f"After weld_mesh: {len(verts_after)} verts, {len(faces_after)} faces")
nm = edge_stats(faces_after, "After")

if nm == 0:
    print("\nSUCCESS: mesh is now manifold (0 non-manifold edges)")

    # Test room creation
    import pyroomacoustics as pra
    verts_np = np.array(verts_after)
    walls = []
    for f in faces_after:
        corners = verts_np[f].T
        walls.append(pra.wall_factory(corners, [0.001] * 7, [0.001] * 7))
    room = pra.Room(walls, fs=16000, max_order=2)
    inside = room.is_inside([0, 0, 0])
    print(f"Room created: {len(walls)} walls, is_inside([0,0,0])={inside}")
else:
    print(f"\nFAILED: still {nm} non-manifold edges")
