# backend/tests/test_directivity_formats.py
"""Source-directivity file readers: SOFA (h5py) layouts and the BRAS front-pole CSV."""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from services.directivity_formats import (  # noqa: E402
    FORMAT_BRAS_CSV,
    FORMAT_SOFA,
    detect_format,
    inspect_file,
    read_bras_ir_csv,
    read_sofa_source_balloon,
)
from services.directivity_service import bundled_sofa_path  # noqa: E402
from utils.orientation import front_pole_to_cartesian, spherical_to_cartesian  # noqa: E402

h5py = pytest.importorskip("h5py")


def _sphere_grid(step_deg: int = 20):
    az = np.arange(0, 360, step_deg)
    col = np.arange(step_deg, 180, step_deg)
    aa, cc = np.meshgrid(az, col)
    return aa.ravel().astype(float), cc.ravel().astype(float)


def _write_sofa(path: Path, convention: str, ir: np.ndarray, receiver_pos: np.ndarray, rec_type: str, rec_units: str,
                source_pos=None, fs: float = 44100.0):
    with h5py.File(path, "w") as f:
        f.attrs["GLOBAL_SOFAConventions"] = np.bytes_(convention)
        f.create_dataset("Data.IR", data=ir)
        f.create_dataset("Data.SamplingRate", data=np.array([fs]))
        rp = f.create_dataset("ReceiverPosition", data=receiver_pos)
        rp.attrs["Type"] = np.bytes_(rec_type)
        rp.attrs["Units"] = np.bytes_(rec_units)
        sp = f.create_dataset("SourcePosition", data=source_pos if source_pos is not None else np.zeros((ir.shape[0], 3)))
        sp.attrs["Type"] = np.bytes_("cartesian")
        sp.attrs["Units"] = np.bytes_("metre")


def test_detect_format():
    assert detect_format("Genelec.sofa") == FORMAT_SOFA
    assert detect_format("LS_1x1_64442_IR_front_pole.CSV") == FORMAT_BRAS_CSV
    with pytest.raises(ValueError):
        detect_format("balloon.wav")


def test_sofa_sources_layout(tmp_path):
    """DIRPAT-like layout: Data.IR (M sources, R directions, N), receivers spherical in degrees."""
    az, col = _sphere_grid()
    n = az.size
    ir = np.zeros((2, n, 128))
    ir[:, :, 10] = 1.0
    ir[1, :, 10] = 0.5 + 0.5 * np.cos(np.deg2rad(az)) * np.sin(np.deg2rad(col))  # cardioid toward +x
    rec = np.stack([az, col, np.full(n, 1.5)], axis=1)[:, :, None]  # (R, C, I)
    path = tmp_path / "two_sources.sofa"
    _write_sofa(path, "GeneralFIR", ir, rec, "spherical", "degree, degree, metre")

    info = inspect_file(path, FORMAT_SOFA)
    assert info["sofa_sources"] == ["Source 1", "Source 2"] and info["n_points"] == n and info["fs"] == 44100.0

    with pytest.raises(ValueError, match="choose one"):
        read_sofa_source_balloon(path)
    b = read_sofa_source_balloon(path, "1")
    assert b.label == "Source 2" and b.irs.shape == (n, 128) and b.fmt == FORMAT_SOFA
    expected = spherical_to_cartesian(np.deg2rad(az), np.deg2rad(col))
    assert np.allclose(b.directions, expected)
    assert np.allclose(np.linalg.norm(b.directions, axis=1), 1.0)
    # the on-axis direction carries the largest sample
    assert np.argmax(b.irs[:, 10]) == np.argmax(b.directions[:, 0])


def test_sofa_elevation_and_cartesian_positions(tmp_path):
    az, col = _sphere_grid()
    n = az.size
    ir = np.zeros((1, n, 64))
    ir[:, :, 5] = 1.0
    elev = np.stack([az, 90.0 - col, np.ones(n)], axis=1)[:, :, None]
    path = tmp_path / "elev.sofa"
    _write_sofa(path, "GeneralFIR", ir, elev, "spherical", "degree, degree, metre")
    b = read_sofa_source_balloon(path)
    assert np.allclose(b.directions, spherical_to_cartesian(np.deg2rad(az), np.deg2rad(col)))

    cart = 2.0 * spherical_to_cartesian(np.deg2rad(az), np.deg2rad(col))
    path2 = tmp_path / "cart.sofa"
    _write_sofa(path2, "GeneralFIR", ir, cart[:, :, None], "cartesian", "metre")
    b2 = read_sofa_source_balloon(path2)
    assert np.allclose(b2.directions, cart / 2.0)


def test_sofa_per_measurement_receiver_layout(tmp_path):
    """One source, one microphone moved per measurement: Data.IR (M, 1, N), ReceiverPosition (1, C, M)."""
    az, col = _sphere_grid()
    n = az.size
    ir = np.zeros((n, 1, 64))
    ir[:, 0, 3] = 1.0
    rec = np.stack([az, col, np.ones(n)], axis=0)[None, :, :]  # (R=1, C, M)
    path = tmp_path / "moving_mic.sofa"
    _write_sofa(path, "GeneralFIR", ir, rec, "spherical", "degree, degree, metre", source_pos=np.zeros((n, 3)))
    info = inspect_file(path, FORMAT_SOFA)
    assert info["n_points"] == n and info["sofa_sources"] == []
    b = read_sofa_source_balloon(path)
    assert b.irs.shape == (n, 64)
    assert np.allclose(b.directions, spherical_to_cartesian(np.deg2rad(az), np.deg2rad(col)))


