import rhino3dm
path = r"C:\Users\tbouizargan\repos\compas_soundscape\backend\data\test_file.3dm"

print("Hello Rhino3dm", rhino3dm.__version__)
file3dm = rhino3dm.File3dm.Read(path)
if not file3dm:
    raise Exception("Failed to read 3DM file")

# Extract all geometry from 3DM file
all_vertices = []
all_faces = []
vertex_offset = 0


# Get instance definitions count
idef_count = 0
try:
    idef_count = len(file3dm.InstanceDefinitions) if hasattr(file3dm, 'InstanceDefinitions') else 0
except:
    idef_count = 0