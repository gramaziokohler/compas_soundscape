"""Admin tool: copy sound scenes from one user's project into another's.

Server-shell only (direct access to data/ and data/app.db; no HTTP endpoint).
Works for Speckle-model projects and "no-model" Home projects (home-<slug>), in
any direction. The target keeps its existing scenes; the copied ones are added.
Run from backend/:

    python scripts/transfer_scenes.py --list --from-email a@x.com --to-email b@y.com
    python scripts/transfer_scenes.py --from-email a@x.com --from-project "Office" \
        --to-email b@y.com --to-project "Lobby" --dry-run
    python scripts/transfer_scenes.py ... (same, without --dry-run)

Options: --scenes 0,2 (subset, numbers from --list; default = everything),
--from-model-id/--to-model-id (disambiguate), --from-workspace/--to-workspace
(instead of an email, e.g. anonymous dev sessions), --keep-positions, --force.

Not transferred (geometry-bound): simulations, IRs, receivers, grid listeners,
acoustic region. Sounds moved to a different model lose their object links and
are re-placed in front of the camera. The target is zipped to
data/transfer_backups/ before anything is written.

The in-app "Send scenes to another model" action (same workspace) shares the
merge engine (services/scene_transfer_core.py) and the media helpers
(services/scene_transfer_service.py) with this script.
"""

import argparse
import json
import shutil
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Allow `python scripts/transfer_scenes.py` from backend/ (imports config/, services/).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.constants import BACKEND_DIR, REDIS_URL, SANDBOX_MODEL_ID, SOUNDSCAPE_JSON_FILENAME  # noqa: E402
from models.schemas import SoundscapeData  # noqa: E402
from services.metadata_store import ROLE_OWNER, metadata_store, user_hash_for_email  # noqa: E402
from services.paths import user_audio_dir, user_data_dir, user_model_dir  # noqa: E402
from services.scene_transfer_service import plan_audio, write_json_atomic  # noqa: E402
from utils.file_operations import HOME_PROJECT_PREFIX  # noqa: E402
from services.scene_transfer_core import (  # noqa: E402
    apply_audio_renames,
    extract_package,
    list_scenes,
    merge_package,
    package_analysis_files,
    package_audio_files,
)

SOUNDSCAPE_JSON = SOUNDSCAPE_JSON_FILENAME
BACKUP_DIR = BACKEND_DIR / "data" / "transfer_backups"
PRESENCE_WINDOW_S = 60  # services/presence.py PRESENCE_TTL_S
PRESENCE_KEY = "ws:{}:presence"  # services/presence.py _key()
REDIS_TIMEOUT_S = 2


class TransferError(Exception):
    """A user-facing error; printed without a traceback."""


# ── resolution ───────────────────────────────────────────────────────────────


def resolve_workspaces(email: Optional[str], workspace_id: Optional[str], side: str) -> list[dict]:
    """Every workspace to search for this side, owned ones first.

    A user can own several workspaces (older builds created more than one) and be
    a member of others, and a Home project lands in whichever workspace was active
    when it was saved — so all of them are searched, not just the oldest owned one.
    """
    if workspace_id:
        if not user_data_dir(workspace_id).is_dir():
            raise TransferError(f"{side}: no saved data for workspace {workspace_id}")
        ws = metadata_store.get_workspace(workspace_id) or {}
        return [{"id": workspace_id, "name": ws.get("name") or "", "role": ROLE_OWNER}]
    if not email:
        raise TransferError(f"{side}: give --{side}-email or --{side}-workspace")
    user_hash = user_hash_for_email(email)
    if not metadata_store.get_user(user_hash):
        raise TransferError(f"{side}: no user with email {email}")
    workspaces = metadata_store.list_workspaces_for_user(user_hash)
    if not workspaces:
        raise TransferError(f"{side}: {email} belongs to no workspace")
    workspaces.sort(key=lambda w: (w["role"] != ROLE_OWNER, w.get("created_at") or ""))
    return [{"id": w["id"], "name": w.get("name") or "", "role": w["role"]} for w in workspaces]


def project_kind(model_id: str) -> str:
    if model_id.startswith(HOME_PROJECT_PREFIX):
        return "Home"
    if model_id == SANDBOX_MODEL_ID:
        return "Sandbox"  # the unsaved Home scratch project
    return "Speckle"


