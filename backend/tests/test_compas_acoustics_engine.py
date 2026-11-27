# backend/tests/test_compas_acoustics_engine.py
"""The compas_acoustics engine behind /api/pyroomacoustics/* (services/compas_acoustics_engine.py).

A 6 x 5 x 3 m shoebox (wound inward, as Speckle models often are) runs through the app's own mesh
preparation and the direct-geometry worker, on both engines:

* mono: the direct sound lands at the geometric delay with the app's 1/r level, the WAV is float32;
* FOA / HOA: AmbiX ACN/SN3D in the listener frame (forward -Y, left +X, up +Z), so a source to the
  listener's left gives a positive Y channel and one in front a positive X channel;
* materials: pyroomacoustics ids, app custom ids, inlined user materials and bare absorptions map
  onto compas_acoustics' 125 Hz-8 kHz bands;
* the routing rules: BTMS refuses mono, HOA and diffraction refuse the legacy engine.
"""

import json

import numpy as np
import pytest
from scipy.io import wavfile

pytest.importorskip("compas_acoustics")

from config.constants import CA_TO_APP_LEVEL_SCALE, PYROOMACOUSTICS_SAMPLE_RATE  # noqa: E402
from services import compas_acoustics_engine as engine  # noqa: E402
from services.pyroomacoustics_worker import run_pyroomacoustics_simulation_from_geometry  # noqa: E402

FS = PYROOMACOUSTICS_SAMPLE_RATE
ROOM = (6.0, 5.0, 3.0)


def _shoebox_inward(lx, ly, lz):
    v = [[0, 0, 0], [lx, 0, 0], [lx, ly, 0], [0, ly, 0], [0, 0, lz], [lx, 0, lz], [lx, ly, lz], [0, ly, lz]]
    # outward quads (normals away from the inside), then every triangle reversed: inward winding
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    f = []
    for a, b, c, d in quads:
        f += [[a, c, b], [a, d, c]]
    return v, f


def _run(tmp_path, *, mode="mono", sources, receivers, material=None, engine_name="compas_acoustics",
         ray_tracing=False, max_order=1, **kwargs):
    v, f = _shoebox_inward(*ROOM)
    payload = {
        "vertices": v,
        "faces": f,
        "face_groups": {"room": list(range(len(f)))},
        "materials": {"room": material if material is not None else {"absorption": 0.3}},
        "sources": sources,
        "receivers": receivers,
    }
    geometry_file = tmp_path / "geometry.json"
    geometry_file.write_text(json.dumps(payload))
    result_file = tmp_path / "result.json"
    run_pyroomacoustics_simulation_from_geometry(
        simulation_id="ca",
        progress_file=str(tmp_path / "progress.json"),
        result_file=str(result_file),
        geometry_file=str(geometry_file),
        simulation_mode=mode,
        max_order=max_order,
        ray_tracing=ray_tracing,
        air_absorption=False,
        n_rays=2000,
        sound_speed=343.0,
        simulation_name="ca",
        rir_output_dir=str(tmp_path),
        temp_dir=str(tmp_path),
        parallel=False,
        engine=engine_name,
        **kwargs,
    )
    result = json.loads(result_file.read_text())
    assert result["type"] == "done", result.get("traceback")
    results = json.loads((tmp_path / result["result"]["results_file"]).read_text())
    irs = {}
    for entry in results["results"]:
        rate, data = wavfile.read(str(tmp_path / entry["ir_file"]))
        assert rate == FS
        irs[(entry["source_id"], entry["receiver_id"])] = data
    return results, irs


