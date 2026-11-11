"""CPU tests of the benchmark-only high-order PFFDTD directivity (pffdtd_backend/directional_ho.py)."""
import math

import numpy as np

from pffdtd_backend.directional_ho import ball_offsets, compose_ho, n_coeffs, real_sh

C, H, FS = 343.0, 0.0127, 48000.0


def _sphere(n=60000, seed=0):
    v = np.random.default_rng(seed).normal(size=(n, 3))
    return v / np.linalg.norm(v, axis=1)[:, None]


def _project(pattern, order, n=200000):
    v = _sphere(n)
    return 4.0 * math.pi * real_sh(order, v).T @ pattern(v) / n


def _plane_wave_probes(u, offsets, n_t=4096, f0=1200.0):
    """Band-limited pulse arriving from direction u (propagating toward -u) at each probe."""
    t = np.arange(n_t) / FS
    delay = 0.02 - (offsets @ u) / C                     # the probe closer to u hears it earlier
    return np.exp(-((t[None, :] - delay[:, None]) * f0 * 2.0) ** 2)


def test_real_sh_is_orthonormal():
    v = _sphere(200000)
    Y = real_sh(4, v)
    gram = 4.0 * math.pi * Y.T @ Y / len(v)
    assert np.abs(gram - np.eye(n_coeffs(4))).max() < 0.02


def test_ball_offsets_start_at_the_centre():
    o = ball_offsets(2.0)
    assert len(o) == 33 and np.all(o[0] == 0) and np.all(np.linalg.norm(o, axis=1) <= 2.0 + 1e-9)


def _spec(pattern, order=4):
    D = _project(pattern, order)
    return {"freqs_hz": [0.0, FS / 2], "coeffs": [D.tolist(), D.tolist()], "max_order": order, "bessel_floor": 0.02}


def test_omni_returns_the_centre_probe():
    off = ball_offsets(3.0) * H
    x = _plane_wave_probes(np.array([0.0, 1.0, 0.0]), off)
    omni = np.zeros(n_coeffs(4))
    omni[0] = math.sqrt(4.0 * math.pi)                    # D = 1: only the l = 0 term
    spec = {"freqs_hz": [0.0, FS / 2], "coeffs": [omni.tolist()] * 2, "max_order": 4, "bessel_floor": 0.02}
    y = compose_ho(x, off, spec, FS, C)
    assert np.max(np.abs(y - x[0])) < 1e-3 * np.max(np.abs(x[0]))


def test_second_order_pattern_is_reproduced_per_direction():
    pattern = lambda v: 1.0 + 0.5 * v[:, 0] + 0.3 * (3.0 * v[:, 2] ** 2 - 1.0)   # frequency independent
    off = ball_offsets(3.0) * H
    spec = _spec(pattern)
    for u in ([1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.3, -0.5, 0.81]):
        u = np.asarray(u) / np.linalg.norm(u)
        x = _plane_wave_probes(u, off)
        y = compose_ho(x, off, spec, FS, C)
        # at 2 kHz the 3-cell ball resolves order 2 (low frequencies stay first order by design)
        f = np.fft.rfftfreq(x.shape[1], 1.0 / FS)
        k = np.argmin(np.abs(f - 2000.0))
        gain = abs(np.fft.rfft(y)[k] / np.fft.rfft(x[0])[k])
        assert abs(gain - pattern(u[None])[0]) < 0.03, (u, gain)
