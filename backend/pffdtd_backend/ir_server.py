"""Resident IR server for free positioning -- runs inside the compas-pffdtd env.

    <compas-pffdtd python> -I backend/pffdtd_backend/ir_server.py --parent-pid <pid>

Started once by services/pffdtd_ir_server.py (API process). Reads one JSON request per stdin
line and answers one stdout line each:

    request:  {"id": n, "free_dir": str, "point": int, "fixed": [int, ...], "out_paths": [str, ...]}
    reply:    COMPAS_IR {"id": n, "ok": true, "ms": float}   or   {"id": n, "ok": false, "error": str}

For each fixed index (a source in "listener" mode, a listener in "source" mode) the IR of the
point is composed from the raw store (free_ir.py) and written as a float32 WAV to out_paths[i].
The first line printed is ``COMPAS_IR_READY`` (after warming numba). Exits when the parent dies.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import sys
import time
import traceback
from collections import OrderedDict
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import numpy as np  # noqa: E402
from scipy.io import wavfile  # noqa: E402

from pffdtd_backend.free_ir import AXES, FREE_META, forward_channels, reciprocal_channels, to_wav_ir  # noqa: E402
from pffdtd_backend.pipeline import ParentWatch  # noqa: E402

PREFIX = "COMPAS_IR"
STORE_CACHE = 4  # raw stores kept open (memmaps)
WARM_FS = 20000.0


class Store:
    """One free run's raw store: metadata + memory-mapped run files."""

    def __init__(self, free_dir: Path):
        self.dir = free_dir
        self.meta = json.loads((free_dir / FREE_META).read_text())
        self._runs: dict[str, np.ndarray] = {}

    def run(self, file: str) -> np.ndarray:
        if file not in self._runs:
            self._runs[file] = np.load(self.dir / file, mmap_mode="r")
        return self._runs[file]

    def channels(self, point: int, fixed: int) -> np.ndarray:
        m = self.meta
        runs = [r for r in m["runs"] if r["fixed_index"] == fixed]
        if not runs:
            raise ValueError(f"no run for fixed index {fixed}")
        if m["mode"] == "listener":
            probes = np.asarray(self.run(runs[0]["file"])[point], np.float64)
            return forward_channels(probes, m["Ts"], m["offset_m"], m["c"], m["foa"])
        by_ch = {r["channel"]: np.asarray(self.run(r["file"])[point, 0], np.float64) for r in runs}
        axes = {a: by_ch[a] for a in AXES} if m["foa"] else None
        return reciprocal_channels(by_ch["W"], axes, m["Ts"], m["offset_m"], m["c"])


class Server:
    def __init__(self):
        self.stores: OrderedDict[str, Store] = OrderedDict()

    def store(self, free_dir: str) -> Store:
        if free_dir in self.stores:
            self.stores.move_to_end(free_dir)
        else:
            self.stores[free_dir] = Store(Path(free_dir))
            while len(self.stores) > STORE_CACHE:
                self.stores.popitem(last=False)
        return self.stores[free_dir]

    def handle(self, req: dict) -> None:
        store = self.store(req["free_dir"])
        point = int(req["point"])
        for fixed, out in zip(req["fixed"], req["out_paths"]):
            ir = to_wav_ir(store.channels(point, int(fixed)), store.meta["Ts"], store.meta["post"])
            data = ir[0] if ir.shape[0] == 1 else ir.T
            tmp = Path(out).with_suffix(".tmp")
            with open(tmp, "wb") as f:
                wavfile.write(f, int(store.meta["post"]["out_fs"]), np.ascontiguousarray(data, dtype=np.float32))
            tmp.replace(out)


def warm_up() -> None:
    """Compile the numba kernels (air absorption) before the first request."""
    post = {"fmax": 500.0, "out_fs": 48000.0, "duration": 0.05, "lowcut_hz": 10.0, "lowcut_order": 4,
            "lowpass_order": 4, "air_absorption": True, "Tc": 20.0, "rh": 50.0, "gain": 1.0}
    x = np.zeros((1, int(0.05 * WARM_FS)))
    x[0, 10] = 1.0
    to_wav_ir(x, 1.0 / WARM_FS, post)


def reply(payload: dict, out) -> None:
    out.write(f"{PREFIX} {json.dumps(payload)}\n")
    out.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parent-pid", type=int, default=None)
    args = ap.parse_args()
    ParentWatch(args.parent_pid)
    out = sys.stdout
    if isinstance(out, io.TextIOWrapper):
        out.reconfigure(encoding="utf-8", line_buffering=True)
    # upstream code prints (air absorption, numba); only protocol lines may reach stdout
    with contextlib.redirect_stdout(sys.stderr):
        warm_up()
    out.write("COMPAS_IR_READY\n")
    out.flush()
    server = Server()
    for line in sys.stdin:
        if not line.strip():
            continue
        req = {}
        try:
            req = json.loads(line)
            t0 = time.perf_counter()
            with contextlib.redirect_stdout(sys.stderr):
                server.handle(req)
            reply({"id": req.get("id"), "ok": True, "ms": 1e3 * (time.perf_counter() - t0)}, out)
        except Exception as exc:
            traceback.print_exc()
            reply({"id": req.get("id"), "ok": False, "error": f"{type(exc).__name__}: {exc}"}, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