def test_mono_direct_sound_at_the_app_level(tmp_path):
    src, rcv = [1.5, 2.5, 1.5], [4.5, 2.5, 1.5]
    results, irs = _run(tmp_path, sources=[{"id": "s1", "position": src}], receivers=[{"id": "r1", "position": rcv}])
    ir = irs[("s1", "r1")]
    assert ir.dtype == np.float32 and ir.ndim == 1
    r = float(np.linalg.norm(np.subtract(src, rcv)))
    c = results["compas_acoustics"]["speed_of_sound"]
    arrival = int(np.argmax(np.abs(ir)))
    assert abs(arrival - r / c * FS) <= 3                    # no filter latency left in
    peak = float(np.max(np.abs(ir)))
    assert peak == pytest.approx(1.0 / r, rel=0.25)           # app level: 1/r, not 1/(4 pi r)
    entry = results["results"][0]
    assert entry["engine"] == "compas_acoustics" and entry["num_channels"] == 1
    assert results["engine"] == "compas_acoustics"
    assert results["solve_time_s"] > 0                        # card footer "Solved in ..."
    params, bands = entry["acoustic_parameters"], entry["acoustic_parameters_bands"]
    assert "t30" in params and "sti" in params
    if params["t30"] is not None:   # one analysis: the card's T30 is the bands' ISO single number
        assert params["t30"] == pytest.approx(bands["T30_overall"])
    assert results["compas_acoustics"]["closed"] is True


def test_near_source_does_not_wrap(tmp_path):
    _, irs = _run(tmp_path, sources=[{"id": "s1", "position": [3.0, 2.5, 1.5]}],
                  receivers=[{"id": "r1", "position": [3.3, 2.5, 1.5]}])
    ir = irs[("s1", "r1")]
    assert ir.max() > 1.5                                      # 1/0.3 m: int16 used to wrap this


@pytest.mark.parametrize("mode, order, channels", [("foa", None, 4), ("hoa", 2, 9)])
def test_ambisonic_channels_follow_the_listener_frame(tmp_path, mode, order, channels):
    listener = [3.0, 2.5, 1.5]
    left = [listener[0] + 1.5, listener[1], listener[2]]      # listener's left is +X
    front = [listener[0], listener[1] - 1.5, listener[2]]     # forward is -Y
    results, irs = _run(
        tmp_path, mode=mode, ambisonic_order=order,
        sources=[{"id": "left", "position": left}, {"id": "front", "position": front}],
        receivers=[{"id": "r1", "position": listener}],
    )
    entry = results["results"][0]
    assert entry["num_channels"] == channels and entry["format"] == "AmbiX"
    assert entry["channel_ordering"] == "ACN" and entry["normalization_convention"] == "SN3D"
    for name, channel in (("left", 1), ("front", 3)):          # ACN 1 = Y, ACN 3 = X
        ir = irs[(name, "r1")]
        assert ir.shape[1] == channels
        direct = int(np.argmax(np.abs(ir[:, 0])))
        w = ir[direct, 0]
        assert w > 0
        assert ir[direct, channel] == pytest.approx(w, rel=0.1)
        others = [c for c in (1, 2, 3) if c != channel]
        assert np.all(np.abs(ir[direct, others]) < 0.1 * w)


def test_materials_map_onto_compas_acoustics_bands():
    from compas_acoustics.defaults import Defaults

    bands = Defaults().DEFAULT_FREQUENCY_BANDS
    flat = engine.to_ca_material("a", 0.4)
    assert flat.absorption_coefficients == [0.4] * len(bands)
    pra = engine.to_ca_material("b", "hard_surface")
    assert len(pra.absorption_coefficients) == len(bands)
    custom = engine.to_ca_material("c", "perfect_absorber")
    assert min(custom.absorption_coefficients) > 0.9
    third_octave = {"coeffs": [0.1, 0.2, 0.3] * 7, "center_freqs": [100 * 2 ** (k / 3) for k in range(21)]}
    user = engine.to_ca_material("d", third_octave)
    assert all(0.0 <= a <= 1.0 for a in user.absorption_coefficients)


def test_sound_speed_becomes_the_air_temperature():
    assert engine.temperature_for_sound_speed(343.0) == pytest.approx(20.0, abs=0.5)
    air, note = engine.air_conditions(engine.EngineSettings(sound_speed=343.0))
    assert note is None and air.temperature == pytest.approx(20.0, abs=0.5)
    air, note = engine.air_conditions(engine.EngineSettings(sound_speed=400.0))
    assert air.temperature == 30.0 and "outside" in note


def test_btms_needs_ambisonic_output():
    with pytest.raises(ValueError, match="BTMS"):
        engine.build_method(engine.EngineSettings(ambisonic_order=0, diffraction="btms"))