def list_projects(workspace: dict) -> list[dict]:
    projects = []
    root = user_data_dir(workspace["id"])
    for entry in sorted(root.iterdir()) if root.is_dir() else []:
        json_path = entry / SOUNDSCAPE_JSON
        if not json_path.is_file():
            continue
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            print(f"  ! skipping unreadable {json_path}: {exc}")
            continue
        kind = project_kind(entry.name)
        projects.append(
            {
                "model_id": entry.name,
                "name": data.get("model_name") or entry.name,
                "kind": kind,
                "is_home": kind != "Speckle",
                "workspace": workspace["id"],
                "role": workspace["role"],
                "data": data,
            }
        )
    return projects


def resolve_project(
    workspaces: list[dict], name: Optional[str], model_id: Optional[str], side: str, require_owner: bool
) -> dict:
    if require_owner:
        workspaces = [w for w in workspaces if w["role"] == ROLE_OWNER]
    projects = [p for w in workspaces for p in list_projects(w)]
    if model_id:
        matches = [p for p in projects if p["model_id"] == model_id]
    elif name:
        wanted = name.strip().lower()
        matches = [p for p in projects if p["name"].strip().lower() == wanted or p["model_id"].lower() == wanted]
    else:
        raise TransferError(f"{side}: give --{side}-project or --{side}-model-id")
    if len(matches) == 1:
        return matches[0]
    listing = "\n".join(f"    {p['name']!r}  ({p['model_id']}, ws {p['workspace']})" for p in projects) or "    (none)"
    scope = "owned workspaces" if require_owner else "workspaces"
    if not matches:
        raise TransferError(f"{side}: project {name or model_id!r} not found in the user's {scope}:\n{listing}")
    raise TransferError(
        f"{side}: {len(matches)} projects match {name or model_id!r}; pick one with "
        f"--{side}-workspace + --{side}-model-id:\n"
        + "\n".join(f"    {p['model_id']}  (ws {p['workspace']})" for p in matches)
    )


def print_projects(label: str, workspaces: list[dict]) -> None:
    for w in workspaces:
        projects = list_projects(w)
        print(f"\n{label} — workspace {w['id']} {w['name']!r} [{w['role']}]")
        if not projects:
            print("  (no saved projects)")
        for p in projects:
            scenes = list_scenes(p["data"])
            print(
                f"  {p['name']!r:40} {p['kind']:7} {p['model_id']}  "
                f"{len(scenes)} scene(s), {len(p['data'].get('sound_configs') or [])} sound(s)"
            )
            for s in scenes:
                print(f"      [{s['number']}] {s['title']}  ({s['sound_count']} sounds)")


# ── safety ───────────────────────────────────────────────────────────────────


def target_is_active(workspace_id: str) -> Optional[bool]:
    """True/False from the presence set; None when Redis can't be reached."""
    try:
        import redis  # noqa: PLC0415 - only needed for this check

        client = redis.Redis.from_url(
            REDIS_URL, socket_connect_timeout=REDIS_TIMEOUT_S, socket_timeout=REDIS_TIMEOUT_S
        )
        count = client.zcount(PRESENCE_KEY.format(workspace_id), time.time() - PRESENCE_WINDOW_S, "+inf")
        return count > 0
    except Exception as exc:  # noqa: BLE001 - presence is advisory
        print(f"  ! presence check skipped (Redis unavailable: {exc})")
        return None


def validate(data: dict, label: str) -> dict:
    try:
        return SoundscapeData(**data).model_dump()
    except Exception as exc:  # noqa: BLE001
        raise TransferError(f"{label} soundscape.json is not valid: {exc}") from exc


def backup_target(workspace_id: str, model_id: str) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    zip_path = BACKUP_DIR / f"{stamp}_{workspace_id}_{model_id}.zip"
    model_dir = user_model_dir(workspace_id, model_id)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in model_dir.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(model_dir))
    return zip_path


# ── main ─────────────────────────────────────────────────────────────────────


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for side in ("from", "to"):
        p.add_argument(f"--{side}-email")
        p.add_argument(f"--{side}-workspace", help="workspace id instead of an email")
        p.add_argument(f"--{side}-project", help="project / model name (case-insensitive)")
        p.add_argument(f"--{side}-model-id", help="exact model id (when names are ambiguous)")
    p.add_argument("--scenes", help="comma-separated scene numbers from --list (default: everything)")
    p.add_argument("--list", action="store_true", help="list projects and scenes, then exit")
    p.add_argument("--keep-positions", action="store_true", help="keep source XYZ positions")
    p.add_argument("--dry-run", action="store_true", help="show what would happen; write nothing")
    p.add_argument("--force", action="store_true", help="proceed even if the target user is online")
    return p.parse_args()


