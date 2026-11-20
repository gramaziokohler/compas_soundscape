"""Incremental backups of everything needed to rebuild every model from its Speckle version.

A Speckle version is immutable, so a model is rebuilt from the Speckle reference in its
``soundscape.json`` (``project_id`` / ``version_id``) plus the app's own data:

    soundscapes/<workspace>/<model>/   soundscape.json, audio/, ir_files/, analysis/, results
    directivities/                     the per-user directivity library (+ presets)
    bug_reports/                       screenshots (rows live in app.db)
    study/                             study_log.db, audio/, moments/
    app.db                             users, workspaces, members, shares, materials, ...

``temp/`` is not backed up: loading a soundscape copies its IRs back from ``ir_files/``.
Neither are the ML weights (``data/models``, ``data/tfhub_modules``), which are downloadable.

Each snapshot is a full directory tree, but files unchanged since the previous snapshot are
NTFS hardlinks to it, so a snapshot only costs the changed bytes and restoring is a plain
copy. SQLite databases are copied with the online backup API, so they are consistent even
while the API writes.

``run`` decides whether a backup is due (meant for a nightly scheduled task):
  - no snapshot yet                                  -> back up
  - nothing changed                                  -> skip
  - a soundscape.json / app.db / results / balloon changed (small, but it IS the state)
                                                     -> back up
  - changed bytes >= --min-change-mb (audio, IRs)    -> back up
  - anything changed and the last snapshot is older than --max-age-days -> back up
  - otherwise                                        -> skip; the change accumulates
Old snapshots are pruned grandfather-father-son (daily / weekly / monthly).

Usage (from backend/, any env: stdlib only):
  python scripts/backup_data.py run [--dest DIR] [--force] [--dry-run]
  python scripts/backup_data.py offsite --to DIR [--include-study]
  python scripts/backup_data.py list | status [--json]
  python scripts/backup_data.py restore latest --model <model_id> [--workspace <ws>] [--in-place]
  python scripts/backup_data.py restore <snapshot> [--to DIR]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

# Allow `python scripts/backup_data.py` from backend/ (imports config/).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config.constants as C  # noqa: E402

SNAPSHOTS = "snapshots"
MANIFEST = "manifest.json"
CATALOG = "models.json"
LAST_RUN = "last-run.json"
LOG_FILE = "backup.log"
SNAPSHOT_FMT = "%Y%m%d-%H%M%S"
MB = 1024 * 1024

log = logging.getLogger("backup")


# --------------------------------------------------------------------------- helpers

def _setup_logging(dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.INFO)
    for handler in (logging.StreamHandler(sys.stdout), logging.FileHandler(dest / LOG_FILE, encoding="utf-8")):
        handler.setFormatter(fmt)
        log.addHandler(handler)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(MB), b""):
            h.update(chunk)
    return h.hexdigest()


def _fmt_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _make_writable(path: Path) -> None:
    try:
        os.chmod(path, stat.S_IREAD | stat.S_IWRITE)
    except OSError:
        pass


def _rmtree(path: Path) -> None:
    """rmtree that clears the read-only bit snapshot files carry."""
    def _onerror(func, p, _exc):  # noqa: ANN001
        _make_writable(Path(p))
        func(p)
    shutil.rmtree(path, onerror=_onerror)


def _snapshot_dirs(dest: Path) -> list[Path]:
    root = dest / SNAPSHOTS
    if not root.is_dir():
        return []
    out = []
    for p in root.iterdir():
        if p.is_dir() and (p / MANIFEST).is_file():
            try:
                datetime.strptime(p.name, SNAPSHOT_FMT)
            except ValueError:
                continue
            out.append(p)
    return sorted(out, key=lambda p: p.name)


def _load_manifest(snapshot: Path) -> dict:
    with open(snapshot / MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def _resolve_snapshot(dest: Path, name: str) -> Path:
    snaps = _snapshot_dirs(dest)
    if not snaps:
        raise SystemExit(f"No snapshots in {dest / SNAPSHOTS}")
    if name == "latest":
        return snaps[-1]
    matches = [s for s in snaps if s.name.startswith(name)]
    if len(matches) != 1:
        raise SystemExit(f"Snapshot '{name}' matches {len(matches)} snapshots; use `list`.")
    return matches[0]


# --------------------------------------------------------------------------- scan

@dataclass
class Entry:
    rel: str               # posix path inside the snapshot
    src: Path              # live file (or staged DB copy)
    size: int
    mtime_ns: int          # 0 for databases (compared by hash instead)
    sha256: str | None = None
    is_db: bool = False


def _excluded(name: str) -> bool:
    return name.endswith(C.BACKUP_EXCLUDE_SUFFIXES)


def _scan_trees() -> dict[str, Entry]:
    entries: dict[str, Entry] = {}
    for prefix, root in C.BACKUP_TREE_SOURCES:
        root = Path(root)
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(C.BACKUP_EXCLUDE_DIR_PREFIXES)]
            for name in filenames:
                if _excluded(name):
                    continue
                path = Path(dirpath) / name
                try:
                    st = path.stat()
                except OSError:
                    continue  # deleted while scanning
                rel = f"{prefix}/{path.relative_to(root).as_posix()}"
                entries[rel] = Entry(rel, path, st.st_size, st.st_mtime_ns)
    return entries


def _stage_databases(staging: Path) -> dict[str, Entry]:
    """Consistent copies of the SQLite files (online backup API), hashed for change detection."""
    entries: dict[str, Entry] = {}
    for rel, src in C.BACKUP_SQLITE_SOURCES:
        src = Path(src)
        if not src.is_file():
            continue
        out = staging / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        source = sqlite3.connect(str(src), timeout=30)
        target = sqlite3.connect(str(out))
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        entries[rel] = Entry(rel, out, out.stat().st_size, 0, _db_fingerprint(out), is_db=True)
    return entries


def _db_fingerprint(path: Path) -> str:
    """Hash of the rows, not the file: two backups of an unchanged DB differ byte-wise.

    Tables in BACKUP_SQLITE_VOLATILE_TABLES (login sessions' last_seen) are left out, so
    a user merely visiting does not count as a change; they are still in every snapshot.
    """
    h = hashlib.sha256()
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        tables = [t for (t,) in con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        for table in tables:
            if table in C.BACKUP_SQLITE_VOLATILE_TABLES:
                continue
            h.update(f"\0{table}\0".encode())
            for row in con.execute(f'SELECT * FROM "{table}" ORDER BY 1'):
                h.update(repr(row).encode("utf-8", "surrogatepass"))
    finally:
        con.close()
    return h.hexdigest()


def _is_critical(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    return name in C.BACKUP_CRITICAL_NAMES or name.endswith(C.BACKUP_CRITICAL_SUFFIXES)


@dataclass
class Diff:
    added: list[str] = field(default_factory=list)
    modified: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    changed_bytes: int = 0
    critical: list[str] = field(default_factory=list)

    @property
    def any(self) -> bool:
        return bool(self.added or self.modified or self.deleted)


def _diff(current: dict[str, Entry], prev_files: dict[str, list]) -> Diff:
    d = Diff()
    for rel, e in current.items():
        p = prev_files.get(rel)
        if p is None:
            d.added.append(rel)
        elif (e.is_db and p[2] != e.sha256) or (not e.is_db and (p[0] != e.size or p[1] != e.mtime_ns)):
            d.modified.append(rel)
        else:
            continue
        d.changed_bytes += e.size
        if _is_critical(rel):
            d.critical.append(rel)
    for rel in prev_files.keys() - current.keys():
        d.deleted.append(rel)
        d.changed_bytes += prev_files[rel][0]
        if _is_critical(rel):
            d.critical.append(rel)
    return d


# --------------------------------------------------------------------------- snapshot

def _copy_live(e: Entry, dst: Path) -> bool:
    """Copy a live file; retry while it changes under us (soundscape.json is rewritten in place)."""
    for attempt in range(C.BACKUP_JSON_RETRIES):
        try:
            shutil.copy2(e.src, dst)
            after = e.src.stat()
        except FileNotFoundError:
            return False
        stable = after.st_size == dst.stat().st_size and after.st_mtime_ns == dst.stat().st_mtime_ns
        valid = True
        if dst.suffix == ".json":
            try:
                with open(dst, encoding="utf-8") as f:
                    json.load(f)
            except (ValueError, UnicodeDecodeError):
                valid = False
        if stable and valid:
            e.size, e.mtime_ns = after.st_size, after.st_mtime_ns
            return True
        time.sleep(C.BACKUP_JSON_RETRY_DELAY_S * (attempt + 1))
    log.warning("%s kept changing or is not valid JSON; stored the last copy", e.rel)
    e.size, e.mtime_ns = dst.stat().st_size, dst.stat().st_mtime_ns
    return True


def _write_catalog(snapshot: Path) -> list[dict]:
    """models.json: which Speckle version each saved soundscape was built on (no tokens)."""
    owners: dict[str, dict] = {}
    db = snapshot / "app.db"
    if db.is_file():
        con = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
        try:
            for ws_id, ws_name, email in con.execute(
                "SELECT w.id, w.name, u.email FROM workspaces w LEFT JOIN users u ON u.user_hash = w.owner_hash"
            ):
                owners[ws_id] = {"workspace_name": ws_name, "owner_email": email}
        except sqlite3.Error as exc:
            log.warning("Could not read workspaces from app.db: %s", exc)
        finally:
            con.close()

    models = []
    for path in sorted((snapshot / "soundscapes").glob("*/*/soundscape.json")):
        ws, model_dir = path.parent.parent.name, path.parent.name
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError) as exc:
            log.warning("Unreadable %s: %s", path, exc)
            continue
        size = sum(p.stat().st_size for p in path.parent.rglob("*") if p.is_file())
        models.append({
            "workspace_id": ws,
            **owners.get(ws, {}),
            "model_dir": model_dir,
            "model_id": data.get("model_id"),
            "model_name": data.get("model_name"),
            "speckle_server": C.SPECKLE_SERVER_URL,
            "speckle_project_id": data.get("project_id"),
            "speckle_version_id": data.get("version_id"),
            "created_at": data.get("created_at"),
            "sound_configs": len(data.get("sound_configs") or []),
            "sound_events": len(data.get("sound_events") or []),
            "receivers": len(data.get("receivers") or []),
            "simulations": len(data.get("simulation_configs") or []),
            "bytes": size,
        })
    with open(snapshot / CATALOG, "w", encoding="utf-8") as f:
        json.dump({"snapshot": snapshot.name, "models": models}, f, indent=2, ensure_ascii=False)
    return models


def _create_snapshot(dest: Path, current: dict[str, Entry], prev: Path | None,
                     prev_files: dict[str, list], diff: Diff, reason: str) -> Path:
    name = datetime.now().strftime(SNAPSHOT_FMT)
    while (dest / SNAPSHOTS / name).exists():  # names have 1 s resolution
        time.sleep(1)
        name = datetime.now().strftime(SNAPSHOT_FMT)
    final = dest / SNAPSHOTS / name
    work = dest / SNAPSHOTS / f"{name}.partial"
    work.mkdir(parents=True)
    changed = set(diff.added) | set(diff.modified)
    files: dict[str, list] = {}
    copied = linked = 0
    for rel in sorted(current):
        e = current[rel]
        dst = work / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if rel not in changed and prev is not None and (prev / rel).is_file():
            try:
                os.link(prev / rel, dst)
            except OSError:  # other volume, or the 1023-link limit
                shutil.copy2(prev / rel, dst)
            files[rel] = prev_files[rel]
            linked += e.size
            continue
        if e.is_db:
            shutil.move(str(e.src), dst)
        elif not _copy_live(e, dst):
            log.warning("%s disappeared before it was copied; skipped", rel)
            continue
        e.sha256 = e.sha256 or _sha256(dst)
        files[rel] = [e.size, e.mtime_ns, e.sha256]
        copied += e.size
    # Snapshot files are hardlinked into later snapshots: make them read-only so an
    # accidental in-place edit cannot silently change every snapshot at once.
    for rel in files:
        if rel in changed or prev is None:
            os.chmod(work / rel, stat.S_IREAD)
    manifest = {
        "snapshot": name,
        "created": datetime.now().isoformat(timespec="seconds"),
        "reason": reason,
        "previous": prev.name if prev else None,
        "copied_bytes": copied,
        "linked_bytes": linked,
        "added": len(diff.added), "modified": len(diff.modified), "deleted": len(diff.deleted),
        "files": files,
    }
    with open(work / MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    models = _write_catalog(work)
    work.rename(final)
    log.info("Snapshot %s: %d files, %d models, copied %s, linked %s",
             name, len(files), len(models), _fmt_bytes(copied), _fmt_bytes(linked))
    return final


def _prune(dest: Path, keep_daily: int, keep_weekly: int, keep_monthly: int) -> list[str]:
    snaps = _snapshot_dirs(dest)
    if not snaps:
        return []
    keep = {snaps[-1].name}
    for key_fn, count in (
        (lambda d: d.date(), keep_daily),
        (lambda d: d.isocalendar()[:2], keep_weekly),
        (lambda d: (d.year, d.month), keep_monthly),
    ):
        seen: list = []
        for s in reversed(snaps):  # newest first: the newest snapshot of each period wins
            k = key_fn(datetime.strptime(s.name, SNAPSHOT_FMT))
            if k in seen:
                continue
            if len(seen) >= count:
                break
            seen.append(k)
            keep.add(s.name)
    removed = []
    for s in snaps:
        if s.name not in keep:
            _rmtree(s)
            removed.append(s.name)
    if removed:
        log.info("Pruned %d old snapshot(s): %s", len(removed), ", ".join(removed))
    return removed


# --------------------------------------------------------------------------- commands

def cmd_run(args: argparse.Namespace) -> int:
    dest: Path = args.dest
    _setup_logging(dest)
    started = time.time()
    result: dict = {"time": datetime.now().isoformat(timespec="seconds"), "dest": str(dest)}
    staging = dest / ".staging"
    try:
        for leftover in [staging, *(dest / SNAPSHOTS).glob("*.partial")]:
            if leftover.exists():
                _rmtree(leftover)
        staging.mkdir(parents=True)

        snaps = _snapshot_dirs(dest)
        prev = snaps[-1] if snaps else None
        prev_manifest = _load_manifest(prev) if prev else {}
        prev_files: dict[str, list] = prev_manifest.get("files", {})

        current = _scan_trees()
        current.update(_stage_databases(staging))
        diff = _diff(current, prev_files)
        total = sum(e.size for e in current.values())
        age = (datetime.now() - datetime.strptime(prev.name, SNAPSHOT_FMT)) if prev else None

        if args.force:
            due, reason = True, "forced"
        elif prev is None:
            due, reason = True, "first snapshot"
        elif not diff.any:
            due, reason = False, "no change"
        elif diff.critical:
            due, reason = True, f"{len(diff.critical)} soundscape/metadata file(s) changed"
        elif diff.changed_bytes >= args.min_change_mb * MB:
            due, reason = True, f"{_fmt_bytes(diff.changed_bytes)} changed (>= {args.min_change_mb} MB)"
        elif age is not None and age >= timedelta(days=args.max_age_days):
            due, reason = True, f"last snapshot is {age.days} days old"
        else:
            due, reason = False, f"only {_fmt_bytes(diff.changed_bytes)} of bulk data changed"

        log.info("Scanned %d files (%s): +%d ~%d -%d, %s changed -> %s (%s)",
                 len(current), _fmt_bytes(total), len(diff.added), len(diff.modified), len(diff.deleted),
                 _fmt_bytes(diff.changed_bytes), "BACKUP" if due else "skip", reason)
        result.update(decision="backup" if due else "skip", reason=reason, changed_bytes=diff.changed_bytes,
                      added=len(diff.added), modified=len(diff.modified), deleted=len(diff.deleted),
                      total_bytes=total)

        if due and not args.dry_run:
            free = shutil.disk_usage(dest).free
            if free < diff.changed_bytes * 1.2 + 2 * 1024 * MB:
                raise RuntimeError(f"Only {_fmt_bytes(free)} free on the backup drive")
            snap = _create_snapshot(dest, current, prev, prev_files, diff, reason)
            result["snapshot"] = snap.name
        if not args.dry_run:
            result["pruned"] = _prune(dest, args.keep_daily, args.keep_weekly, args.keep_monthly)
        result["ok"] = True
    except Exception as exc:  # noqa: BLE001 - recorded for `compas status`, then non-zero exit
        log.exception("Backup FAILED: %s", exc)
        result.update(ok=False, error=str(exc))
    finally:
        if staging.exists():
            _rmtree(staging)
    result["duration_s"] = round(time.time() - started, 1)
    if not args.dry_run:
        with open(dest / LAST_RUN, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
    return 0 if result.get("ok") else 1


def cmd_offsite(args: argparse.Namespace) -> int:
    """Mirror the latest snapshot to another drive (e.g. Google Drive) + keep metadata history zips."""
    dest: Path = args.dest
    _setup_logging(dest)
    target: Path = args.to
    if not target.parent.exists():
        log.error("Offsite target %s is not reachable (drive not mounted?)", target)
        return 1
    snap = _resolve_snapshot(dest, "latest")
    mirror = target / "latest"
    mirror.mkdir(parents=True, exist_ok=True)
    cmd = ["robocopy", str(snap), str(mirror), "/MIR", "/R:3", "/W:10", "/NP", "/NFL", "/NDL", "/XJ",
           "/A-:R", "/LOG+:" + str(dest / "offsite-robocopy.log")]
    if not args.include_study:
        cmd += ["/XD", str(snap / "study")]
    log.info("Mirroring %s -> %s", snap.name, mirror)
    code = subprocess.call(cmd)
    if code >= 8:  # robocopy: 0-7 success (with or without copies), >= 8 failure
        log.error("robocopy failed with exit code %d (see offsite-robocopy.log)", code)
        return 1

    # History of the small files that ARE the state, so the offsite copy also has older versions.
    history = target / "history"
    history.mkdir(exist_ok=True)
    zpath = history / f"{snap.name}.zip"
    if not zpath.exists():
        tmp = zpath.with_suffix(".zip.tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for p in snap.rglob("*"):
                rel = p.relative_to(snap).as_posix()
                if p.is_file() and not rel.startswith("study/") and (
                    _is_critical(rel) or p.name in (MANIFEST, CATALOG) or p.suffix == ".json"
                ):
                    z.write(p, rel)
        tmp.replace(zpath)
    zips = sorted(history.glob("*.zip"))
    for old in zips[: max(0, len(zips) - args.history)]:
        old.unlink()
    log.info("Offsite copy of %s done (history: %d zips)", snap.name, min(len(zips), args.history))
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    snaps = _snapshot_dirs(args.dest)
    if not snaps:
        print(f"No snapshots in {args.dest / SNAPSHOTS}")
        return 0
    print(f"{'snapshot':<17} {'files':>7} {'models':>6} {'new data':>10} {'total':>10}  reason")
    for s in snaps:
        m = _load_manifest(s)
        try:
            with open(s / CATALOG, encoding="utf-8") as f:
                n_models = len(json.load(f)["models"])
        except (OSError, ValueError, KeyError):
            n_models = 0
        print(f"{s.name:<17} {len(m['files']):>7} {n_models:>6} {_fmt_bytes(m['copied_bytes']):>10} "
              f"{_fmt_bytes(m['copied_bytes'] + m['linked_bytes']):>10}  {m.get('reason', '')}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    path = args.dest / LAST_RUN
    last = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
    snaps = _snapshot_dirs(args.dest)
    status = {"dest": str(args.dest), "snapshots": len(snaps), "latest": snaps[-1].name if snaps else None,
              "last_run": last}
    if args.json:
        print(json.dumps(status, indent=2))
    else:
        print(f"Backups in {args.dest}: {len(snaps)} snapshot(s), latest {status['latest'] or '-'}")
        if last:
            state = "OK" if last.get("ok") else f"FAILED: {last.get('error')}"
            print(f"Last run {last['time']}: {last.get('decision', '?')} ({last.get('reason', '')}) - {state}")
    return 0 if (last is None or last.get("ok")) else 1


def _copy_out(src: Path, dst: Path) -> int:
    """Real copies (never hardlinks: the app rewrites files in place), writable."""
    n = 0
    for p in [src] if src.is_file() else src.rglob("*"):
        if not p.is_file():
            continue
        out = dst if src.is_file() else dst / p.relative_to(src)
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, out)
        _make_writable(out)
        n += 1
    return n


def cmd_restore(args: argparse.Namespace) -> int:
    snap = _resolve_snapshot(args.dest, args.snapshot)
    stamp = datetime.now().strftime(SNAPSHOT_FMT)
    if args.model or args.workspace:
        base = snap / "soundscapes"
        if args.model:
            pattern = f"{args.workspace or '*'}/{args.model}"
            found = [p for p in base.glob(pattern) if p.is_dir()]
            if len(found) != 1:
                where = ", ".join(p.parent.name for p in found) or "none"
                raise SystemExit(f"Model '{args.model}' found in {len(found)} workspace(s) ({where}); "
                                 "pass --workspace.")
        else:
            found = [base / args.workspace] if (base / args.workspace).is_dir() else []
            if not found:
                raise SystemExit(f"Workspace '{args.workspace}' is not in snapshot {snap.name}.")
        src = found[0]
        rel = src.relative_to(base)
        if args.in_place:
            live = Path(C.SOUNDSCAPE_DATA_DIR) / rel
            if live.exists():
                aside = live.with_name(f"{live.name}.pre-restore-{stamp}")
                live.rename(aside)
                print(f"Live copy moved aside to {aside}")
            n = _copy_out(src, live)
            print(f"Restored {n} files from {snap.name} into {live}. Reload the model in the app.")
            return 0
        target = args.to or (args.dest / "restores" / f"{snap.name}-{stamp}" / "soundscapes" / rel)
        n = _copy_out(src, target)
        print(f"Copied {n} files from {snap.name} to {target}")
        return 0

    if args.in_place:
        raise SystemExit("A full in-place restore replaces app.db under the running API. Restore to a "
                         "folder (omit --in-place), run `compas stop`, copy it over backend/data/, `compas start`.")
    target = args.to or (args.dest / "restores" / f"{snap.name}-{stamp}")
    n = _copy_out(snap, target)
    print(f"Copied {n} files from {snap.name} to {target}")
    print("Layout matches backend/data/ (soundscapes/, directivities/, bug_reports/, study/, app.db).")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dest", type=Path, default=C.BACKUP_DIR, help=f"backup root (default {C.BACKUP_DIR})")
    sub = p.add_subparsers(dest="command", required=True)

    r = sub.add_parser("run", help="take a snapshot if one is due, then prune")
    r.add_argument("--min-change-mb", type=float, default=C.BACKUP_MIN_CHANGE_MB)
    r.add_argument("--max-age-days", type=float, default=C.BACKUP_MAX_AGE_DAYS)
    r.add_argument("--keep-daily", type=int, default=C.BACKUP_KEEP_DAILY)
    r.add_argument("--keep-weekly", type=int, default=C.BACKUP_KEEP_WEEKLY)
    r.add_argument("--keep-monthly", type=int, default=C.BACKUP_KEEP_MONTHLY)
    r.add_argument("--force", action="store_true", help="snapshot even if nothing is due")
    r.add_argument("--dry-run", action="store_true", help="only report what would happen")
    r.set_defaults(func=cmd_run)

    o = sub.add_parser("offsite", help="mirror the latest snapshot to another drive")
    o.add_argument("--to", type=Path, required=True)
    o.add_argument("--history", type=int, default=C.BACKUP_OFFSITE_HISTORY)
    o.add_argument("--include-study", action="store_true", help="also copy study/ (participant data)")
    o.set_defaults(func=cmd_offsite)

    sub.add_parser("list", help="list snapshots").set_defaults(func=cmd_list)
    s = sub.add_parser("status", help="last run result")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_status)

    rs = sub.add_parser("restore", help="restore a snapshot, a workspace or one model")
    rs.add_argument("snapshot", help="snapshot name (prefix ok) or 'latest'")
    rs.add_argument("--model", help="model folder under soundscapes/<workspace>/")
    rs.add_argument("--workspace", help="workspace id")
    rs.add_argument("--to", type=Path, help="target folder (default <dest>/restores/...)")
    rs.add_argument("--in-place", action="store_true",
                    help="replace the live model/workspace folder (moved aside first)")
    rs.set_defaults(func=cmd_restore)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