def test_legacy_engine_still_runs(tmp_path):
    results, irs = _run(tmp_path, engine_name="pyroomacoustics", sources=[{"id": "s1", "position": [1.5, 2.5, 1.5]}],
                        receivers=[{"id": "r1", "position": [4.5, 2.5, 1.5]}])
    assert results["engine"] == "pyroomacoustics"
    assert results["solve_time_s"] > 0
    assert irs[("s1", "r1")].dtype == np.float32


def test_routing_rules():
    from fastapi import HTTPException
    from routers.pyroomacoustics import validate_engine_settings

    validate_engine_settings("compas_acoustics", "hoa", "btms", 3, None, 50.0)
    validate_engine_settings("compas_acoustics", "mono", "udfa", None, 20.0, 50.0)
    for args in (
        ("compas_acoustics", "mono", "btms", None, None, 50.0),
        ("pyroomacoustics", "hoa", "off", 2, None, 50.0),
        ("pyroomacoustics", "mono", "udfa", None, None, 50.0),
        ("compas_acoustics", "hoa", "off", 4, None, 50.0),
        ("nope", "mono", "off", None, None, 50.0),
    ):
        with pytest.raises(HTTPException):
            validate_engine_settings(*args)


def test_level_scale_constant():
    assert CA_TO_APP_LEVEL_SCALE == pytest.approx(4 * np.pi)


def _prepared_shoebox(points):
    from models.schemas import MeshPrepSettings
    from services.simulation_mesh_service import MeshPrepOptions, SimulationMeshService

    v, f = _shoebox_inward(*ROOM)
    return SimulationMeshService.prepare(
        v, f, {"room": [0, len(f) - 1]}, {i: 0.3 for i in range(len(f))}, None, points,
        MeshPrepOptions.from_settings(MeshPrepSettings()),
    )


def test_render_chunks_keep_every_pair_once():
    pairs = [{"source_id": f"s{s}", "receiver_id": f"r{r}"} for s in range(3) for r in range(5)]
    indices = list(range(len(pairs)))
    for workers in (1, 2, 4, 8):
        chunks = engine.render_chunks(pairs, indices, workers)
        assert sorted(i for chunk in chunks for i in chunk) == indices
        assert len(chunks) <= workers and all(chunks)
        for chunk in chunks:   # each part is every source x listener of its own members
            sources = {pairs[i]["source_id"] for i in chunk}
            receivers = {pairs[i]["receiver_id"] for i in chunk}
            assert len(chunk) == len(sources) * len(receivers)
    # one source, many listeners: cut by listener
    one = [{"source_id": "s", "receiver_id": f"r{r}"} for r in range(6)]
    assert [len(c) for c in engine.render_chunks(one, list(range(6)), 4)] == [2, 2, 1, 1]


def test_parallel_rendering_gives_the_serial_responses():
    """Ambisonic pairs rendered in several processes equal the one-process run, pair by pair."""
    from services.pyroomacoustics_room_builder import room_offset

    sources = {"s1": [1.5, 2.5, 1.5], "s2": [4.5, 1.5, 1.2]}
    receivers = {"r1": [3.0, 3.5, 1.5], "r2": [2.0, 1.0, 1.4]}
    pairs = [{"source_id": s, "source_position": sp, "receiver_id": r, "receiver_position": rp}
             for s, sp in sources.items() for r, rp in receivers.items()]
    mesh = _prepared_shoebox(list(sources.values()) + list(receivers.values()))
    offset = room_offset(mesh)
    base = dict(ambisonic_order=1, max_order=1, ray_tracing=True, n_rays=2000, air_absorption=False)
    stages = []
    serial = engine.simulate_pairs(mesh, offset, pairs, engine.EngineSettings(**base, n_jobs=1), lambda f, t, d: None)
    parallel = engine.simulate_pairs(mesh, offset, pairs, engine.EngineSettings(**base, n_jobs=2), lambda f, t, d: stages.append((f, t, d)))
    assert [r.pair_index for r in parallel.responses] == [0, 1, 2, 3]
    for a, b in zip(serial.responses, parallel.responses):
        assert a.rir.shape[1] == b.rir.shape[1] == 4
        # Same seed per source and per listener, so the split run matches the single process.
        # The pool returns float32.
        assert a.rir.shape == b.rir.shape
        np.testing.assert_allclose(b.rir, a.rir, rtol=1e-6, atol=1e-6)
        assert b.metrics is not None and b.metrics["acoustic_parameters_bands"]
    fractions = [f for f, _, _ in stages]
    assert fractions == sorted(fractions) and fractions[-1] <= 1.0
    # one row per process: its sources and listeners, its step, and the pairs done overall
    rows = [d["progress_lanes"] for _, _, d in stages if d]
    assert rows and all(r["pairs_total"] == 4 and len(r["lanes"]) == 2 for r in rows)
    assert {lane["label"] for lane in rows[0]["lanes"]} == {"S1 → R1–2", "S2 → R1–2"}
    assert rows[-1]["pairs_done"] == 4 and all(lane["state"] == "done" for lane in rows[-1]["lanes"])
    assert all(t.endswith(f" · {r['pairs_done']}/4 pairs") for (_, t, d), r in zip([s for s in stages if s[2]], rows))