def run(args: argparse.Namespace) -> None:
    if args.list:
        if args.from_email or args.from_workspace:
            print_projects("FROM", resolve_workspaces(args.from_email, args.from_workspace, "from"))
        if args.to_email or args.to_workspace:
            print_projects("TO", resolve_workspaces(args.to_email, args.to_workspace, "to"))
        return

    src = resolve_project(
        resolve_workspaces(args.from_email, args.from_workspace, "from"),
        args.from_project, args.from_model_id, "from", require_owner=False,
    )
    # Only write into a workspace the target user owns — never someone else's.
    dst = resolve_project(
        resolve_workspaces(args.to_email, args.to_workspace, "to"),
        args.to_project, args.to_model_id, "to", require_owner=True,
    )
    src_ws, dst_ws = src["workspace"], dst["workspace"]
    if src_ws == dst_ws and src["model_id"] == dst["model_id"]:
        raise TransferError("source and target are the same project")

    source = validate(src["data"], "source")
    target = validate(dst["data"], "target")
    scene_numbers = [int(s) for s in args.scenes.split(",")] if args.scenes else None

    same_model = src["model_id"] == dst["model_id"]
    both_home = src["is_home"] and dst["is_home"]
    strip_entities = not same_model
    reset_positions = not (same_model or both_home or args.keep_positions)

    package = extract_package(source, scene_numbers, strip_entities, reset_positions)
    dst_audio_dir = user_audio_dir(dst_ws, dst["model_id"])
    copies, renames, missing = plan_audio(src_ws, src["model_id"], dst_audio_dir, package_audio_files(package))
    apply_audio_renames(package, renames, missing)
    merged = validate(merge_package(target, package), "merged")
    merged["auth_token"] = target.get("auth_token", "")  # never the source's token

    src_analysis = user_model_dir(src_ws, src["model_id"]) / "analysis"
    dst_analysis = user_model_dir(dst_ws, dst["model_id"]) / "analysis"
    analysis_copies = [n for n in package_analysis_files(package) if (src_analysis / n).is_file()]

    print(f"\nFROM {src['name']!r} ({src['model_id']}, ws {src_ws})")
    print(f"TO   {dst['name']!r} ({dst['model_id']}, ws {dst_ws})")
    print(f"  scenes: {'all' if scene_numbers is None else scene_numbers}")
    print(f"  cards: {len(package['analysis_configs'])}, sounds: {len(package['sound_configs'])}, "
          f"placed events: {len(package['events'])}")
    print(f"  audio files to copy: {len(copies)} (renamed {len(renames)}, missing {len(missing)})")
    for old, new in renames.items():
        print(f"      rename {old} -> {new}")
    for name in sorted(missing):
        print(f"      MISSING {name} (reference cleared)")
    print(f"  analysis files to copy: {len(analysis_copies)}")
    if package["dropped_events"]:
        print(f"  orphan events skipped (no matching card): {package['dropped_events']}")
    print(f"  object links: {'kept (same model)' if not strip_entities else 'removed'}; "
          f"positions: {'reset to camera-front' if reset_positions else 'kept'}")
    print("  not transferred: simulations, IRs, receivers, grid listeners, acoustic region")

    if args.dry_run:
        print("\nDry run — nothing written.")
        return

    active = target_is_active(dst_ws)
    if active and not args.force:
        raise TransferError(
            "the target workspace is in use right now (someone has it open). Ask them to close "
            "the tab, or re-run with --force (their autosave may then conflict)."
        )

    backup = backup_target(dst_ws, dst["model_id"])
    dst_audio_dir.mkdir(parents=True, exist_ok=True)
    for dest_name, source_path in copies.items():
        shutil.copy2(source_path, dst_audio_dir / dest_name)
    if analysis_copies:
        dst_analysis.mkdir(parents=True, exist_ok=True)
        for name in analysis_copies:
            if not (dst_analysis / name).exists():
                shutil.copy2(src_analysis / name, dst_analysis / name)
    write_json_atomic(user_model_dir(dst_ws, dst["model_id"]) / SOUNDSCAPE_JSON, merged)

    metadata_store.link_model(dst["model_id"], dst_ws)
    revision = metadata_store.bump_revision(dst_ws)

    print(f"\nDone. Target revision is now {revision}.")
    print(f"Backup: {backup}")
    print("Undo: delete the target model folder's contents and extract the backup zip into it:")
    print(f"  {user_model_dir(dst_ws, dst['model_id'])}")
    print("The target user should open (or reload) the project to see the scenes.")


def main() -> int:
    try:
        run(parse_args())
    except TransferError as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
