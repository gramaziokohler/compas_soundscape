"""Export research-study logs per group, or print a live summary.

Reads data/study/study_log.db (and data/app.db to resolve group owners and
participant emails). Run on the server, from backend/:

    python scripts/export_study_logs.py --summary
    python scripts/export_study_logs.py --out C:\\study_export --groups groups.csv
    python scripts/export_study_logs.py --out exp --since 2026-11-03T08:00 --until 2026-11-03T18:00 --no-audio

groups.csv has a header and either ``workspace_id,group_label`` or
``owner_email,group_label`` columns (several rows may share a label). Without
--groups every workspace with events becomes its own group G1, G2, ... (oldest
first). Explicit labels become folders named ``G-<label>``.

Output: one folder per group (see services/study_export.py) plus top-level
``participants.csv`` (pseudonym, groups) and ``participants_key.csv``
(pseudonym, email — keep it separate from the pseudonymised data).
"""

import argparse
import csv
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Allow `python scripts/export_study_logs.py` from backend/ (imports config/, services/).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config.constants as constants  # noqa: E402
from services.metadata_store import metadata_store, user_hash_for_email  # noqa: E402
from services.study_audio_archive import safe_path_component  # noqa: E402
from services.study_export import export_group, iso  # noqa: E402
from services.study_log_store import now_ms, study_log_store  # noqa: E402

SERVER_PARTICIPANT = "server"


def _parse_iso_ms(value: Optional[str]) -> Optional[int]:
    """ISO date/time → epoch ms (naive values are taken as UTC)."""
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _resolve_groups(groups_csv: Optional[str]) -> dict[str, list[str]]:
    """``{folder_name: [workspace_id, ...]}``."""
    if not groups_csv:
        return {
            f"G{i}": [row["workspace_id"]]
            for i, row in enumerate(study_log_store.workspace_first_seen(), start=1)
        }
    groups: dict[str, list[str]] = {}
    with open(groups_csv, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            label = (row.get("group_label") or "").strip()
            workspace_id = (row.get("workspace_id") or "").strip()
            email = (row.get("owner_email") or "").strip()
            if not workspace_id and email:
                ws = metadata_store.get_owned_workspace(user_hash_for_email(email))
                if ws is None:
                    print(f"warning: no workspace owned by {email} — skipped", file=sys.stderr)
                    continue
                workspace_id = ws["id"]
            if not label or not workspace_id:
                print(f"warning: incomplete groups.csv row {row} — skipped", file=sys.stderr)
                continue
            groups.setdefault(f"G-{safe_path_component(label)}", []).append(workspace_id)
    return groups


class Pseudonyms:
    """user_hash → pseudonym (registers users that never called /config)."""

    def __init__(self) -> None:
        self._map = {p["user_hash"]: p["pseudonym"] for p in study_log_store.list_participants()}

    def __call__(self, user_hash: Optional[str]) -> str:
        if not user_hash:
            return SERVER_PARTICIPANT
        if user_hash not in self._map:
            self._map[user_hash] = study_log_store.register_participant(user_hash) or SERVER_PARTICIPANT
        return self._map[user_hash]


def _dir_size(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file()) if path.exists() else 0


def _print_summary(groups: dict[str, list[str]], pseudonym: Pseudonyms) -> None:
    window_s = constants.STUDY_EXPORT_SUMMARY_WINDOW_S
    counts = study_log_store.event_counts(now_ms() - window_s * 1000)
    ws_to_group = {ws: label for label, wss in groups.items() for ws in wss}
    print(f"Study log: {constants.STUDY_DB_PATH}   (recent = last {window_s // 60} min)")
    print(f"{'group':<14}{'participant':<13}{'recent':>8}{'total':>9}  last event")
    for row in counts:
        group = ws_to_group.get(row["workspace_id"], f"(ws {str(row['workspace_id'])[:8]})")
        print(
            f"{group:<14}{pseudonym(row['user_hash']):<13}{row['recent'] or 0:>8}{row['total']:>9}"
            f"  {iso(row['last_ts'])}"
        )
    study_dir = Path(constants.STUDY_DIR)
    gb = 1024 ** 3
    free = shutil.disk_usage(study_dir if study_dir.exists() else Path(constants.BACKEND_DIR)).free
    print(f"audio archive: {_dir_size(Path(constants.STUDY_AUDIO_DIR)) / gb:.2f} GB   "
          f"moments: {_dir_size(Path(constants.STUDY_MOMENTS_DIR)) / gb:.2f} GB   "
          f"db: {_dir_size(study_dir) / gb:.2f} GB total in {study_dir}")
    guard = "" if free / gb >= constants.STUDY_ARCHIVE_MIN_FREE_GB else "   << BELOW ARCHIVE GUARD"
    print(f"free disk: {free / gb:.1f} GB (archive pauses below {constants.STUDY_ARCHIVE_MIN_FREE_GB} GB){guard}")


def _write_participants(out: Path, groups_by_user: dict[str, set[str]], pseudonym: Pseudonyms) -> None:
    with (out / "participants.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["pseudonym", "group"])
        for user_hash, labels in sorted(groups_by_user.items(), key=lambda kv: pseudonym(kv[0])):
            writer.writerow([pseudonym(user_hash), ";".join(sorted(labels))])
    with (out / "participants_key.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["pseudonym", "email"])
        for user_hash in sorted(groups_by_user, key=pseudonym):
            user = metadata_store.get_user(user_hash)
            writer.writerow([pseudonym(user_hash), user["email"] if user else ""])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", help="output directory (created if missing)")
    parser.add_argument("--groups", help="CSV: workspace_id,group_label or owner_email,group_label")
    parser.add_argument("--since", help="ISO start (inclusive, server time; naive = UTC)")
    parser.add_argument("--until", help="ISO end (exclusive)")
    parser.add_argument("--summary", action="store_true", help="print per-group/participant counts and disk use")
    parser.add_argument("--no-audio", action="store_true", help="write audio_manifest.csv without copying files")
    args = parser.parse_args()

    if not Path(constants.STUDY_DB_PATH).exists():
        print(f"No study log at {constants.STUDY_DB_PATH} (is STUDY_LOGGING_ENABLED set on the server?)")
        return
    metadata_store.init_db()
    groups = _resolve_groups(args.groups)
    pseudonym = Pseudonyms()

    if args.summary:
        _print_summary(groups, pseudonym)
        if not args.out:
            return
    if not args.out:
        parser.error("--out is required unless --summary is given")

    since_ms, until_ms = _parse_iso_ms(args.since), _parse_iso_ms(args.until)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    groups_by_user: dict[str, set[str]] = {}
    for label, workspace_ids in groups.items():
        counts, user_hashes = export_group(
            out / label, workspace_ids, pseudonym, since_ms, until_ms, not args.no_audio
        )
        for user_hash in user_hashes:
            groups_by_user.setdefault(user_hash, set()).add(label)
        print(f"{label}: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    _write_participants(out, groups_by_user, pseudonym)
    print(f"Exported {len(groups)} group(s) to {out.resolve()} in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