def test_progress_lines_name_the_step_and_its_counts():
    from services import ca_progress

    assert ca_progress.describe("rendering: late reverberation", 2, 3, 10000) == "Late reverberation · 2/3 pairs"
    # the stage names since compas_acoustics b66a67e
    assert ca_progress.describe("simulating: late reverberation", 2, 3, 10000) == "Late reverberation · 2/3 pairs"
    assert ca_progress.describe("simulating", 1, 4, 10000) == "Simulating · 1/4 responses"
    assert ca_progress.describe("simulating", None, None, 10000) == "Simulating"
    assert ca_progress.describe("ray tracing", 6200, 20000, 10000) == "Ray tracing · 6,200/20,000 rays"
    assert ca_progress.describe("ray tracing", 1, 3, 10000) == "Ray tracing · 1/3 sources"
    assert ca_progress.describe("image sources", None, None, 10000) == "Image sources"
    assert ca_progress.describe("image sources", 1234, None, 10000) == "Image sources · 1,234 reflections"
    assert ca_progress.describe("new stage", None, None, 0) == "New stage"
    # collapsed line: the slowest part's phase and the pairs done, never a part's own step
    spans = ca_progress.stage_spans(True)
    tracing, rendering = ca_progress.Lane("S1–2 → R1–2", 4, spans, 10000), ca_progress.Lane("S3 → R1–2", 2, spans, 10000)
    assert ca_progress.summary([tracing, rendering], 6)[1] == "Starting · 0/6 pairs"
    tracing.update("ray tracing", 6000, 20000)
    rendering.update("rendering: ambisonic encoding", 0, 2)
    assert ca_progress.summary([tracing, rendering], 6)[1] == "Tracing sound paths · 0/6 pairs"
    tracing.update("rendering: early reflections", 0, 4)
    rendering.finish()
    assert ca_progress.summary([tracing, rendering], 6)[1] == "Rendering responses · 2/6 pairs"
    lane = ca_progress.Lane("S1 → R1", 1, ca_progress.stage_spans(True), 10000)
    lane.update("rendering: late reverberation", 0, 1)
    halfway = lane.fraction
    lane.update("references", None, None)  # a stage met again never moves the bar back
    assert lane.fraction == halfway and 0.5 < halfway < 1.0
    assert ca_progress._ranges([1, 2, 3, 5, 7, 8]) == "1–3, 5, 7–8"
    # Mono's bare "simulating" starts the run: the bar stays at 0 until its responses are counted
    mono = ca_progress.Lane("S1 → R1", 1, ca_progress.stage_spans(False), 10000)
    mono.update("simulating", None, None)
    assert mono.fraction == 0.0
    mono.update("image sources", 120, None)
    mono.update("simulating", 1, 2)
    assert 0.7 < mono.fraction < 1.0
    hybrid = ca_progress.Lane("S1 → R1", 1, ca_progress.stage_spans(True), 10000)
    hybrid.update("simulating: early reflections", 0, 1)
    assert hybrid.fraction == ca_progress.stage_spans(True)["simulating: early reflections"][0]
    assert ca_progress.summary([hybrid], 1)[1] == "Rendering responses · 0/1 pairs"
    hybrid.finish()
    assert ca_progress.summary([hybrid], 1)[1] == "Done · 1/1 pairs"


