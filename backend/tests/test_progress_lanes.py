"""Rows of a job's parts that run side by side (services/progress_lanes.py)."""

from config.constants import HYBRID_PROGRESS_PARTS_START, HYBRID_PROGRESS_WAVE_END, PROGRESS_LANES_PARTIAL_KEY
from services.progress_lanes import HybridProgress, WaveRuns, lanes_of


def test_wave_runs_show_each_source_step():
    runs = WaveRuns(3)
    runs.update({"run": 0, "step": "done"})
    runs.update({"run": 1, "step": "solve", "pct": 43.0, "eta": 12})
    rows = runs.rows()
    assert [r["label"] for r in rows] == ["S1", "S2", "S3"]
    assert [r["state"] for r in rows] == ["done", "running", "queued"]
    assert rows[1]["text"] == "GPU solve 43% · ETA 12 s" and 0.05 < rows[1]["fraction"] < 0.9
    assert rows[2]["text"] == "Waiting" and rows[2]["elapsed_s"] is None
    runs.update({"run": 7, "step": "done"})  # out of range: ignored
    assert WaveRuns(2, reciprocal=True).rows()[1]["label"] == "Run 2"


def test_the_hybrid_shows_both_parts_at_once():
    written = []
    progress = HybridProgress(lambda value, text, partial: written.append((value, text, partial)))
    ca_rows = [{"label": "S1 → R1–2", "state": "running", "text": "Ray tracing · 6,000/20,000 rays", "fraction": 0.1, "elapsed_s": 3.0}]
    progress.geometric(0.4, "Tracing sound paths · 0/2 pairs", {PROGRESS_LANES_PARTIAL_KEY: {"lanes": ca_rows}})
    wave = WaveRuns(2)
    wave.update({"run": 0, "step": "solve", "pct": 50.0, "eta": 5})
    progress.wave_part(20.0, "Source 1/2: GPU solve 50%", {"voxelised": True, PROGRESS_LANES_PARTIAL_KEY: {"lanes": wave.rows()}})
    value, text, partial = written[-1]
    assert text == "Geometric 40% · Wave 20%"
    assert value == HYBRID_PROGRESS_PARTS_START + (HYBRID_PROGRESS_WAVE_END - HYBRID_PROGRESS_PARTS_START) * 0.3
    assert partial["voxelised"] is True  # the wave part's milestones pass through
    assert [r["label"] for r in lanes_of(partial)] == ["CPU · S1 → R1–2", "GPU · S1", "GPU · S2"]
    progress.wave_part(90.0, "Writing impulse responses...", None)  # the wave part's last step: its rows stay
    assert [r["label"] for r in lanes_of(written[-1][2])] == ["CPU · S1 → R1–2", "GPU · S1", "GPU · S2"]
    progress.finish("geometric")
    rows = lanes_of(written[-1][2])
    assert rows[0]["label"] == "CPU · geometric" and rows[0]["state"] == "done" and rows[0]["text"] == "Done"
    assert [r["label"] for r in rows[1:]] == ["GPU · S1", "GPU · S2"]


def test_a_part_without_rows_shows_one():
    written = []
    progress = HybridProgress(lambda value, text, partial: written.append(partial))
    progress.wave_part(2.0, "Preparing simulation mesh...", None)
    rows = lanes_of(written[-1])
    assert [r["label"] for r in rows] == ["CPU · geometric", "GPU · wave"]
    assert rows[1]["text"] == "Preparing simulation mesh..." and rows[1]["state"] == "running"
