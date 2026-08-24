using System;
using GH_IO.Serialization;

namespace CompasAcoustics
{
    /// <summary>
    /// Persistent component configuration (settings + selected material).
    /// Serialized via GH_IWriter/GH_IReader so it survives save/load, unlike
    /// GHPython where module statics die with the session.
    /// </summary>
    [Serializable]
    public class SimulationSettings
    {
        // ---- pyroomacoustics settings -------------------------------------
        // Hybrid ISM + ray tracing defaults (validated config, see
        // backend/config/constants.py) — pure ISM inflates RT60.
        public bool RayTracing = true;
        public bool AirAbsorption = true;
        public int NRays = 10000;
        public int MaxOrder = 3;               // PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER
        public double RirDuration = 1.0;
        public double SoundSpeed = 343.0;
        public string SimulationMode = "mono"; // "mono" | "foa"

        // ---- materials -----------------------------------------------------
        public string SelectedMaterialId = "rough_concrete";

        // ---- UI ------------------------------------------------------------
        public bool PanelOpen = true;

        public SimulationSettings Clone()
        {
            return (SimulationSettings)MemberwiseClone();
        }

        public void Write(GH_IWriter writer)
        {
            writer.SetBoolean("RayTracing", RayTracing);
            writer.SetBoolean("AirAbsorption", AirAbsorption);
            writer.SetInt32("NRays", NRays);
            writer.SetInt32("MaxOrder", MaxOrder);
            writer.SetDouble("RirDuration", RirDuration);
            writer.SetDouble("SoundSpeed", SoundSpeed);
            writer.SetString("SimulationMode", SimulationMode);
            writer.SetString("SelectedMaterialId", SelectedMaterialId);
            writer.SetBoolean("PanelOpen", PanelOpen);
        }

        public void Read(GH_IReader reader)
        {
            reader.TryGetBoolean("RayTracing", ref RayTracing);
            reader.TryGetBoolean("AirAbsorption", ref AirAbsorption);
            reader.TryGetInt32("NRays", ref NRays);
            reader.TryGetInt32("MaxOrder", ref MaxOrder);
            reader.TryGetDouble("RirDuration", ref RirDuration);
            reader.TryGetDouble("SoundSpeed", ref SoundSpeed);
            reader.TryGetString("SimulationMode", ref SimulationMode);
            reader.TryGetString("SelectedMaterialId", ref SelectedMaterialId);
            reader.TryGetBoolean("PanelOpen", ref PanelOpen);
        }
    }
}