def test_sofa_rejects_hrir_and_moving_source(tmp_path):
    az, col = _sphere_grid()
    n = az.size
    ir = np.zeros((n, 2, 32))
    rec = np.array([[0.0, 0.09, 0.0], [0.0, -0.09, 0.0]])[:, :, None]
    path = tmp_path / "hrir.sofa"
    _write_sofa(path, "SimpleFreeFieldHRIR", ir, rec, "cartesian", "metre",
                source_pos=np.stack([az, col, np.ones(n)], axis=1))
    assert "receiver" in inspect_file(path, FORMAT_SOFA)["warning"]
    with pytest.raises(ValueError, match="HRIR"):
        read_sofa_source_balloon(path)

    ir1 = np.zeros((n, 1, 32))
    rec1 = np.zeros((1, 3, 1))
    path2 = tmp_path / "moving_source.sofa"
    _write_sofa(path2, "GeneralFIR", ir1, rec1, "cartesian", "metre", source_pos=np.stack([az, col, np.ones(n)], axis=1))
    with pytest.raises(ValueError, match="microphone"):
        read_sofa_source_balloon(path2)


@pytest.mark.skipif(bundled_sofa_path() is None, reason="bundled DIRPAT SOFA not installed")
def test_bundled_dirpat_file():
    path = bundled_sofa_path()
    info = inspect_file(path, FORMAT_SOFA)
    assert "Genelec_8020" in info["sofa_sources"] and info["n_points"] == 540
    b = read_sofa_source_balloon(path, "Genelec_8020")
    assert b.directions.shape == (540, 3) and b.irs.shape[0] == 540 and b.fs == 44100.0
    assert np.allclose(np.linalg.norm(b.directions, axis=1), 1.0, atol=1e-6)
    # the grid covers the whole sphere and the loudspeaker radiates mostly forward at 4 kHz
    assert b.directions[:, 0].min() < -0.9 and b.directions[:, 0].max() > 0.9


# ── BRAS CSV ────────────────────────────────────────────────────────────────

def _write_bras(path: Path, step: int = 10, taps: int = 64, pattern=None):
    lines = []
    for p in range(0, 360, step):
        for t in range(0, 181, step):
            ir = np.zeros(taps)
            ir[8] = 1.0 if pattern is None else pattern(p, t)
            lines.append(f"P{p:03d}T{t:03d}," + ",".join(f"{v:.6f}" for v in ir))
    path.write_text("\n".join(lines) + "\n")


def test_bras_csv_streams_subgrid_and_poles(tmp_path):
    path = tmp_path / "LS_1x1_64442_IR_front_pole.csv"
    _write_bras(path, step=10, pattern=lambda p, t: 0.5 + 0.5 * np.cos(np.deg2rad(t)))
    b = read_bras_ir_csv(path, step_deg=10)
    n_expected = (360 // 10) * (180 // 10 - 1) + 2  # ring points + two poles kept once
    assert b.directions.shape == (n_expected, 3) and b.irs.shape == (n_expected, 64)
    assert b.fs == 44100.0 and b.fmt == FORMAT_BRAS_CSV
    front = np.argmax(b.directions[:, 0])
    assert np.allclose(b.directions[front], [1, 0, 0]) and b.irs[front, 8] == pytest.approx(1.0)
    back = np.argmin(b.directions[:, 0])
    assert b.irs[back, 8] == pytest.approx(0.0, abs=1e-9)
    # a coarser step keeps fewer points, finer-than-file step keeps the same
    assert read_bras_ir_csv(path, step_deg=30).directions.shape[0] == (360 // 30) * (180 // 30 - 1) + 2
    info = inspect_file(path, FORMAT_BRAS_CSV)
    assert info["format"] == FORMAT_BRAS_CSV and info["fs"] == 44100.0


def test_bras_front_pole_convention():
    d = front_pole_to_cartesian(np.array([0, 0, 90, 270, 0]), np.array([0, 90, 90, 90, 180]))
    assert np.allclose(d, [[1, 0, 0], [0, 0, 1], [0, 1, 0], [0, -1, 0], [-1, 0, 0]], atol=1e-12)


def test_bras_rejects_mps_and_garbage(tmp_path):
    mps = tmp_path / "LS_1x1_64442_MPS_front_pole.csv"
    mps.write_text("f in Hz, 20, 25, 31.5\nP000T001,-73.9+41.6i,-74.4+41.5i,-75+40i\n")
    with pytest.raises(ValueError, match="MPS"):
        read_bras_ir_csv(mps)
    with pytest.raises(ValueError, match="MPS"):
        inspect_file(mps, FORMAT_BRAS_CSV)
    complex_rows = tmp_path / "x.csv"
    complex_rows.write_text("P000T000,1.0+0.5i,0.2\n")
    with pytest.raises(ValueError, match="MPS"):
        read_bras_ir_csv(complex_rows)
    junk = tmp_path / "junk.csv"
    junk.write_text("hello,1,2,3\n")
    with pytest.raises(ValueError, match="PxxxTyyy"):
        read_bras_ir_csv(junk)
