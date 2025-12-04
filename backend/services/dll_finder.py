from pythonnet import load
import sys
import clr

try:
    load("coreclr")
except:
    pass

publish_path = r"C:\Users\tbouizargan\repos\PachydermAcoustic_Universal\publish"
sys.path.append(publish_path)

clr.AddReference("Hare")
clr.AddReference("Pachyderm_Acoustic_Universal")

import Hare.Geometry

print("\n--- INSPECTING HARE TOPOLOGY ---")
# The property 'Hare_Data' is of type 'Topology'
# Let's see what methods 'Topology' has.
t = clr.GetClrType(Hare.Geometry.Topology)

print(f"Class: {t.FullName}")

print("\n[ METHODS TO ADD GEOMETRY ]")
for m in t.GetMethods():
    if "Add" in m.Name or "Poly" in m.Name or "Construct" in m.Name:
        params = [f"{p.ParameterType.Name} {p.Name}" for p in m.GetParameters()]
        print(f"-> {m.Name}({', '.join(params)})")