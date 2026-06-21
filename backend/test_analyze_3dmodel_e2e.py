"""
End-to-end integration test for the full LLM soundscape pipeline.

Pipeline:
  [1] Fetch Speckle entities + optional preview screenshot
  [2] analyze_agent   → architectural object groups + space description
  [3] scenario_agent  → 1 usage scenario
  [4] foley_agent  ─┐
                    ├─ parallel ─→ [5] orchestrate_agent → parametric playlist
  [4] speech_agent ─┘

Usage
-----
    # use the first available model, default settings
    python test_analyze_3dmodel_e2e.py

    # choose LLM provider
    python test_analyze_3dmodel_e2e.py --provider gemini

    # pick a specific model by name (substring match)
    python test_analyze_3dmodel_e2e.py --model-name "MyModel"

    # skip model preview (metadata-only analysis)
    python test_analyze_3dmodel_e2e.py --no-preview

    # include a live browser screenshot captured from the frontend
    python test_analyze_3dmodel_e2e.py --live-screenshot

    # tune scenario parameters
    python test_analyze_3dmodel_e2e.py --people-count 3 --likeliness 8 --duration 120

    # stop after a specific stage (analyze | scenario | foley | speech | orchestrate)
    python test_analyze_3dmodel_e2e.py --stop-after scenario

    # point at a different server
    python test_analyze_3dmodel_e2e.py --base-url http://localhost:8001

The script requires the FastAPI server to be running (default: http://localhost:8000).
For --live-screenshot the Next.js dev server must also be running (default: http://localhost:3000).
"""

import argparse
import asyncio
import datetime
import json
import os
import sys
import time

import requests
from dotenv import load_dotenv

# Allow direct import of backend modules when running from backend/
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)


# ── Helpers ────────────────────────────────────────────────────────────────────

def load_env() -> None:
    """Load .env then .env.local from backend/ and repo root."""
    for base_dir in (_THIS_DIR, os.path.dirname(_THIS_DIR)):
        for fname in (".env", ".env.local"):
            path = os.path.join(base_dir, fname)
            if os.path.exists(path):
                load_dotenv(path, override=True)


