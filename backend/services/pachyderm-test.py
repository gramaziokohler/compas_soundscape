import sys
import os
from pythonnet import load

try:
    load("coreclr")
except Exception:
    pass

import clr
import System
from System import Array, Int32, Double, Boolean
from System.Collections.Generic import List

class AudioEngine:
    _instance = None
    _is_loaded = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(AudioEngine, cls).__new__(cls)
            cls._instance._initialize()
        return cls._instance

    def _initialize(self):
        if self._is_loaded: return
        
        # CONFIG: Check your path
        self.publish_path = r"C:\Users\tbouizargan\repos\PachydermAcoustic_Universal\publish"
        sys.path.append(self.publish_path)

        try:
            clr.AddReference("NAudio")
            clr.AddReference("NAudio.Core")
            clr.AddReference("Hare")
            clr.AddReference("Pachyderm_Acoustic_Universal")

            # --- IMPORTS ---
            import Hare
            self.Point3d = Hare.Geometry.Point
            
            import Pachyderm_Acoustic as PA
            import Pachyderm_Acoustic.Environment as PA_Env
            
            # Use Empty_Scene (Initializes Hare_Data automatically)
            self.Empty_Scene = PA_Env.Empty_Scene 
            
            self.Receiver_Bank = PA_Env.Receiver_Bank
            self.SplitRayTracer = PA.SplitRayTracer
            self.Source = PA_Env.Source
            self.Basic_Material = PA_Env.Basic_Material
            
            self._is_loaded = True
            print("✅ AudioEngine Loaded Successfully.")

        except Exception as e:
            print(f"❌ AudioEngine Load Error: {e}")
            self._is_loaded = False

    def run_simulation(self):
        if not self._is_loaded: return {"error": "Engine not loaded"}

        try:
            print("\n--- 1. SETTING UP ENVIRONMENT ---")
            # Constructor: (Temp, Hum, Pa, Air_Choice, EdgeCorrection, IsAcoustic)
            # This creates a valid, empty container.
            scene = self.Empty_Scene(20.0, 50.0, 101325.0, 0, False, True)
            print("✅ Empty_Scene created.")

            print("\n--- 2. ADDING MATERIAL ---")
            # We must define what the walls are made of.
            # Create absorption coefficients (0.1 = 10% absorption for all bands)
            # Usually 8 bands: 63, 125, 250, 500, 1k, 2k, 4k, 8k
            abs_coeffs = Array[Double]([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])
            scat_coeffs = Array[Double]([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
            
            # Create Material (Name, ColorInt, Absorption, Scattering, Transparency)
            # Color -1 is fine for calculation only.
            material = self.Basic_Material("Concrete", -1, abs_coeffs, scat_coeffs, 0.0)
            
            # Add to Scene's Material List
            # This returns the ID (index) of the material, which is likely 0
            scene.Materials.Add(material)
            mat_id = 0 
            print("✅ Material 'Concrete' added.")

            print("\n--- 3. ADDING GEOMETRY ---")
            # Create Points
            p1 = self.Point3d(0.0, 0.0, 0.0)
            p2 = self.Point3d(10.0, 0.0, 0.0)
            p3 = self.Point3d(10.0, 10.0, 0.0)
            p4 = self.Point3d(0.0, 10.0, 0.0)
            
            # Create List -> Array
            poly_list = List[self.Point3d]()
            poly_list.Add(p1)
            poly_list.Add(p2)
            poly_list.Add(p3)
            poly_list.Add(p4)
            points_array = poly_list.ToArray()

            # Add Polygon to Topology
            # Add_Polygon returns the Index of the new polygon
            poly_index = scene.Hare_Data.Add_Polygon(points_array)
            
            # --- CRITICAL: ASSIGN MATERIAL TO POLYGON ---
            # In Hare/Pachyderm, the 'Layer' property of the polygon is often used 
            # to map to the Material Index.
            # Hare_Data.Polygons is a list of Arb_Poly objects.
            scene.Hare_Data.Polygons[poly_index].Layer = mat_id
            
            print("✅ Geometry added and linked to Material.")

            print("\n--- 4. SETUP SIMULATION ---")
            src_loc = self.Point3d(5.0, 5.0, 2.0)
            source = self.Source(src_loc, 1, False) # 1 = ID
            
            rec_bank = self.Receiver_Bank()
            rec_loc = self.Point3d(2.0, 2.0, 1.5)
            rec_bank.AddReceiver(rec_loc)

            # Frequencies (Pachyderm usually expects 125Hz - 4kHz or similar)
            # The indices relate to the Material Array indices.
            # 0=63, 1=125, 2=250, 3=500, 4=1k, 5=2k, 6=4k...
            # Let's request 125Hz (Index 1) to 4kHz (Index 6)
            py_freqs = [1, 2, 3, 4, 5, 6] 
            octave_range = Array[Int32](py_freqs)

            cutoff = 1000.0 # ms
            order = 2 
            rays = 2000 # Enough to hit something
            vis_feedback = None 

            tracer = self.SplitRayTracer(
                source, rec_bank, scene, cutoff, octave_range, order, rays, vis_feedback
            )
            
            print("\n--- 5. RUNNING TRACE ---")
            tracer.Do_Trace()
            
            print("\n✅✅✅ TRACE FINISHED SUCCESSFULLY! ✅✅✅")
            
            return {"status": "success"}

        except Exception as e:
            print(f"\n❌ Simulation Failed: {e}")
            return {"error": str(e)}

engine = AudioEngine()

# STEP 1: Run this FIRST to see what the C# code expects
engine.run_simulation()