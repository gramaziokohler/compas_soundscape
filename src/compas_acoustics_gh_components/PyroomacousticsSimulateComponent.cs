using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;

namespace CompasAcoustics
{
    public enum SimState { Idle, Starting, Running, Completed, Failed, Cancelled }

    /// <summary>
    /// Pyroomacoustics room simulation via the COMPAS backend. Karamba-style
    /// on-canvas settings panel (see PyroomacousticsSimulateAttributes).
    /// Simulation runs on a background thread; the UI thread is never blocked.
    /// </summary>
    public class PyroomacousticsSimulateComponent : GH_Component
    {
        public PyroomacousticsSimulateComponent()
            : base("Pyroomacoustics Simulate", "PRASim",
                   "Run a pyroomacoustics room simulation on the COMPAS backend.\n" +
                   "Connect a closed mesh, source points, receiver points and a boolean run toggle.\n" +
                   "Right-click / panel controls configure materials and settings.",
                   "COMPAS", "Acoustics")
        {
            MaterialCatalog.EnsureLoaded();
            _settings = new SimulationSettings();
            _prevRun = false;
            _initialized = false;
            _justLoaded = false;
        }

        // ---- persistent settings ------------------------------------------
        private SimulationSettings _settings;
        public SimulationSettings Settings
        {
            get { return _settings; }
            set { _settings = value; }
        }

        // ---- runtime state (not persisted) --------------------------------
        private volatile SimState _state = SimState.Idle;
        private double _progress = 0;
        private string _simulationId = null;
        private string _error = "";
        private List<string> _irPaths = new List<string>();
        private List<string> _metrics = new List<string>();
        private bool _prevRun = false;
        private bool _initialized = false;
        private bool _justLoaded = false;

        public override void CreateAttributes()
        {
            m_attributes = new PyroomacousticsSimulateAttributes(this);
        }

        public override Guid ComponentGuid
        {
            get { return new Guid("E4F8B2D1-3C9A-4E7B-A5D2-9B1C6F8A2D4E"); }
        }

        protected override System.Drawing.Bitmap Icon
        {
            get { return null; }
        }

        public override GH_Exposure Exposure
        {
            get { return GH_Exposure.primary; }
        }

        public SimState State { get { return _state; } }
        public string StateError { get { return _error; } }
        public double Progress { get { return _progress; } }

        // ---- IO ------------------------------------------------------------

        protected override void RegisterInputParams(GH_InputParamManager pManager)
        {
            pManager.AddMeshParameter("Geometry", "G", "Closed room mesh (triangles or quads).", GH_ParamAccess.item);
            pManager.AddPointParameter("Sources", "S", "Sound source points.", GH_ParamAccess.list);
            pManager.AddPointParameter("Receivers", "R", "Receiver points.", GH_ParamAccess.list);
            pManager.AddBooleanParameter("Run", "Run", "Set to True to (re)start the simulation.", GH_ParamAccess.item);
        }

        protected override void RegisterOutputParams(GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("IR paths", "IR", "List of impulse response file URLs (one per source/receiver pair).", GH_ParamAccess.list);
            pManager.AddTextParameter("Metrics", "M", "Formatted acoustic metrics per source/receiver pair.", GH_ParamAccess.list);
            pManager.AddTextParameter("Simulation ID", "ID", "Backend simulation id (for polling / file download).", GH_ParamAccess.item);
        }

        // ---- solve ---------------------------------------------------------

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            UpdateMessage();

            Mesh mesh = null;
            var sources = new List<Point3d>();
            var receivers = new List<Point3d>();
            bool run = false;

            DA.GetData(0, ref mesh);
            DA.GetDataList(1, sources);
            DA.GetDataList(2, receivers);
            DA.GetData(3, ref run);

            // Load-time guard: don't auto-fire on file open even if Run is True.
            if (_justLoaded)
            {
                _justLoaded = false;
                _prevRun = run;
            }

