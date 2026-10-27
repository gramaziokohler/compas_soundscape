"""CPU-only tests: loudspeaker phase filter, grid-edge echo removal, animation rendering (synthetic data)."""
import numpy as np
from scipy.signal import butter, lfilter

from benchmarks.bras.bras_animation import dequantize, quantize, remove_edge_echoes
from benchmarks.bras.bras_render import render
from benchmarks.bras.bras_source_phase import apply, phase_fir

FS = 44100.0
C = 343.2


def _speaker_ir(n: int = 4096, onset: int = 300) -> np.ndarray:
    """A minimum-phase 'loudspeaker': 4th-order band-pass (80 Hz - 8 kHz) excited at ``onset``."""
    x = np.zeros(n)
    x[onset] = 1.0
    return lfilter(*butter(2, [80.0, 8000.0], btype="band", fs=FS), x)


def test_phase_fir_is_allpass_and_restores_the_loudspeaker_waveform():
    ir = _speaker_ir()
    sp = phase_fir(ir, FS)
    f = np.fft.rfftfreq(sp.fir.size, 1 / FS)
    band = (f > 100) & (f < 6000)
    assert np.allclose(np.abs(np.fft.rfft(sp.fir))[band], 1.0, atol=1e-6)  # |H| unchanged

    # a zero-phase IR with the loudspeaker's magnitude, centred at 2000 -> the loudspeaker's own
    # (minimum-phase) waveform with its main peak at 2000
    H = np.abs(np.fft.rfft(ir, 8192))
    zero_phase = np.roll(np.fft.irfft(H, 8192), 2000)[:6000]
    out = apply(zero_phase, FS, sp)
    shift = 2000 - sp.peak_index          # the loudspeaker IR moved so its main peak sits at 2000
    ref = np.zeros(6000)
    ref[shift: shift + ir.size] = ir[: 6000 - shift]
    seg = slice(1500, 5500)
    corr = np.dot(out[seg], ref[seg]) / (np.linalg.norm(out[seg]) * np.linalg.norm(ref[seg]))
    assert corr > 0.99
    assert abs(int(np.argmax(np.abs(out))) - 2000) <= 1  # bulk delay removed: the arrival does not move


def _pulse(t: np.ndarray, period: float) -> np.ndarray:
    return np.where((t >= 0) & (t < period), np.sin(2 * np.pi * t / period), 0.0)


def test_edge_echoes_are_removed_and_the_plate_wave_stays():
    fmax = 2000.0
    period = 1.5 / fmax
    x = np.linspace(-1.0, 3.0, 41)
    y = np.linspace(-1.0, 1.0, 21)
    z = 0.0
    times = np.arange(0.0, 0.03, 0.0005)
    src = np.array([0.0, 0.0, 0.0])
    bmin, bmax = np.array([-2.0, -3.0, -3.0]), np.array([4.0, 3.0, 3.0])
    X, Y = np.meshgrid(x, y)
    P = np.stack([X, Y, np.zeros_like(X)], axis=-1)

    def wave(origin, amp):
        d = np.linalg.norm(P - origin, axis=-1)
        return amp * _pulse(times[:, None, None] - d / C, period) / np.maximum(d, 0.2)

    direct = wave(src, 1.0)
    echo = wave(np.array([-4.0, 0.0, 0.0]), -0.2)           # image of the source across x = -2
    scatter = wave(np.array([1.5, 0.0, 0.0]), 0.3) * (times[:, None, None] > 1.5 / C)  # the "plate"
    cleaned = remove_edge_echoes(direct + echo + scatter, direct + echo, x, y, z, times, src, bmin, bmax, fmax)
    err = np.abs(cleaned - (direct + scatter))
    interior = (X >= 0.5) & (np.abs(Y) <= 1.0)   # >= 2 m from the faces: echo well behind the direct wave
    assert err[:, interior].max() < 1e-6, err[:, interior].max()
    assert np.abs(echo[:, interior]).max() > 0.01  # the echo really crossed those pixels

    q = quantize(cleaned, 1.0)
    assert q.dtype == np.int8 and np.abs(dequantize(q, 1.0) - np.clip(cleaned, -1, 1)).max() <= 0.5 / 127 + 1e-6


def test_render_writes_a_gif_with_stacked_irs(tmp_path):
    nf, ny, nx = 6, 12, 16
    rng = np.random.default_rng(0)
    ir = np.zeros(1500)
    ir[400] = 1.0
    bundle = {
        "frames": rng.integers(-60, 60, (nf, ny, nx)).astype(np.int8), "vmax": 1.0,
        "times_ms": np.linspace(0, 30, nf), "x": np.linspace(-2, 2, nx), "y": np.linspace(-1.5, 1.5, ny), "z": 1.0,
        "mask": np.zeros((ny, nx), np.uint8), "ir_measured": ir, "fs_measured": FS, "ir_simulated": ir,
        "fs_simulated": FS, "source_id": "LS1", "source_position": np.array([1.0, 1.0, 1.0]),
        "receiver_ids": np.array(["MP1", "MP2"]), "receiver_positions": np.array([[1.0, -1.0, 1.0], [0.5, -1.2, 1.0]]),
        "highlight_receiver": "MP1", "fmax": 500.0, "edge_echoes_removed": True, "sim_source_phase": True,
    }
    path = tmp_path / "wave_LS1_z1.00.npz"
    np.savez(path, **bundle)
    written = render(path, fmt="gif", fps=5, gif_dpi=30)
    assert [p.name for p in written] == ["wave_LS1_z1.00.gif"] and written[0].stat().st_size > 0
