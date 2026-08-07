using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

namespace CompasAcoustics
{
    /// <summary>One entry from GET /api/pyroomacoustics/materials.</summary>
    public class MaterialInfo
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Description { get; set; }
        public double Absorption { get; set; }
    }

    /// <summary>Parsed GET /api/pyroomacoustics/simulation-status/{id}.</summary>
    public class SimulationStatus
    {
        public string SimulationId { get; set; }
        public double Progress { get; set; }
        public string Status { get; set; }
        public bool Completed { get; set; }
        public bool Cancelled { get; set; }
        public string Error { get; set; }
        public List<string> IrFiles { get; set; } = new List<string>();
    }

    /// <summary>
    /// Thin HttpClient wrapper for the COMPAS backend. The backend is plain
    /// HTTP/JSON — the client language (Python or C#) is irrelevant to it.
    /// </summary>
    public class BackendClient
    {
        public const string DefaultBaseUrl = "http://localhost:8000";
        private static readonly HttpClient _client = new HttpClient();

        public static string BaseUrl
        {
            get
            {
                var env = Environment.GetEnvironmentVariable("COMPAS_BACKEND_URL");
                return string.IsNullOrWhiteSpace(env)
                    ? DefaultBaseUrl
                    : env.TrimEnd('/');
            }
        }

        // ---- materials -----------------------------------------------------

        public static Task<List<MaterialInfo>> GetMaterialsAsync()
        {
            return GetAsync(BaseUrl + "/api/pyroomacoustics/materials")
                .ContinueWith(t =>
                {
                    var arr = t.Result as IList;
                    if (arr == null) return new List<MaterialInfo>();
                    var list = new List<MaterialInfo>();
                    foreach (var item in arr)
                    {
                        var d = item as IDictionary<string, object>;
                        if (d == null) continue;
                        list.Add(new MaterialInfo
                        {
                            Id = SafeString(d, "id"),
                            Name = SafeString(d, "name"),
                            Description = SafeString(d, "description"),
                            Absorption = SafeDouble(d, "absorption"),
                        });
                    }
                    return list.OrderBy(m => m.Name).ToList();
                });
        }

        // ---- simulation ----------------------------------------------------

        public static Task<string> PostSimulationAsync(string payloadJson)
        {
            var content = new StringContent(payloadJson, Encoding.UTF8, "application/json");
            return _client
                .PostAsync(BaseUrl + "/api/pyroomacoustics/run-simulation-geometry", content)
                .ContinueWith(t =>
                {
                    var resp = t.Result;
                    var body = resp.Content.ReadAsStringAsync().Result;
                    if (!resp.IsSuccessStatusCode)
                        throw new BackendException("HTTP " + (int)resp.StatusCode + ": " + ExtractDetail(body));
                    var d = SimpleJson.Parse(body) as IDictionary<string, object>;
                    return d != null && d.ContainsKey("simulation_id")
                        ? Convert.ToString(d["simulation_id"])
                        : null;
                });
        }

        public static Task<SimulationStatus> GetStatusAsync(string simulationId)
        {
            var url = BaseUrl + "/api/pyroomacoustics/simulation-status/" + Uri.EscapeDataString(simulationId);
            return GetAsync(url).ContinueWith(t =>
            {
                var d = t.Result as IDictionary<string, object>;
                if (d == null) return new SimulationStatus { SimulationId = simulationId };
                var status = new SimulationStatus
                {
                    SimulationId = simulationId,
                    Progress = SafeDouble(d, "progress"),
                    Status = SafeString(d, "status"),
                    Completed = SafeBool(d, "completed"),
                    Cancelled = SafeBool(d, "cancelled"),
                    Error = SafeString(d, "error"),
                };
                var result = d.ContainsKey("result") ? d["result"] as IDictionary<string, object> : null;
                if (result != null && result.ContainsKey("ir_files"))
                {
                    var arr = result["ir_files"] as IList;
                    if (arr != null)
                        status.IrFiles = arr.Cast<object>().Select(x => Convert.ToString(x)).ToList();
                }
                return status;
            });
        }

        /// <summary>Returns list of formatted metric lines (src/rcv + RT60/EDT/...).</summary>
        public static Task<List<string>> GetMetricsAsync(string simulationId)
        {
            var url = BaseUrl + "/api/pyroomacoustics/get-result-file/" + Uri.EscapeDataString(simulationId) + "/json";
            return GetAsync(url).ContinueWith(t =>
            {
                var d = t.Result as IDictionary<string, object>;
                var lines = new List<string>();
                if (d == null || !d.ContainsKey("results")) return lines;
                var arr = d["results"] as IList;
                if (arr == null) return lines;
                foreach (var item in arr)
                {
                    var entry = item as IDictionary<string, object>;
                    if (entry == null) continue;
                    var src = SafeString(entry, "source_id");
                    var rcv = SafeString(entry, "receiver_id");
                    var parts = new List<string> { "src=" + src + " rcv=" + rcv };
                    var ap = entry.ContainsKey("acoustic_parameters")
                        ? entry["acoustic_parameters"] as IDictionary<string, object>
                        : null;
                    if (ap != null)
                    {
                        if (ap.ContainsKey("rt60") && ap["rt60"] != null) parts.Add("RT60=" + Format2(ap["rt60"]) + "s");
                        if (ap.ContainsKey("edt") && ap["edt"] != null) parts.Add("EDT=" + Format2(ap["edt"]) + "s");
                        if (ap.ContainsKey("c50") && ap["c50"] != null) parts.Add("C50=" + Format1(ap["c50"]) + "dB");
                        if (ap.ContainsKey("d50") && ap["d50"] != null) parts.Add("D50=" + Format2(ap["d50"]));
                        if (ap.ContainsKey("drr") && ap["drr"] != null) parts.Add("DRR=" + Format1(ap["drr"]) + "dB");
                        if (ap.ContainsKey("spl") && ap["spl"] != null) parts.Add("SPL=" + Format1(ap["spl"]) + "dB");
                    }
                    lines.Add(string.Join(" | ", parts));
                }
                return lines;
            });
        }

        public static string BuildIrUrl(string simulationId, string fileName)
        {
            return BaseUrl + "/api/pyroomacoustics/get-result-file/" +
                   Uri.EscapeDataString(simulationId) + "/wav?ir_filename=" +
                   Uri.EscapeDataString(fileName);
        }

        // ---- helpers -------------------------------------------------------

        private static Task<object> GetAsync(string url)
        {
            return _client.GetAsync(url).ContinueWith(t =>
            {
                var resp = t.Result;
                var body = resp.Content.ReadAsStringAsync().Result;
                if (!resp.IsSuccessStatusCode)
                    throw new BackendException("HTTP " + (int)resp.StatusCode + ": " + ExtractDetail(body));
                return SimpleJson.Parse(body);
            });
        }

        private static string ExtractDetail(string body)
        {
            try
            {
                var d = SimpleJson.Parse(body) as IDictionary<string, object>;
                if (d != null && d.ContainsKey("detail"))
                    return Convert.ToString(d["detail"]);
            }
            catch { }
            return body.Length > 300 ? body.Substring(0, 300) : body;
        }

        private static string SafeString(IDictionary<string, object> d, string key)
        {
            return d != null && d.ContainsKey(key) && d[key] != null
                ? Convert.ToString(d[key])
                : "";
        }

        private static double SafeDouble(IDictionary<string, object> d, string key)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return 0;
            double v;
            return double.TryParse(Convert.ToString(d[key]), out v) ? v : 0;
        }

        private static bool SafeBool(IDictionary<string, object> d, string key)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return false;
            bool v;
            return bool.TryParse(Convert.ToString(d[key]), out v) ? v : false;
        }

        private static string Format2(object v) { return Convert.ToDouble(v).ToString("0.00"); }
        private static string Format1(object v) { return Convert.ToDouble(v).ToString("0.0"); }
    }

    public class BackendException : Exception
    {
        public BackendException(string message) : base(message) { }
    }
}
