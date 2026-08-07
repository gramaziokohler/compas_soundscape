import ast
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time

import Rhino

# HTTP client — works on CPython 3 (Rhino 8 GHPython) AND IronPython 2
# (Rhino 6/7 GHPython), which does NOT ship the `urllib.request` module.
try:
    import urllib.request as _urlreq
    import urllib.error as _urlerr
    URLError = _urlerr.URLError
    HTTPError = _urlerr.HTTPError
    _PY3_HTTP = True
except ImportError:
    import urllib2 as _urlreq
    URLError = _urlreq.URLError
    HTTPError = _urlreq.HTTPError
    _PY3_HTTP = False

DEBUG_LOG = os.path.join(tempfile.gettempdir(), "compas_pra_debug.log")


def _debug_log(message):
    """Append a [dbg:pra] line to %TEMP%\\compas_pra_debug.log (ground truth
    when running inside Grasshopper, where the console is not observable)."""
    try:
        with open(DEBUG_LOG, "a") as fh:
            fh.write("[dbg:pra] %s %s\n" % (time.strftime("%H:%M:%S"), message))
    except Exception:
        pass


DEFAULT_BASE_URL = "http://localhost:8000"
DEFAULT_UNITS = "m"

PAYLOAD_PATH = "/api/pyroomacoustics/run-simulation-geometry"
STATUS_PATH = "/api/pyroomacoustics/simulation-status/{simulation_id}"
POST_TIMEOUT_S = 60
POLL_TIMEOUT_S = 60 * 60
POLL_REFRESH_MS = 500

_EMPTY = []  # placeholder used by GH for empty outputs

# Per-component-instance run state, keyed by ghenv.Component.InstanceGuid.
# GHPython re-executes the whole module on EVERY solve, so a bare module-level
# assignment would be reset each solve. The `not in globals()` guard makes this
# a persistent component-local static (it survives across solves and is never
# touched by GHPython's variable cleanup because of the leading underscore).
if "_PRA_STATE" not in globals():
    _PRA_STATE = {}
    _debug_log(
        "module init; build=v7-toplevel python=%s urllib_py3=%s"
        % (sys.version.split()[0], _PY3_HTTP)
    )


def _set_message(text):
    try:
        ghenv.Component.Message = text
    except Exception:
        pass


def _as_list(value):
    """Normalise an input to a list without crashing on single Rhino objects.

    A single connected item arrives as the raw object (a Rhino.Geometry.Mesh /
    Brep / Point3d, which are not iterable) — `list(mesh)` raises TypeError.
    A list of items arrives as a Python list. Both must work.
    """
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    try:
        return list(value)
    except TypeError:
        return [value]


def _parse_units(units):
    if units in (None, "", "m"):
        return "m"
    units = str(units).strip().lower()
    if units in ("mm", "cm", "ft"):
        return units
    return "m"


def _mesh_from_geometry(geometry):
    if isinstance(geometry, Rhino.Geometry.Mesh):
        return geometry
    if isinstance(geometry, Rhino.Geometry.Brep):
        result = Rhino.Geometry.Mesh.CreateFromBrep(
            geometry, Rhino.Geometry.MeshingParameters.Default
        )
        if result:
            mesh = Rhino.Geometry.Mesh()
            for part in result:
                mesh.Append(part)
            mesh.Weld(Rhino.RhinoMath.ZeroTolerance)
            return mesh
    return None


def _serialize_mesh(mesh):
    vertices = [[v.X, v.Y, v.Z] for v in mesh.Vertices]
    faces = []
    for i in range(mesh.Faces.Count):
        face = mesh.Faces[i]
        if face.IsTriangle:
            faces.append([face.A, face.B, face.C])
        elif face.IsQuad:
            faces.append([face.A, face.B, face.C])
            faces.append([face.A, face.C, face.D])
    return vertices, faces