            if (run && !_prevRun && _initialized && _state != SimState.Starting && _state != SimState.Running)
            {
                if (mesh == null)
                {
                    SetFail("Connect a closed room mesh to G.");
                }
                else if (sources.Count == 0)
                {
                    SetFail("Connect at least one source point to S.");
                }
                else if (receivers.Count == 0)
                {
                    SetFail("Connect at least one receiver point to R.");
                }
                else
                {
                    StartSimulation(mesh, sources, receivers);
                }
            }
            _prevRun = run;

            DA.SetDataList(0, _irPaths);
            DA.SetDataList(1, _metrics);
            DA.SetData(2, _simulationId);

            if (_state == SimState.Failed)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Simulation failed: " + _error);
            }
        }

        private void UpdateMessage()
        {
            switch (_state)
            {
                case SimState.Idle: Message = "Ready"; break;
                case SimState.Starting: Message = "Submitting…"; break;
                case SimState.Running: Message = "Running… " + Math.Round(_progress).ToString("0") + "%"; break;
                case SimState.Completed: Message = "Completed · " + _irPaths.Count + " IRs"; break;
                case SimState.Failed: Message = "Failed"; break;
                case SimState.Cancelled: Message = "Cancelled"; break;
            }
        }

        private void SetFail(string msg)
        {
            _state = SimState.Failed;
            _error = msg;
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, msg);
            UpdateMessage();
        }

        // ---- simulation lifecycle -----------------------------------------

        private void StartSimulation(Mesh mesh, List<Point3d> sources, List<Point3d> receivers)
        {
            _state = SimState.Starting;
            _progress = 0;
            _simulationId = null;
            _error = "";
            _irPaths.Clear();
            _metrics.Clear();

            string payload;
            try
            {
                payload = BuildPayload(mesh, sources, receivers);
            }
            catch (Exception ex)
            {
                SetFail("Payload build error: " + ex.Message);
                return;
            }

            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    var id = BackendClient.PostSimulationAsync(payload);
                    id.Wait();
                    lock (this)
                    {
                        _simulationId = id.Result;
                        _state = SimState.Running;
                    }
                    ExpireUi();

                    while (true)
                    {
                        Thread.Sleep(1000);
                        var task = BackendClient.GetStatusAsync(_simulationId);
                        task.Wait();
                        var status = task.Result;
                        lock (this)
                        {
                            _progress = status.Progress;
                            if (status.Completed)
                            {
                                _state = SimState.Completed;
                                _irPaths = new List<string>(status.IrFiles);
                            }
                            else if (!string.IsNullOrEmpty(status.Error) || status.Status == "failed")
                            {
                                _state = SimState.Failed;
                                _error = status.Error;
                            }
                            else if (status.Cancelled)
                            {
                                _state = SimState.Cancelled;
                            }
                        }
                        ExpireUi();

                        if (_state == SimState.Completed)
                        {
                            try
                            {
                                var m = BackendClient.GetMetricsAsync(_simulationId);
                                m.Wait();
                                _metrics = m.Result;
                            }
                            catch (Exception ex)
                            {
                                _metrics = new List<string> { "Metrics fetch failed: " + FlattenMessage(ex) };
                            }
                            ExpireUi();
                            break;
                        }
                        if (_state == SimState.Failed || _state == SimState.Cancelled) break;
                    }
                }
                catch (Exception ex)
                {
                    lock (this)
                    {
                        _state = SimState.Failed;
                        _error = FlattenMessage(ex);
                    }
                    ExpireUi();
                }
            });
        }

        private static string FlattenMessage(Exception ex)
        {
            while (ex is AggregateException)
            {
                var inner = ((AggregateException)ex).InnerException;
                if (inner == null) break;
                ex = inner;
            }
            return ex.Message;
        }

        private void ExpireUi()
        {
            try
            {
                Rhino.RhinoApp.InvokeOnUiThread(new Action(() =>
                {
                    if (OnPingDocument() == null) return;
                    ExpireSolution(true);
                }));
            }
            catch { }
        }

        // ---- payload -------------------------------------------------------

        private string BuildPayload(Mesh mesh, List<Point3d> sources, List<Point3d> receivers)
        {
            var verts = new List<List<double>>();
            for (int i = 0; i < mesh.Vertices.Count; i++)
            {
                var v = mesh.Vertices[i];
                verts.Add(new List<double> { v.X, v.Y, v.Z });
            }

            var faces = new List<List<int>>();
            var faceIndexMap = new List<int>(); // output face index -> original, for degenerate skip
            for (int i = 0; i < mesh.Faces.Count; i++)
            {
                var f = mesh.Faces[i];
                var ids = new int[3];
                if (f.IsTriangle)
                {
                    ids[0] = f.A; ids[1] = f.B; ids[2] = f.C;
                }
                else
                {
                    ids[0] = f.A; ids[1] = f.B; ids[2] = f.C; // quad -> ABC + ACD below
                    faces.Add(new List<int> { f.A, f.C, f.D });
                    faceIndexMap.Add(i);
                }
                if (ids[0] != ids[1] && ids[1] != ids[2] && ids[0] != ids[2])
                {
                    faces.Add(new List<int> { ids[0], ids[1], ids[2] });
                    faceIndexMap.Add(i);
                }
            }

            var allFaceIndices = new List<int>();
            for (int i = 0; i < faces.Count; i++) allFaceIndices.Add(i);

            if (verts.Count == 0 || faces.Count == 0)
                throw new Exception("Mesh produced no valid triangles.");

            var sourcesJson = new List<Dictionary<string, object>>();
            for (int i = 0; i < sources.Count; i++)
            {
                sourcesJson.Add(new Dictionary<string, object>
                {
                    { "id", "src_" + i },
                    { "position", new List<double> { sources[i].X, sources[i].Y, sources[i].Z } }
                });
            }

            var receiversJson = new List<Dictionary<string, object>>();
            for (int i = 0; i < receivers.Count; i++)
            {
                receiversJson.Add(new Dictionary<string, object>
                {
                    { "id", "rcv_" + i },
                    { "position", new List<double> { receivers[i].X, receivers[i].Y, receivers[i].Z } }
                });
            }

            var payload = new Dictionary<string, object>
            {
                { "vertices", verts },
                { "faces", faces },
                { "face_groups", new Dictionary<string, object> { { "gh_all", allFaceIndices } } },
                { "materials", new Dictionary<string, object> { { "gh_all", new Dictionary<string, object> { { "name", _settings.SelectedMaterialId } } } } },
                { "units", CurrentUnits() },
                { "sources", sourcesJson },
                { "receivers", receiversJson },
                { "settings", new Dictionary<string, object>
                    {
                        { "max_order", _settings.MaxOrder },
                        { "ray_tracing", _settings.RayTracing },
                        { "air_absorption", _settings.AirAbsorption },
                        { "n_rays", _settings.NRays },
                        { "simulation_mode", _settings.SimulationMode },
                        { "sound_speed", _settings.SoundSpeed },
                        { "rir_duration", _settings.RirDuration }
                    }
                },
                { "simulation_name", "grasshopper_" + DateTime.Now.ToString("yyyyMMdd_HHmmss") }
            };

            return SimpleJson.Serialize(payload);
        }

        private string CurrentUnits()
        {
            var doc = Rhino.RhinoDoc.ActiveDoc;
            if (doc == null) return "m";
            switch (doc.ModelUnitSystem)
            {
                case Rhino.UnitSystem.Millimeters: return "mm";
                case Rhino.UnitSystem.Centimeters: return "cm";
                case Rhino.UnitSystem.Feet: return "ft";
                case Rhino.UnitSystem.Inches: return "ft"; // closest supported
                default: return "m";
            }
        }

        // ---- persistence ---------------------------------------------------

        public override bool Write(GH_IO.Serialization.GH_IWriter writer)
        {
            bool ok = base.Write(writer);
            if (_settings != null) _settings.Write(writer);
            return ok;
        }

        public override bool Read(GH_IO.Serialization.GH_IReader reader)
        {
            bool ok = base.Read(reader);
            if (_settings == null) _settings = new SimulationSettings();
            _settings.Read(reader);
            _justLoaded = true;
            _state = SimState.Idle;
            _prevRun = false;
            return ok;
        }

        public override void AddedToDocument(GH_Document document)
        {
            base.AddedToDocument(document);
            _initialized = true;
        }
    }
}
