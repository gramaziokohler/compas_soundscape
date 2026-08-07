using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace CompasAcoustics
{
    /// <summary>
    /// Minimal JSON serializer/parser that only touches mscorlib. The Rhino 8 /
    /// Grasshopper 8 runtime does NOT provide System.Web.Extensions, so
    /// JavaScriptSerializer (and System.Text.Json on net48) is unavailable.
    /// </summary>
    public static class SimpleJson
    {
        // ---- serialization --------------------------------------------------

        public static string Serialize(object value)
        {
            var sb = new StringBuilder(512);
            WriteValue(sb, value);
            return sb.ToString();
        }

        private static void WriteValue(StringBuilder sb, object value)
        {
            if (value == null) { sb.Append("null"); return; }
            if (value is bool) { sb.Append((bool)value ? "true" : "false"); return; }
            if (value is string) { WriteString(sb, (string)value); return; }
            if (value is int) { sb.Append(((int)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is long) { sb.Append(((long)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is short) { sb.Append(((short)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is byte) { sb.Append(((byte)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is double) { WriteNumber(sb, (double)value); return; }
            if (value is float) { WriteNumber(sb, (double)(float)value); return; }
            if (value is decimal) { sb.Append(((decimal)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is IDictionary<string, object>)
            {
                var dict = (IDictionary<string, object>)value;
                sb.Append('{');
                bool first = true;
                foreach (var kv in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(sb, kv.Key);
                    sb.Append(':');
                    WriteValue(sb, kv.Value);
                }
                sb.Append('}');
                return;
            }
            if (value is System.Collections.IDictionary)
            {
                var dict = (System.Collections.IDictionary)value;
                sb.Append('{');
                bool first = true;
                foreach (System.Collections.DictionaryEntry kv in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(sb, Convert.ToString(kv.Key, CultureInfo.InvariantCulture));
                    sb.Append(':');
                    WriteValue(sb, kv.Value);
                }
                sb.Append('}');
                return;
            }
            if (value is System.Collections.IEnumerable && !(value is char[]))
            {
                sb.Append('[');
                bool first = true;
                foreach (var item in (System.Collections.IEnumerable)value)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteValue(sb, item);
                }
                sb.Append(']');
                return;
            }
            WriteString(sb, Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        private static void WriteNumber(StringBuilder sb, double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) { sb.Append("null"); return; }
            sb.Append(value.ToString("R", CultureInfo.InvariantCulture));
        }

        private static void WriteString(StringBuilder sb, string value)
        {
            sb.Append('"');
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // ---- parsing ---------------------------------------------------------

        public static object Parse(string json)
        {
            if (json == null) return null;
            int pos = 0;
            var value = ParseValue(json, ref pos);
            return value;
        }

        private static object ParseValue(string json, ref int pos)
        {
            SkipWs(json, ref pos);
            if (pos >= json.Length) return null;
            char c = json[pos];
            if (c == '{') return ParseObject(json, ref pos);
            if (c == '[') return ParseArray(json, ref pos);
            if (c == '"') return ParseString(json, ref pos);
            if (c == 't') { Expect(json, ref pos, "true"); return true; }
            if (c == 'f') { Expect(json, ref pos, "false"); return false; }
            if (c == 'n') { Expect(json, ref pos, "null"); return null; }
            return ParseNumber(json, ref pos);
        }

        private static Dictionary<string, object> ParseObject(string json, ref int pos)
        {
            var dict = new Dictionary<string, object>();
            pos++; // '{'
            SkipWs(json, ref pos);
            if (pos < json.Length && json[pos] == '}') { pos++; return dict; }
            while (pos < json.Length)
            {
                SkipWs(json, ref pos);
                string key = ParseString(json, ref pos);
                SkipWs(json, ref pos);
                if (pos >= json.Length || json[pos] != ':') throw new FormatException("Expected ':' at " + pos);
                pos++;
                var value = ParseValue(json, ref pos);
                dict[key] = value;
                SkipWs(json, ref pos);
                if (pos >= json.Length) throw new FormatException("Unterminated object");
                if (json[pos] == ',') { pos++; continue; }
                if (json[pos] == '}') { pos++; break; }
                throw new FormatException("Expected ',' or '}' at " + pos);
            }
            return dict;
        }

        private static List<object> ParseArray(string json, ref int pos)
        {
            var list = new List<object>();
            pos++; // '['
            SkipWs(json, ref pos);
            if (pos < json.Length && json[pos] == ']') { pos++; return list; }
            while (pos < json.Length)
            {
                var value = ParseValue(json, ref pos);
                list.Add(value);
                SkipWs(json, ref pos);
                if (pos >= json.Length) throw new FormatException("Unterminated array");
                if (json[pos] == ',') { pos++; continue; }
                if (json[pos] == ']') { pos++; break; }
                throw new FormatException("Expected ',' or ']' at " + pos);
            }
            return list;
        }

        private static string ParseString(string json, ref int pos)
        {
            if (pos >= json.Length || json[pos] != '"') throw new FormatException("Expected string at " + pos);
            pos++;
            var sb = new StringBuilder();
            while (pos < json.Length)
            {
                char c = json[pos];
                if (c == '"') { pos++; return sb.ToString(); }
                if (c == '\\')
                {
                    pos++;
                    if (pos >= json.Length) throw new FormatException("Bad escape");
                    char e = json[pos];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (pos + 4 >= json.Length) throw new FormatException("Bad \\u escape");
                            string hex = json.Substring(pos + 1, 4);
                            sb.Append((char)int.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            pos += 4;
                            break;
                        default: throw new FormatException("Bad escape '\\" + e + "'");
                    }
                    pos++;
                }
                else
                {
                    sb.Append(c);
                    pos++;
                }
            }
            throw new FormatException("Unterminated string");
        }

        private static object ParseNumber(string json, ref int pos)
        {
            int start = pos;
            while (pos < json.Length && "+-0123456789.eE".IndexOf(json[pos]) >= 0) pos++;
            string num = json.Substring(start, pos - start);
            if (num.IndexOf('.') >= 0 || num.IndexOf('e') >= 0 || num.IndexOf('E') >= 0)
                return double.Parse(num, NumberStyles.Float, CultureInfo.InvariantCulture);
            long l;
            if (long.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out l)) return l;
            return double.Parse(num, NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        private static void Expect(string json, ref int pos, string literal)
        {
            if (pos + literal.Length > json.Length) throw new FormatException("Bad literal");
            for (int i = 0; i < literal.Length; i++)
            {
                if (json[pos + i] != literal[i]) throw new FormatException("Bad literal");
            }
            pos += literal.Length;
        }

        private static void SkipWs(string json, ref int pos)
        {
            while (pos < json.Length && char.IsWhiteSpace(json[pos])) pos++;
        }
    }
}
