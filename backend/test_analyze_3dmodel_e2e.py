"""
End-to-end integration test for the 3D model analysis pipeline.

Fetches REAL entity metadata and a model preview from a live Speckle model via
the two new API endpoints, then runs analyze_3dmodel() through the full
async task queue.

The project ID and model/version are resolved automatically from the backend's
configured Speckle service — no need to supply them manually.

Usage
-----
    # use the first available model
    python test_analyze_3dmodel_e2e.py

    # choose LLM provider
    python test_analyze_3dmodel_e2e.py --provider gemini

    # pick a specific model by name (substring match)
    python test_analyze_3dmodel_e2e.py --model-name "MyModel"

    # skip model preview (metadata-only analysis)
    python test_analyze_3dmodel_e2e.py --no-preview

    # include live browser screenshot captured from the frontend
    python test_analyze_3dmodel_e2e.py --live-screenshot

    # point at a different server
    python test_analyze_3dmodel_e2e.py --base-url http://localhost:8001

The script requires the FastAPI server to be running (default: http://localhost:8000).
For --live-screenshot, the Next.js dev server must also be running (default: http://localhost:3000).
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_env() -> None:
    """Load .env then .env.local from backend/ and repo root (absolute paths).

    Using absolute paths means the test can be run from any working directory
    and still find the credentials — unlike relative load_dotenv calls which
    depend on CWD.  The non-streaming path is immune to this because it talks
    to the already-running uvicorn process, which has its env loaded at startup.
    """
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


# ── Step functions ────────────────────────────────────────────────────────────

def resolve_project_and_version(base_url: str, model_name_hint: str | None = None) -> tuple[str, str, str]:
    """
    Resolve project_id and version_id automatically from the backend's
    configured Speckle service via GET /api/speckle/models.

    Returns (project_id, version_id, model_name).
    """
    print("\n[0/4] Resolving Speckle project and model from server …")
    url = _api(base_url, "/api/speckle/models")
    result = get_json(url)

    project_id = result.get("project_id") or ""
    models = result.get("models") or []

    if not models:
        print("✗ No models found in the configured Speckle project.", file=sys.stderr)
        sys.exit(1)

    # Pick model: substring match on name, otherwise first available
    chosen = None
    if model_name_hint:
        hint_lower = model_name_hint.lower()
        for m in models:
            if hint_lower in (m.get("name") or "").lower():
                chosen = m
                break
        if not chosen:
            print(
                f"  ⚠  No model matched '{model_name_hint}'; using first available model.",
            )

    if not chosen:
        chosen = models[0]

    model_name = chosen.get("name", chosen.get("id", "unknown"))
    latest     = chosen.get("latest_version") or {}
    version_id = latest.get("id") or chosen.get("id")

    if not version_id:
        print(
            f"✗ Could not determine a version ID for model '{model_name}'.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"      project_id  = {project_id}")
    print(f"      model       = {model_name!r}  (id: {chosen['id']})")
    print(f"      version_id  = {version_id}")
    print(f"      ({len(models)} model(s) available in project)")
    return project_id, version_id, model_name


def fetch_entities(base_url: str, project_id: str, version_id: str) -> list:
    """Call POST /api/speckle/model-entities and return the entity list."""
    print(f"\n[1/4] Fetching entity metadata from Speckle …")
    url = _api(base_url, "/api/speckle/model-entities")
    result = post_json(url, {"project_id": project_id, "version_id": version_id})
    entities = result.get("entities", [])
    print(f"      ✓ {len(entities)} entities received")
    if entities:
        # Print first 5 as preview
        for e in entities[:5]:
            layer    = e.get("layer")    or "—"
            material = e.get("material") or "—"
            print(f"        #{e['index']}  {e['name']!r}  [{e['speckle_type']}]  layer={layer}  mat={material}")
        if len(entities) > 5:
            print(f"        … and {len(entities) - 5} more")
    return entities


def fetch_preview(base_url: str, project_id: str, version_id: str) -> str:
    """Call POST /api/speckle/model-preview and return a base64 data URI."""
    print(f"\n[2/4] Fetching model preview from Speckle …")
    url = _api(base_url, "/api/speckle/model-preview")
    result = post_json(url, {"project_id": project_id, "version_id": version_id})
    preview = result.get("preview", "")
    snippet = preview[:60] + "…" if len(preview) > 60 else preview
    print(f"      ✓ model preview fetched: {snippet}")
    return preview


def fetch_live_screenshots(frontend_url: str) -> list[str]:
    """Fetch all browser-captured screenshots from GET /api/screenshot (Next.js)."""
    print(f"\n[2b] Fetching live browser screenshots from Next.js …")
    url = frontend_url.rstrip("/") + "/api/screenshot"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    result = resp.json()
    images = result.get("images", [])
    if not images:
        raise ValueError("No images returned from GET /api/screenshot")
    print(f"      ✓ {len(images)} live screenshot(s) fetched")
    return images


# ── Presentation ──────────────────────────────────────────────────────────────

def print_results(result: dict) -> None:
    objects          = result.get("objects", [])
    high_confidence  = result.get("high_confidence", [])
    low_confidence   = result.get("low_confidence", [])

    total = len(objects)
    print(f"\n{'='*70}")
    print(f"  ANALYSIS RESULTS  —  {total} objects identified")
    print(f"{'='*70}")

    if high_confidence:
        print(f"\n  HIGH CONFIDENCE  (> 0.7)  [{len(high_confidence)} objects]")
        print(f"  {'Name':<30}  {'Qty':>4}  {'Conf':>5}  Material")
        print(f"  {'-'*60}")
        for obj in high_confidence:
            print(
                f"  {obj['name']:<30}  {obj['quantity']:>4}  {obj['confidence']:>5.2f}  "
                f"{obj.get('material') or '—'}"
            )

    if low_confidence:
        print(f"\n  LOW CONFIDENCE  (<= 0.7)  [{len(low_confidence)} objects]")
        print(f"  {'Name':<30}  {'Qty':>4}  {'Conf':>5}  Material")
        print(f"  {'-'*60}")
        for obj in low_confidence:
            print(
                f"  {obj['name']:<30}  {obj['quantity']:>4}  {obj['confidence']:>5.2f}  "
                f"{obj.get('material') or '—'}"
            )

    print(f"\n{'='*70}")
    print("\nFull JSON result:\n")
    print(json.dumps(result, indent=2))


def save_results_json(
    result: dict,
    model_name: str,
    entities: list,
    output_path: str | None = None,
) -> str:
    """Write high-confidence objects + model metadata to a JSON file.

    Structure
    ---------
    {
      "meta": { model info, room bounding box, counts, … },
      "high_confidence_objects": [ { …, "object_ids": […] }, … ]
    }

    Returns the path of the written file.
    """

    high_confidence = result.get("high_confidence", [])
    # low_confidence  = result.get("low_confidence",  [])
    # objects         = result.get("objects",         [])

    # ── Compute overall bounding box from entity bounds ──────────────────
    total_bounds: dict | None = None
    try:
        xs_min, ys_min, zs_min = [], [], []
        xs_max, ys_max, zs_max = [], [], []
        for entity in entities:
            bounds = entity.get("bounds")
            if not bounds:
                continue
            mn = bounds.get("min") or []
            mx = bounds.get("max") or []
            if len(mn) >= 3 and len(mx) >= 3:
                xs_min.append(mn[0]); ys_min.append(mn[1]); zs_min.append(mn[2])
                xs_max.append(mx[0]); ys_max.append(mx[1]); zs_max.append(mx[2])
        if xs_min:
            min_x, min_y, min_z = min(xs_min), min(ys_min), min(zs_min)
            max_x, max_y, max_z = max(xs_max), max(ys_max), max(zs_max)
            total_bounds = {
                "width":  round(max_x - min_x, 3),
                "depth":  round(max_y - min_y, 3),
                "height": round(max_z - min_z, 3),
                }
            
    except Exception:
        pass

    # ── Build output document ────────────────────────────────────────────
    output: dict = {
        "meta": {
            "model_name":            model_name,
            **({"total_bounds": total_bounds} if total_bounds else {}),
        },
        "architectural_objects": [
            {
                "name":        obj["name"],
                "description":        obj["description"],
                "material":    obj.get("material", ""),
                "quantity":    obj["quantity"],
                "object_ids":  obj.get("object_ids", []),
            }
            for obj in high_confidence
        ],
    }

    # ── Resolve output path ──────────────────────────────────────────────
    if output_path is None:
        safe_name  = "".join(c if (c.isalnum() or c in "-_") else "_" for c in model_name)
        timestamp  = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = os.path.join(_THIS_DIR, f"analysis_{safe_name}_{timestamp}.json")

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)

    print(f"\n  ✓ Results saved → {output_path}")
    return output_path


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="End-to-end test: Speckle entities + model preview → analyze_3dmodel()"
    )
    parser.add_argument(
        "--model-name",
        default=None,
        help=(
            "Optional substring to match a model name in the project "
            "(default: uses the first available model)"
        ),
    )
    parser.add_argument(
        "--provider",
        choices=["gemini", "openai", "anthropic"],
        default=None,
        help="LLM provider (default: uses DEFAULT_LLM_MODEL from env/constants)",
    )
    parser.add_argument(
        "--context",
        default=None,
        help='Optional free-text context for the analysis, e.g. "open-plan office"',
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of the running FastAPI server (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--no-preview",
        action="store_true",
        help="Skip model preview fetch and run metadata-only analysis",
    )
    parser.add_argument(
        "--live-screenshot",
        action="store_true",
        help="Fetch the last browser-captured screenshot from the Next.js frontend and include it in the analysis",
    )
    parser.add_argument(
        "--frontend-url",
        default="http://localhost:3000",
        help="Base URL of the Next.js frontend (used with --live-screenshot, default: http://localhost:3000)",
    )
    parser.add_argument(
        "--scenario-ids",
        type=int,
        nargs="+",
        default=None,
        help="Indices (0-based) of scenarios to process for foley (default: all scenarios)",
    )
    parser.add_argument(
        "--max-sounds",
        type=int,
        default=20,
        help="Maximum number of sound events for the foley artist (default: 20)",
    )
    args = parser.parse_args()

    load_env()

    # ── Verify server is reachable ────────────────────────────────────────────
    try:
        resp = requests.get(_api(args.base_url, "/health"), timeout=5)
        resp.raise_for_status()
        print(f"Server reachable at {args.base_url}")
    except Exception:
        try:
            requests.get(args.base_url, timeout=5).raise_for_status()
            print(f"Server reachable at {args.base_url}")
        except Exception as exc:
            print(
                f"\n✗ Cannot reach {args.base_url} — is the FastAPI server running?\n  {exc}",
                file=sys.stderr,
            )
            sys.exit(1)

    # ── Auto-resolve project and version from backend ─────────────────────────
    project_id, version_id, model_name = resolve_project_and_version(
        args.base_url, args.model_name
    )

    # ── Run pipeline ──────────────────────────────────────────────────────────
    entities = fetch_entities(args.base_url, project_id, version_id)

    if not entities:
        print("\n✗ No entities returned — check Speckle auth and model content.", file=sys.stderr)
        sys.exit(1)

    preview: str | None = None
    if not args.no_preview:
        try:
            preview = fetch_preview(args.base_url, project_id, version_id)
        except Exception as exc:
            print(f"\n  ⚠  Model preview fetch failed ({exc}); continuing metadata-only.")

    extra_screenshots: list[str] = []
    if args.live_screenshot:
        try:
            extra_screenshots.extend(fetch_live_screenshots(args.frontend_url))
        except Exception as exc:
            print(f"\n  ⚠  Live screenshots fetch failed ({exc}); skipping.")

    # Collect screenshots list
    screenshots: list[str] = []
    if preview:
        screenshots.append(preview)
    if extra_screenshots:
        screenshots.extend(extra_screenshots)

    # ── Direct analysis call ──────────────────────────────────────────────────
    from services.llm_service import LLMService
    from services.model_analysis_worker import _normalize_objects
    from config.constants import DEFAULT_LLM_MODEL

    llm_model = args.provider or DEFAULT_LLM_MODEL
    service = LLMService()
    print(f"\n[3/5] Running analyze_3dmodel (provider={llm_model}, entities={len(entities)}, screenshots={len(screenshots)}) …")
    raw = service.analyze_3dmodel(
        entities=entities,
        screenshots=screenshots or None,
        user_context=args.context,
        llm_model=llm_model,
    )
    objects = _normalize_objects(raw.get("objects", []))
    high = [o for o in objects if o["confidence"] > 0.7]
    low  = [o for o in objects if o["confidence"] <= 0.7]
    result = {"objects": objects, "high_confidence": high, "low_confidence": low}
    print_results(result)
    json_path = save_results_json(result, model_name, entities)

    print(f"\n[4/5] Running scenarist_agent (provider={llm_model}) …")
    with open(json_path, encoding="utf-8") as fh:
        furniture_list = json.load(fh)
    raw_scenarios = service.scenarist_agent(
        user_context=args.context,
        llm_model=llm_model,
        furniture_list=furniture_list,
    )
    scenarios = raw_scenarios.get("scenarios", [])
    print(f"\n{'='*70}")
    print(f"  SCENARIST RESULTS  —  {len(scenarios)} scenario(s) generated")
    print(f"{'='*70}")
    for i, sc in enumerate(scenarios, 1):
        print(
            f"\n  [{i}] {sc.get('title', 'Untitled')}  "
            f"(duration={sc.get('duration', '?')}, "
            f"people={sc.get('peopleCount', '?')}, "
            f"likeliness={sc.get('likeliness', '?')})"
        )
        for ev in sc.get("events", []):
            print(f"    {ev.get('timestamp', '?')}  {ev.get('description', '')}")
    print(f"\n{'='*70}")
    print("\nFull JSON result:\n")
    print(json.dumps(raw_scenarios, indent=2))
    safe_name  = "".join(c if (c.isalnum() or c in "-_") else "_" for c in model_name)
    timestamp  = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path   = os.path.join(_THIS_DIR, f"scenarios_{safe_name}_{timestamp}.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(raw_scenarios, fh, indent=2, ensure_ascii=False)
    print(f"\n  ✓ Scenarios saved → {out_path}")

    print(f"\n[5/5] Running foley_artist (provider={llm_model}, max_sounds={args.max_sounds}) …")
    raw_foley = service.foley_artist(
        scenarist_agent_result=raw_scenarios,
        furniture_list=furniture_list,
        scenario_ids=args.scenario_ids,
        maximum_number_of_sounds=args.max_sounds,
        llm_model=llm_model,
    )
    foley_scenarios = raw_foley.get("scenarios", [])
    total_events = sum(len(s.get("sound_events", [])) for s in foley_scenarios)
    print(f"\n{'='*70}")
    print(f"  FOLEY ARTIST RESULTS  —  {len(foley_scenarios)} scenario(s), {total_events} total sound event(s)")
    print(f"{'='*70}")
    for i, sc in enumerate(foley_scenarios, 1):
        sound_events = sc.get("sound_events", [])
        print(f"\n  [{i}] {sc.get('scenario_title', 'Untitled')}  ({len(sound_events)} sound event(s))")
        for ev in sound_events:
            print(
                f"    [{ev.get('category', '?')}] {ev.get('soundName', 'Untitled')}  "
                f"(duration={ev.get('duration', '?')}, spl={ev.get('spl', '?')})"
            )
            print(f"      {ev.get('description', '')}")
            if ev.get("timestamps"):
                print(f"      Timestamps: {', '.join(ev.get('timestamps', []))}")
            if ev.get("objectsInvolved"):
                print(f"      Objects: {ev.get('objectsInvolved', [])}")
    print(f"\n{'='*70}")
    print("\nFull JSON result:\n")
    print(json.dumps(raw_foley, indent=2))
    safe_name  = ".".join(c if (c.isalnum() or c in "-_") else "_" for c in model_name)
    timestamp  = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    foley_path = os.path.join(_THIS_DIR, f"foley_{safe_name}_{timestamp}.json")
    with open(foley_path, "w", encoding="utf-8") as fh:
        json.dump(raw_foley, fh, indent=2, ensure_ascii=False)
    print(f"\n  ✓ Foley events saved → {foley_path}")


if __name__ == "__main__":
    main()