def _api(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


def post_json(url: str, payload: dict) -> dict:
    resp = requests.post(url, json=payload, timeout=300)
    resp.raise_for_status()
    return resp.json()


def get_json(url: str) -> dict:
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def _hr(char: str = "=", width: int = 70) -> str:
    return char * width


def _save_json(data: dict, prefix: str, model_name: str) -> str:
    safe_name = "".join(c if (c.isalnum() or c in "-_") else "_" for c in model_name)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(_THIS_DIR, f"{prefix}_{safe_name}_{ts}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    print(f"  [OK] Saved → {path}")
    return path


# ── Step 0 — server + project resolution ──────────────────────────────────────

def resolve_project_and_version(
    base_url: str, model_name_hint: str | None = None
) -> tuple[str, str, str]:
    """Resolve project_id and version_id from GET /api/speckle/models.

    Returns (project_id, version_id, model_name).
    """
    print("\n[0] Resolving Speckle project and model …")
    result = get_json(_api(base_url, "/api/speckle/models"))
    project_id = result.get("project_id") or ""
    models = result.get("models") or []

    if not models:
        print("[ERR] No models found in the configured Speckle project.", file=sys.stderr)
        sys.exit(1)

    chosen = None
    if model_name_hint:
        hint_lower = model_name_hint.lower()
        for m in models:
            if hint_lower in (m.get("name") or "").lower():
                chosen = m
                break
        if not chosen:
            print(f"  [WARN] No model matched '{model_name_hint}'; using first available.")

    chosen = chosen or models[0]
    model_name = chosen.get("name", chosen.get("id", "unknown"))
    latest = chosen.get("latest_version") or {}
    version_id = latest.get("id") or chosen.get("id")

    if not version_id:
        print(f"[ERR] No version ID for model '{model_name}'.", file=sys.stderr)
        sys.exit(1)

    print(f"  project_id  = {project_id}")
    print(f"  model       = {model_name!r}  (id: {chosen['id']})")
    print(f"  version_id  = {version_id}")
    print(f"  ({len(models)} model(s) available)")
    return project_id, version_id, model_name


# ── Step 1 — entity + screenshot fetch ────────────────────────────────────────

def fetch_entities(base_url: str, project_id: str, version_id: str) -> list:
    print("\n[1] Fetching entity metadata from Speckle …")
    result = post_json(
        _api(base_url, "/api/speckle/model-entities"),
        {"project_id": project_id, "version_id": version_id},
    )
    entities = result.get("entities", [])
    print(f"  [OK] {len(entities)} entities received")
    for e in entities[:5]:
        print(
            f"    #{e['index']}  {e['name']!r}  [{e['speckle_type']}]  "
            f"layer={e.get('layer') or '—'}  mat={e.get('material') or '—'}"
        )
    if len(entities) > 5:
        print(f"    … and {len(entities) - 5} more")
    return entities


def fetch_preview(base_url: str, project_id: str, version_id: str) -> str:
    print("\n[1b] Fetching model preview …")
    result = post_json(
        _api(base_url, "/api/speckle/model-preview"),
        {"project_id": project_id, "version_id": version_id},
    )
    preview = result.get("preview", "")
    snippet = preview[:60] + "…" if len(preview) > 60 else preview
    print(f"  [OK] preview: {snippet}")
    return preview


def fetch_live_screenshots(frontend_url: str) -> list[str]:
    print("\n[1c] Fetching live browser screenshots from Next.js …")
    url = frontend_url.rstrip("/") + "/api/screenshot"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    images = resp.json().get("images", [])
    if not images:
        raise ValueError("No images returned from GET /api/screenshot")
    print(f"  [OK] {len(images)} screenshot(s) fetched")
    return images


# ── Step 2 — analyze_agent ────────────────────────────────────────────────────

def run_analyze(
    service,
    entities: list,
    screenshots: list[str],
    user_context: str | None,
    llm_model: str,
    model_name: str,
) -> tuple[dict, str]:
    """Run analyze_3dmodel, print results, save to disk.

    Returns (furniture_list_for_downstream, json_path).
    """
    from services.model_analysis_worker import _normalize_objects

    print(f"\n[2] analyze_agent  (provider={llm_model}, entities={len(entities)}, "
          f"screenshots={len(screenshots)}) …")
    t0 = time.time()
    raw = service.analyze_3dmodel(
        entities=entities,
        screenshots=screenshots or None,
        user_context=user_context,
        llm_model=llm_model,
    )
    elapsed = time.time() - t0

    objects = _normalize_objects(raw.get("objects", []))
    space_description = raw.get("space_description", "")

    print(f"\n{_hr()}")
    print(f"  ANALYZE RESULTS  —  {len(objects)} object group(s)  [{elapsed:.1f}s]")
    print(_hr())
    if space_description:
        print(f"\n  SPACE: {space_description}\n")
    print(f"  {'Name':<30}  {'Qty':>4}  Material")
    print(f"  {_hr('-', 55)}")
    for obj in objects:
        print(f"  {obj['name']:<30}  {obj['quantity']:>4}  {obj.get('material') or '—'}")
    print(_hr())

    # Build total_bounds from entity bbox data
    total_bounds: dict | None = None
    try:
        xs_min, ys_min, zs_min = [], [], []
        xs_max, ys_max, zs_max = [], [], []
        for entity in entities:
            bounds = entity.get("bounds") or entity.get("bbox") or {}
            mn = bounds.get("min") or []
            mx = bounds.get("max") or []
            if isinstance(mn, dict):
                mn = [mn.get("x", 0), mn.get("y", 0), mn.get("z", 0)]
            if isinstance(mx, dict):
                mx = [mx.get("x", 0), mx.get("y", 0), mx.get("z", 0)]
            if len(mn) >= 3 and len(mx) >= 3:
                xs_min.append(mn[0]); ys_min.append(mn[1]); zs_min.append(mn[2])
                xs_max.append(mx[0]); ys_max.append(mx[1]); zs_max.append(mx[2])
        if xs_min:
            total_bounds = {
                "width":  round(max(xs_max) - min(xs_min), 3),
                "depth":  round(max(ys_max) - min(ys_min), 3),
                "height": round(max(zs_max) - min(zs_min), 3),
            }
    except Exception:
        pass

    furniture_list = {
        "meta": {
            "model_name": model_name,
            **({"total_bounds": total_bounds} if total_bounds else {}),
        },
        "space_description": space_description,
        "architectural_objects": [
            {
                "name":        obj["name"],
                "description": obj["description"],
                "material":    obj.get("material", ""),
                "quantity":    obj["quantity"],
                "object_ids":  obj.get("object_ids", {}),
            }
            for obj in objects
        ],
    }

    json_path = _save_json(furniture_list, "analysis", model_name)
    return furniture_list, json_path


# ── Step 3 — scenario_agent ───────────────────────────────────────────────────

def run_scenario(
    service,
    furniture_list: dict,
    user_context: str | None,
    people_count: int,
    likeliness: int,
    duration: int,
    llm_model: str,
    model_name: str,
) -> dict:
    """Run scenarist_agent, print results, save to disk.

    Returns the raw scenario result dict.
    """
    print(f"\n[3] scenario_agent  (people={people_count}, likeliness={likeliness}, "
          f"duration={duration}s, provider={llm_model}) …")
    t0 = time.time()
    raw_scenarios = service.scenarist_agent(
        user_context=user_context,
        llm_model=llm_model,
        furniture_list=furniture_list,
        duration=duration,
        people_count=people_count,
        likeliness=likeliness,
    )
    elapsed = time.time() - t0

    scenarios = raw_scenarios.get("scenarios", [])
    print(f"\n{_hr()}")
    print(f"  SCENARIO RESULTS  —  {len(scenarios)} scenario(s)  [{elapsed:.1f}s]")
    print(_hr())
    for i, sc in enumerate(scenarios, 1):
        print(
            f"\n  [{i}] {sc.get('title', 'Untitled')}  "
            f"(duration={sc.get('duration', '?')}, "
            f"people={sc.get('peopleCount', '?')}, "
            f"likeliness={sc.get('likeliness', '?')})"
        )
        for ev in sc.get("events", []):
            print(f"    {ev.get('timestamp', '?')}  {ev.get('description', '')[:120]}")
    print(_hr())

    _save_json(raw_scenarios, "scenarios", model_name)
    return raw_scenarios


# ── Steps 4a + 4b — foley_agent & speech_agent (parallel) ────────────────────

async def run_foley_and_speech(
    service,
    raw_scenarios: dict,
    furniture_list: dict,
    llm_model: str,
    model_name: str,
) -> tuple[dict, dict]:
    """Run foley_agent and speech_agent concurrently.

    Returns (foley_result, speech_result).
    """
    print(f"\n[4] foley_agent + speech_agent  (parallel, provider={llm_model}) …")
    t0 = time.time()

    foley_task = asyncio.create_task(
        service.async_foley_artist(
            scenarist_agent_result=raw_scenarios,
            furniture_list=furniture_list,
            llm_model=llm_model,
        )
    )
    speech_task = asyncio.create_task(
        service.async_speech_agent(
            scenarist_agent_result=raw_scenarios,
            furniture_list=furniture_list,
            llm_model=llm_model,
        )
    )

    raw_foley, raw_speech = await asyncio.gather(foley_task, speech_task)
    elapsed = time.time() - t0

    # ── Print foley results ──────────────────────────────────────────────
    sounds = raw_foley.get("sounds", [])
    print(f"\n{_hr()}")
    print(f"  FOLEY RESULTS  —  {len(sounds)} sound type(s)  [{elapsed:.1f}s]")
    print(_hr())
    for s in sounds:
        ts = ", ".join(s.get("timestamps", []))
        objs = s.get("objectsInvolved", [])
        print(
            f"  [{s.get('id', '?')}]  {s.get('soundName', 'Untitled')}\n"
            f"    {s.get('description', '')}\n"
            f"    timestamps: {ts or '—'}  |  objects: {len(objs)}"
        )
    print(_hr())
    _save_json(raw_foley, "foley", model_name)

    # ── Print speech results ─────────────────────────────────────────────
    speeches = raw_speech.get("speeches", [])
    print(f"\n{_hr()}")
    print(f"  SPEECH RESULTS  —  {len(speeches)} speech entry(ies)")
    print(_hr())
    for sp in speeches:
        ts = ", ".join(sp.get("timestamps", []))
        print(
            f"  [{sp.get('id', '?')}]  {sp.get('character', '?')}  @{ts}\n"
            f"    {sp.get('script', '')[:200]}"
        )
    print(_hr())
    _save_json(raw_speech, "speech", model_name)

    return raw_foley, raw_speech


# ── Step 5 — orchestrate_agent ────────────────────────────────────────────────

async def run_orchestrate(
    service,
    raw_scenarios: dict,
    raw_foley: dict,
    raw_speech: dict,
    furniture_list: dict,
    llm_model: str,
    model_name: str,
) -> dict:
    """Run orchestrate_agent, print results, save to disk."""
    print(f"\n[5] orchestrate_agent  (provider={llm_model}) …")
    t0 = time.time()
    raw_playlist = await service.async_orchestrate_agent(
        scenarist_agent_result=raw_scenarios,
        foley_result=raw_foley,
        speech_result=raw_speech,
        llm_model=llm_model,
    )
    elapsed = time.time() - t0

    playlist = raw_playlist.get("playlist", [])
    print(f"\n{_hr()}")
    print(f"  ORCHESTRATE RESULTS  —  {len(playlist)} playlist entry(ies)  [{elapsed:.1f}s]")
    print(_hr())
    for entry in playlist:
        trigger = entry.get("trigger", {})
        expr = trigger.get("expression", "")
        delay = trigger.get("delay", 0.0)
        trigger_str = f"{trigger.get('type', '?')}({expr})" + (f" +{delay}s" if delay else "")
        print(
            f"  [{entry.get('id', '?')}]  [{entry.get('category', '?')}]  "
            f"{entry.get('soundName', 'Untitled')}\n"
            f"    trigger: {trigger_str}\n"
            f"    variants: {entry.get('variants', [])}  spl: {entry.get('spl', '?')}  "
            f"duration: {entry.get('duration', '?')}"
        )
    print(_hr())
    _save_json(raw_playlist, "orchestrate", model_name)
    return raw_playlist


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="E2E test: Speckle model → analyze → scenario → foley + speech → orchestrate"
    )
    parser.add_argument("--model-name", default=None,
                        help="Substring to match a Speckle model name (default: first available)")
    parser.add_argument("--provider", choices=["gemini", "openai", "anthropic"], default=None,
                        help="LLM provider (default: DEFAULT_LLM_MODEL from env/constants)")
    parser.add_argument("--context", default=None,
                        help='Optional free-text context, e.g. "open-plan office"')
    parser.add_argument("--base-url", default="http://localhost:8000",
                        help="FastAPI server base URL (default: http://localhost:8000)")
    parser.add_argument("--no-preview", action="store_true",
                        help="Skip model preview fetch (metadata-only analysis)")
    parser.add_argument("--live-screenshot", action="store_true",
                        help="Fetch last browser screenshot from Next.js frontend")
    parser.add_argument("--frontend-url", default="http://localhost:3000",
                        help="Next.js frontend URL (used with --live-screenshot)")
    parser.add_argument("--people-count", type=int, default=5,
                        help="Number of people in the scenario (default: 5)")
    parser.add_argument("--likeliness", type=int, default=9,
                        help="Likeliness score 1–10 (default: 9)")
    parser.add_argument("--duration", type=int, default=150,
                        help="Approximate scenario duration in seconds (default: 150)")
    parser.add_argument(
        "--stop-after",
        choices=["analyze", "scenario", "foley", "speech", "orchestrate"],
        default=None,
        help="Stop the pipeline after the given stage",
    )
    args = parser.parse_args()

    load_env()

    # ── Verify server is reachable ─────────────────────────────────────────────
    try:
        requests.get(_api(args.base_url, "/health"), timeout=5).raise_for_status()
        print(f"Server reachable at {args.base_url}")
    except Exception:
        try:
            requests.get(args.base_url, timeout=5).raise_for_status()
            print(f"Server reachable at {args.base_url}")
        except Exception as exc:
            print(f"\n[ERR] Cannot reach {args.base_url} — is the FastAPI server running?\n  {exc}",
                  file=sys.stderr)
            sys.exit(1)

    # ── Resolve project ────────────────────────────────────────────────────────
    project_id, version_id, model_name = resolve_project_and_version(
        args.base_url, args.model_name
    )

    # ── Fetch Speckle data ─────────────────────────────────────────────────────
    entities = fetch_entities(args.base_url, project_id, version_id)
    if not entities:
        print("\n[ERR] No entities returned — check Speckle auth and model content.", file=sys.stderr)
        sys.exit(1)

    screenshots: list[str] = []
    if not args.no_preview:
        try:
            screenshots.append(fetch_preview(args.base_url, project_id, version_id))
        except Exception as exc:
            print(f"\n  [WARN] Preview fetch failed ({exc}); continuing metadata-only.")

    if args.live_screenshot:
        try:
            screenshots.extend(fetch_live_screenshots(args.frontend_url))
        except Exception as exc:
            print(f"\n  [WARN] Live screenshot fetch failed ({exc}); skipping.")

    # ── Import service ─────────────────────────────────────────────────────────
    from services.llm_service import LLMService
    from config.constants import DEFAULT_LLM_MODEL

    llm_model = args.provider or DEFAULT_LLM_MODEL
    service = LLMService()

    # ── [2] analyze_agent ──────────────────────────────────────────────────────
    furniture_list, _ = run_analyze(
        service, entities, screenshots, args.context, llm_model, model_name
    )
    if args.stop_after == "analyze":
        return

    # ── [3] scenario_agent ─────────────────────────────────────────────────────
    raw_scenarios = run_scenario(
        service, furniture_list, args.context,
        args.people_count, args.likeliness, args.duration,
        llm_model, model_name,
    )
    if args.stop_after == "scenario":
        return

    # ── [4] foley_agent + speech_agent (parallel) ──────────────────────────────
    raw_foley, raw_speech = asyncio.run(
        run_foley_and_speech(service, raw_scenarios, furniture_list, llm_model, model_name)
    )
    if args.stop_after in ("foley", "speech"):
        return

    # ── [5] orchestrate_agent ──────────────────────────────────────────────────
    asyncio.run(
        run_orchestrate(
            service, raw_scenarios, raw_foley, raw_speech,
            furniture_list, llm_model, model_name,
        )
    )


if __name__ == "__main__":
    main()
