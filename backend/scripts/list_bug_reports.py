"""Print recent in-app bug reports from data/app.db.

Usage (from backend/):
    python scripts/list_bug_reports.py                # 20 most recent
    python scripts/list_bug_reports.py -n 100 --status open
    python scripts/list_bug_reports.py --full         # include diagnostics context JSON
"""

import argparse
import json
import sys
from pathlib import Path

# Allow `python scripts/list_bug_reports.py` from backend/ (imports config/, services/).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.constants import BUG_REPORTS_DIR  # noqa: E402
from services.metadata_store import metadata_store  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-n", "--limit", type=int, default=20, help="number of reports (default 20)")
    parser.add_argument("--status", default=None, help="filter by status (e.g. open)")
    parser.add_argument("--full", action="store_true", help="print the diagnostics context JSON")
    args = parser.parse_args()

    metadata_store.init_db()
    reports = metadata_store.list_bug_reports(limit=args.limit, status=args.status)
    if not reports:
        print("No bug reports.")
        return

    for r in reports:
        print("=" * 80)
        print(f"#{r['id'][:8]}  {r['created_at']}  [{r['category']}]  status={r['status']}")
        print(f"user: {r['user_email'] or r['user_hash'] or 'anonymous'}  workspace: {r['workspace_id'] or '-'}")
        print(f"url: {r['page_url'] or '-'}  model: {r['model_id'] or '-'}  app: {r['app_version'] or '-'}")
        if r["screenshot_path"]:
            print(f"screenshot: {BUG_REPORTS_DIR / r['screenshot_path']}")
        print("-" * 80)
        print(r["description"])
        if args.full:
            print("-" * 80)
            print(json.dumps(json.loads(r["context"]), indent=2))
    print("=" * 80)
    print(f"{len(reports)} report(s)")


if __name__ == "__main__":
    main()
