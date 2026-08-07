using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace CompasAcoustics
{
    /// <summary>
    /// Shared, process-wide material catalog fetched once from
    /// GET /api/pyroomacoustics/materials. Fallbacks to the backend
    /// "rough_concrete" preset if the fetch fails or is still in flight.
    /// </summary>
    public static class MaterialCatalog
    {
        public static List<MaterialInfo> Materials { get; private set; } = new List<MaterialInfo>();
        public static bool IsLoading { get; private set; }
        public static bool HasLoaded { get; private set; }
        public static string LoadError { get; private set; } = "";

        private static readonly object _lock = new object();

        public static void EnsureLoaded()
        {
            lock (_lock)
            {
                if (HasLoaded || IsLoading) return;
                IsLoading = true;
            }
            Task.Run(() =>
            {
                try
                {
                    var list = BackendClient.GetMaterialsAsync().Result;
                    lock (_lock)
                    {
                        Materials = list;
                        HasLoaded = true;
                        LoadError = "";
                    }
                }
                catch (System.Exception ex)
                {
                    lock (_lock)
                    {
                        LoadError = ex.Message;
                        HasLoaded = true; // don't retry every second
                    }
                }
                finally
                {
                    lock (_lock) { IsLoading = false; }
                }
            });
        }

        public static MaterialInfo Find(string id)
        {
            return Materials.FirstOrDefault(m => string.Equals(m.Id, id, System.StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Display name for a material id, or the raw id when unknown.</summary>
        public static string DisplayName(string id)
        {
            var m = Find(id);
            return m != null ? m.Name : id;
        }
    }
}