def _parse_material_text(text):
    """Parse a material dict from a GH Panel string, tolerating unquoted keys
    (e.g. `{absorption: 0.5, scattering: 0.05}`) as well as valid JSON.
    Returns a dict, or None if the text is not a material dict."""
    s = str(text).strip()
    if not s:
        return None
    for candidate in (s, _quote_bare_keys(s)):
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        try:
            parsed = ast.literal_eval(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return None


def _quote_bare_keys(s):
    """Turn `{absorption: 0.5, scattering: 0.05}` into valid JSON by quoting
    identifier keys that were typed without quotes."""
    return re.sub(r"([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', s)


def _material_lookup(materials):
    # Returns a function idx -> material dict or None, so a single dict applies
    # to every mesh and a list is aligned by index. Handles raw dicts, lists,
    # and GH Panel strings (which arrive as `str`, not `dict`).
    if materials is None:
        return lambda idx: None
    if isinstance(materials, str):
        mat = _parse_material_text(materials)
        if isinstance(mat, dict):
            return lambda idx: mat
        return lambda idx: None
    if isinstance(materials, dict):
        mat = materials
        if "absorption" in mat:
            return lambda idx: mat
        return lambda idx: None
    if isinstance(materials, (list, tuple)):
        def lookup(idx):
            if idx >= len(materials):
                return None
            item = materials[idx]
            if isinstance(item, str):
                return _parse_material_text(item)
            return item
        return lookup
    return lambda idx: None


def _normalise_settings(settings):
    defaults = {
        "max_order": 3,
        "ray_tracing": False,
        "air_absorption": False,
        "n_rays": 10000,
        "simulation_mode": "mono",
        "sound_speed": 343.0,
        "rir_duration": 1.0,
    }
    if not isinstance(settings, dict):
        return defaults
    merged = dict(defaults)
    for key, value in settings.items():
        merged[key] = value
    return merged


def _http_json(url, payload=None, timeout=POST_TIMEOUT_S):
    """POST (if payload) or GET a JSON endpoint. Raises RuntimeError on failure."""
    try:
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            if _PY3_HTTP:
                request = _urlreq.Request(
                    url,
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
            else:
                # urllib2 (IronPython): a Request with data defaults to POST.
                request = _urlreq.Request(url, data=data, headers={"Content-Type": "application/json"})
        else:
            request = _urlreq.Request(url)
        with _urlreq.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as exc:
        detail = ""
        try:
            body = exc.read().decode("utf-8")
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                detail = parsed.get("detail", "")
        except Exception:
            pass
        raise RuntimeError("HTTP %d: %s" % (exc.code, detail))
    except URLError as exc:
        raise RuntimeError("Connection error: %s" % exc.reason)
    return json.loads(raw)


def _payload_fingerprint(payload):
    return hashlib.md5(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _format_metrics(results):
    """Render the backend results JSON into a list of readable lines so a GH
    Panel shows the values instead of the raw .NET Dictionary type name."""
    lines = []
    for entry in results:
        src = entry.get("source_id", "?")
        rcv = entry.get("receiver_id", "?")
        parts = ["src=%s rcv=%s" % (src, rcv)]
        ap = entry.get("acoustic_parameters") or {}
        if ap.get("rt60") is not None:
            parts.append("RT60=%.2fs" % ap["rt60"])
        if ap.get("edt") is not None:
            parts.append("EDT=%.2fs" % ap["edt"])
        if ap.get("c50") is not None:
            parts.append("C50=%.1fdB" % ap["c50"])
        if ap.get("d50") is not None:
            parts.append("D50=%.2f" % ap["d50"])
        if ap.get("drr") is not None:
            parts.append("DRR=%.1fdB" % ap["drr"])
        if ap.get("spl") is not None:
            parts.append("SPL=%.1fdB" % ap["spl"])
        lines.append(" | ".join(parts))
    return lines


def _start_thread(target, args):
    """Run `target(args)` on a daemon background thread so the blocking HTTP
    work never freezes the Grasshopper solver thread."""
    thread = threading.Thread(target=target, args=args)
    thread.daemon = True
    thread.start()


def _schedule_refresh():
    """Ask Grasshopper (main thread) to re-solve this component shortly.

    Called ONLY from the solve, never from a worker thread — ExpireSolution and
    document scheduling are not thread-safe off the Grasshopper solver thread.
    """
    try:
        import System

        document = ghenv.Component.OnPingDocument()
        if document is None:
            ghenv.Component.ExpireSolution(True)
            return
        document.ScheduleSolution(
            System.TimeSpan.FromMilliseconds(POLL_REFRESH_MS),
            ghenv.Component,
            _on_scheduled,
        )
    except Exception:
        try:
            ghenv.Component.ExpireSolution(True)
        except Exception:
            pass


def _on_scheduled(document, component):
    try:
        component.ExpireSolution(True)
    except Exception:
        pass


def _post_worker(state, base_url, payload):
    try:
        data = _http_json(base_url + PAYLOAD_PATH, payload)
        state.update({
            "submitted": True,
            "simulation_id": data.get("simulation_id", ""),
        })
        _debug_log(
            "POST %s -> simulation_id=%s"
            % (base_url + PAYLOAD_PATH, state.get("simulation_id", ""))
        )
    except Exception as exc:
        _debug_log("POST failed: %r" % (exc,))
        state.update({"done": True, "status": "POST failed: %s" % exc})
    finally:
        state["busy"] = False


def _poll_worker(state, base_url):
    try:
        poll = _http_json(
            base_url + STATUS_PATH.format(simulation_id=state["simulation_id"])
        )
        state["progress"] = float(poll.get("progress", 0))
        state["status"] = str(poll.get("status", ""))

        if poll.get("completed"):
            if poll.get("error"):
                state["status"] = "Simulation failed: %s" % poll["error"]
                state["done"] = True
                _debug_log("simulation failed: %s" % poll["error"])
            else:
                result = poll.get("result") or {}
                state["ir_paths"] = [
                    base_url + "/api/pyroomacoustics/get-result-file/%s/wav?ir_filename=%s"
                    % (state["simulation_id"], name)
                    for name in result.get("ir_files", [])
                ]
                try:
                    metrics = _http_json(
                        base_url + "/api/pyroomacoustics/get-result-file/%s/json"
                        % state["simulation_id"]
                    )
                    state["metrics"] = _format_metrics(metrics.get("results", []))
                except Exception:
                    state["metrics"] = []
                state["progress"] = 100.0
                state["status"] = "Completed"
                state["done"] = True
                _debug_log(
                    "completed sim=%s irs=%d"
                    % (state["simulation_id"], len(state.get("ir_paths", [])))
                )
    except Exception as exc:
        _debug_log("poll failed: %r" % (exc,))
        state["status"] = "Failed: %s" % exc
        state["done"] = True
    finally:
        state["busy"] = False


def _build_payload(geometry, materials, sources, receivers, unit, sim_settings):
    mesh_items = []
    for item in _as_list(geometry):
        mesh = _mesh_from_geometry(item)
        if mesh is not None:
            mesh_items.append(mesh)

    material_for = _material_lookup(materials)

    vertices = []
    faces = []
    face_groups = {}
    material_map = {}
    group_index = 0

    for mesh_index, mesh in enumerate(mesh_items):
        material = material_for(mesh_index)
        if material is None or not isinstance(material, dict):
            continue
        mesh_verts, mesh_faces = _serialize_mesh(mesh)
        if not mesh_faces:
            continue
        offset = len(vertices)
        for v in mesh_verts:
            vertices.append(v)
        face_indices = []
        for f in mesh_faces:
            face_indices.append(len(faces))
            faces.append([f[0] + offset, f[1] + offset, f[2] + offset])
        group_id = "mesh_%d" % group_index
        face_groups[group_id] = face_indices
        material_map[group_id] = {
            "absorption": float(material.get("absorption", 1.0)),
            "scattering": material.get("scattering"),
        }
        group_index += 1

    if not faces:
        return None, "No faces with materials: connect geometry with a matching material entry"

    source_points = _as_list(sources)
    receiver_points = _as_list(receivers)
    if not source_points or not receiver_points:
        return None, "Need at least one source and one receiver"

    payload = {
        "vertices": vertices,
        "faces": faces,
        "face_groups": face_groups,
        "materials": material_map,
        "units": unit,
        "sources": [
            {"id": "src_%d" % i, "position": [p.X, p.Y, p.Z]}
            for i, p in enumerate(source_points)
        ],
        "receivers": [
            {"id": "rcv_%d" % i, "position": [p.X, p.Y, p.Z]}
            for i, p in enumerate(receiver_points)
        ],
        "settings": {
            "max_order": int(sim_settings["max_order"]),
            "ray_tracing": bool(sim_settings["ray_tracing"]),
            "air_absorption": bool(sim_settings["air_absorption"]),
            "n_rays": int(sim_settings["n_rays"]),
            "simulation_mode": sim_settings["simulation_mode"],
            "sound_speed": float(sim_settings["sound_speed"]),
            "rir_duration": float(sim_settings["rir_duration"]),
        },
        "simulation_name": "grasshopper_simulation",
    }
    return payload, ""


def _drive(geometry, materials, sources, receivers, units, settings, base_url, run):
    base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
    unit = _parse_units(units)
    sim_settings = _normalise_settings(settings)
    run = bool(run)

    instance_guid = str(ghenv.Component.InstanceGuid)
    state = _PRA_STATE.get(instance_guid)

    _debug_log(
        "solve: run=%r instance=%s geometry=%d sources=%d receivers=%d units=%r base_url=%s"
        % (run, instance_guid,
           len(_as_list(geometry)) if geometry is not None else 0,
           len(_as_list(sources)) if sources is not None else 0,
           len(_as_list(receivers)) if receivers is not None else 0,
           unit, base_url)
    )

    if not run:
        if state is not None:
            _PRA_STATE.pop(instance_guid, None)
        _set_message("Idle (run=False)")
        return _EMPTY, _EMPTY, 0.0, "Idle - set run=True to start", ""

    payload, build_error = _build_payload(geometry, materials, sources, receivers, unit, sim_settings)
    if payload is None:
        if state is not None:
            _PRA_STATE.pop(instance_guid, None)
        _debug_log("build_error: %s" % build_error)
        _set_message("Input error")
        return _EMPTY, _EMPTY, 0.0, build_error, ""
    fingerprint = _payload_fingerprint(payload)

    if state is None:
        state = {}
        _PRA_STATE[instance_guid] = state

    # Inputs changed since last submission -> fresh state dict (epoch). The old
    # state object is abandoned; any still-running worker writes to it and can
    # never clobber the new run.
    if state.get("submitted") and state.get("fingerprint") != fingerprint:
        state = {}
        _PRA_STATE[instance_guid] = state

    # Cached completed result for identical inputs.
    if state.get("done") and state.get("fingerprint") == fingerprint:
        _set_message("Completed")
        return (
            state.get("ir_paths", []),
            state.get("metrics", []),
            state.get("progress", 100.0),
            state.get("status", "Completed"),
            state.get("simulation_id", ""),
        )

    # A worker thread is mid-flight — show its latest state and keep the
    # main-thread refresh loop alive; the worker only writes to `state` and
    # never schedules, so no cross-thread GH calls happen.
    if state.get("busy"):
        _schedule_refresh()
        _set_message(state.get("status") or "Running...")
        return (
            state.get("ir_paths", []),
            state.get("metrics", []),
            state.get("progress", 0.0),
            state.get("status", state.get("status") or "Running..."),
            state.get("simulation_id", ""),
        )

    if not state.get("submitted"):
        state.update({
            "submitted": False,
            "done": False,
            "busy": True,
            "progress": 0.0,
            "status": "Queued...",
            "simulation_id": "",
            "ir_paths": [],
            "metrics": [],
            "fingerprint": fingerprint,
        })
        _start_thread(_post_worker, (state, base_url, payload))
        _set_message("Queued...")
        _schedule_refresh()
        return _EMPTY, _EMPTY, 0.0, "Queued...", ""

    state["busy"] = True
    _start_thread(_poll_worker, (state, base_url))
    _set_message(state.get("status") or "Running...")
    _schedule_refresh()
    return (
        state.get("ir_paths", []),
        state.get("metrics", []),
        state.get("progress", 0.0),
        state.get("status", state.get("status") or "Running..."),
        state.get("simulation_id", ""),
    )


# ---------------------------------------------------------------------------
# Top-level driver — the CLASSIC GHPython contract, works on every engine:
# GHPython runs this module body on each solve, then reads the output variables
# below (ir_paths, metrics, progress, status, simulation_id) BY NAME from the
# module namespace. It does NOT depend on the engine auto-invoking RunScript
# (some engines never do). RunScript() below is a thin delegate for engines
# that DO call it — _drive is safe to run more than once per solve.
# ---------------------------------------------------------------------------
try:
    ir_paths, metrics, progress, status, simulation_id = _drive(
        geometry, materials, sources, receivers, units, settings, base_url, run
    )
except Exception as exc:
    _debug_log("top-level driver error: %r" % (exc,))
    ir_paths, metrics, progress, status, simulation_id = (
        _EMPTY, _EMPTY, 0.0, "Script error: %s" % exc, "",
    )


def RunScript(geometry, materials, sources, receivers, units, settings, base_url, run):
    return _drive(geometry, materials, sources, receivers, units, settings, base_url, run)