def test_mono_metrics_from_the_pool_match():
    from services.pyroomacoustics_room_builder import room_offset

    source = [1.5, 2.5, 1.5]
    receivers = {f"r{k}": [2.5 + 0.5 * k, 3.0, 1.4] for k in range(4)}
    pairs = [{"source_id": "s1", "source_position": source, "receiver_id": r, "receiver_position": rp} for r, rp in receivers.items()]
    mesh = _prepared_shoebox([source] + list(receivers.values()))
    offset = room_offset(mesh)
    # order 6: the response outlasts 50 ms, so C50 and D50 have a late part (the Analyser gives NaN without one)
    base = dict(max_order=6, ray_tracing=False, air_absorption=False)
    serial = engine.simulate_pairs(mesh, offset, pairs, engine.EngineSettings(**base, n_jobs=1), lambda f, t, d: None)
    pooled = engine.simulate_pairs(mesh, offset, pairs, engine.EngineSettings(**base, n_jobs=2), lambda f, t, d: None)
    for a, b in zip(serial.responses, pooled.responses):
        np.testing.assert_allclose(b.rir, a.rir)
        assert a.metrics is not None and b.metrics is not None
        bands_a, bands_b = a.metrics["acoustic_parameters_bands"], b.metrics["acoustic_parameters_bands"]
        for key in ("C50", "D50"):   # float32 hand-over to the pool: equal to rounding
            assert None not in bands_a[key], key
            np.testing.assert_allclose(bands_b[key], bands_a[key], atol=0.05)


def test_render_duration_follows_what_the_export_keeps():
    from config.constants import CA_RENDER_MARGIN_DB, CA_RENDER_MIN_S, CA_RENDER_PAD_S, IR_TRIM_DECAY_DB

    t = np.arange(FS * 3) / FS
    # T60 = 1 s: the energy decay falls 60 dB per second, so it reaches the trim (60 dB) plus the
    # margin (12 dB) at 1.2 s
    decay = np.exp(-6.91 * t / 1.0)
    reach = (IR_TRIM_DECAY_DB + CA_RENDER_MARGIN_DB) / 60.0
    length = engine.render_duration([decay])
    assert length == pytest.approx(reach + CA_RENDER_PAD_S, abs=0.01)
    # the slowest of several decides; a second channel is ignored (W decides)
    slow = np.exp(-6.91 * t / 2.0)
    assert engine.render_duration([decay, np.column_stack([slow, slow * 0])]) == pytest.approx(2 * reach + CA_RENDER_PAD_S, abs=0.02)
    # a lone click still gets a minimum length; silence gives no opinion
    click = np.zeros(FS)
    click[100] = 1.0
    assert engine.render_duration([click]) == CA_RENDER_MIN_S
    assert engine.render_duration([np.zeros(FS)]) is None
    assert engine.render_duration([]) is None


def test_moments_tail_takes_the_rays_late_energy_serial_or_split():
    """The SH-moments tail (FOA): late field from the reference's own rays, the same in one process or two."""
    from services.pyroomacoustics_room_builder import room_offset

    sources = {"s1": [1.5, 2.5, 1.5], "s2": [4.5, 1.5, 1.2]}
    receivers = {"r1": [3.0, 3.5, 1.5]}
    pairs = [{"source_id": s, "source_position": sp, "receiver_id": r, "receiver_position": rp}
             for s, sp in sources.items() for r, rp in receivers.items()]
    mesh = _prepared_shoebox(list(sources.values()) + list(receivers.values()))
    offset = room_offset(mesh)
    base = dict(ambisonic_order=1, max_order=1, ray_tracing=True, n_rays=2000, air_absorption=False, tail="moments")
    serial = engine.simulate_pairs(mesh, offset, pairs, engine.EngineSettings(**base, n_jobs=1), lambda f, t, d: None)
    parallel = engine.simulate_pairs(mesh, offset, pairs, engine.EngineSettings(**base, n_jobs=2), lambda f, t, d: None)
    assert serial.generation["late_field"] == "moments"
    for a, b in zip(serial.responses, parallel.responses):
        assert a.generation["late_field"] == "moments" and a.generation["late_energy"] == "rays"
        assert a.rir.shape[1] == 4 and np.any(a.rir[len(a.rir) // 4:, 0] != 0)  # it has a late field
        np.testing.assert_allclose(b.rir, a.rir, rtol=1e-6, atol=1e-6)
