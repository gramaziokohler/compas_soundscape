"""Job progress/result files survive the polling worker holding them open (Windows WinError 5)."""

import json
import os
import sys
import threading
import time

import pytest

from utils.atomic_json import write_json, write_progress_json

windows_only = pytest.mark.skipif(sys.platform != "win32", reason="only Windows refuses to replace an open file")


def _leftover_tmps(path):
    return [name for name in os.listdir(os.path.dirname(path)) if name.endswith(".tmp")]


@windows_only
def test_a_progress_report_onto_an_open_file_is_dropped_not_raised(tmp_path):
    path = str(tmp_path / "progress.json")
    write_json(path, {"value": 1})
    with open(path):  # the worker reading it
        assert write_progress_json(path, {"value": 2}) is False
    assert json.load(open(path)) == {"value": 1}
    assert _leftover_tmps(path) == []
    assert write_progress_json(path, {"value": 3}) is True
    assert json.load(open(path)) == {"value": 3}


@windows_only
def test_a_result_waits_for_the_reader_to_close_the_file(tmp_path):
    path = str(tmp_path / "result.json")
    write_json(path, {"type": "running"})
    reader = open(path)
    threading.Timer(0.3, reader.close).start()
    write_json(path, {"type": "done"})
    assert json.load(open(path)) == {"type": "done"}


def test_many_writers_and_a_polling_reader_never_fail(tmp_path):
    """8 jobs' worth of threads report into one file while a reader polls it, as in the bug report."""
    path = str(tmp_path / "progress.json")
    write_json(path, {"value": 0})
    stop, errors = threading.Event(), []

    def poll():
        while not stop.is_set():
            try:
                with open(path) as f:
                    json.load(f)
            except (OSError, ValueError) as exc:  # a reader may miss a beat; it must never see half a file
                if isinstance(exc, ValueError):
                    errors.append(exc)

    def report(k):
        try:
            for i in range(50):
                write_progress_json(path, {"value": i, "writer": k})
        except Exception as exc:  # noqa: BLE001 - any raise is the bug
            errors.append(exc)

    reader = threading.Thread(target=poll)
    reader.start()
    writers = [threading.Thread(target=report, args=(k,)) for k in range(8)]
    for w in writers:
        w.start()
    for w in writers:
        w.join()
    stop.set()
    reader.join()
    time.sleep(0.05)
    assert errors == []
    assert _leftover_tmps(path) == []
    assert "value" in json.load(open(path))
