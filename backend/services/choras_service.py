"""
Choras2 Service

Provides static helpers for running DE (Diffusion Equation / FVM) and DG
(Discontinuous Galerkin) acoustic simulations locally via the choras_backend
package, and for converting their results to WAV impulse-response files.
"""

from __future__ import annotations

import json
import logging
import signal as _signal_module
import threading
from pathlib import Path
from typing import Optional

import numpy as np

from config.constants import (
    CHORAS_ABSORPTION_MATERIALS,
    CHORAS_DE_SAMPLE_RATE,
    CHORAS_DG_SAMPLE_RATE,
    CHORAS_RIR_DIR,
    CHORAS_DEFAULT_FREQUENCIES,
    AUDIO_SAMPLE_RATE
)

logger = logging.getLogger(__name__)


def _gmsh_initialize() -> None:
    """
    Initialize gmsh safely from any thread.

    ``gmsh.initialize()`` registers a SIGINT handler via ``signal.signal()``,
    which raises ``ValueError`` when called outside the main thread.  When
    running in a worker thread we temporarily replace ``signal.signal`` with a
    no-op so the initialization proceeds without crashing.
    """
    import gmsh

    if threading.current_thread() is threading.main_thread():
        gmsh.initialize()
    else:
        _orig = _signal_module.signal
        _signal_module.signal = lambda *args, **kwargs: None  # type: ignore[assignment]
        try:
            gmsh.initialize()
        finally:
            _signal_module.signal = _orig  # type: ignore[assignment]


class ChorasService:
    """
    Static utility class for Choras2 (DE/DG) acoustic simulations.

    All methods are @staticmethod so no instance is required.
    """

    @staticmethod
    def get_de_version_info() -> dict:
        import importlib.metadata
        try:
            version = importlib.metadata.version("acousticDE")
        except importlib.metadata.PackageNotFoundError:
            try:
                import acousticDE
                version = getattr(acousticDE, "__version__", "unknown")
            except ImportError:
                version = "unknown"
        return {"name": "acousticDE", "version": version}

    @staticmethod
    def get_dg_version_info() -> dict:
        import importlib.metadata
        try:
            version = importlib.metadata.version("edg-acoustics")
        except importlib.metadata.PackageNotFoundError:
            try:
                import edg_acoustics
                version = getattr(edg_acoustics, "__version__", "unknown")
            except ImportError:
                version = "unknown"
        return {"name": "edg_acoustics", "version": version}

    # ─── Material Database ────────────────────────────────────────────────────

    @staticmethod
    def get_material_database() -> list[dict]:
        """
        Return a flat list of materials for the /choras2/materials endpoint.

        Each entry includes a scalar ``absorption`` value (mean of the 5-band
        coefficients) so the frontend's ``useAcousticsMaterials`` hook can use
        it without extra mapping.
        """
        CENTER_FREQS = CHORAS_DEFAULT_FREQUENCIES
        result = []
        for mat_id, props in CHORAS_ABSORPTION_MATERIALS.items():
            coeffs: list[float] = props["coeffs"]
            absorption = sum(coeffs) / len(coeffs) if coeffs else 0.5
            result.append({
                "id": mat_id,
                "name": mat_id.replace("_", " ").title(),
                "description": props.get("description", ""),
                "coeffs": coeffs,
                "center_freqs": CENTER_FREQS,
                "absorption": round(absorption, 4),
            })
        return result

    # ─── Simulation runners ───────────────────────────────────────────────────

    @staticmethod
    def run_de_simulation(pair_dir: Path, json_path: Path) -> dict:
        """
        Run the DE (FVM) simulation for one source-receiver pair.

        Calls ``de_method(str(json_path))`` from ``choras_backend.DEinterface``.
        ``de_method`` will:
          - generate the MSH from the GEO file inside ``pair_dir``
          - run the FVM solver
          - write results back into ``json_path`` and a ``*_pressure.csv``

        Returns:
            The updated result_container dict (loaded from ``json_path``).

        Raises:
            RuntimeError: if the simulation fails.
        """
        import gmsh
        from choras_backend.DEinterface import de_method

        logger.info(f"[DE] Running simulation in {pair_dir}")
        _gmsh_initialize()
        try:
            de_method(str(json_path))
        except Exception as exc:
            logger.error(f"[DE] Simulation failed: {exc}")
            raise RuntimeError(f"DE simulation failed: {exc}") from exc
        finally:
            gmsh.finalize()

        with open(json_path) as f:
            return json.load(f)

    @staticmethod
    def run_dg_simulation(source_dir: Path, json_path: Path) -> dict:
        """
        Run the DG simulation for one source (with potentially multiple receivers).

        Calls ``dg_method(str(json_path), save_results_to_json=True)`` from
        ``choras_backend.DGinterface``.

        Returns:
            The updated result_container dict (loaded from ``json_path``).
        """
        import gmsh
        from choras_backend.DGinterface import dg_method

        logger.info(f"[DG] Running simulation in {source_dir}")
        _gmsh_initialize()
        try:
            dg_method(str(json_path), save_results_to_json=True)
        except Exception as exc:
            logger.error(f"[DG] Simulation failed: {exc}")
            raise RuntimeError(f"DG simulation failed: {exc}") from exc
        finally:
            gmsh.finalize()

        with open(json_path) as f:
            return json.load(f)

    # ─── WAV export ───────────────────────────────────────────────────────────

    @staticmethod
    def de_results_to_wav(
        json_path: Path,
        pair_dir: Path,
        pair_key: str,
    ) -> Optional[Path]:
        """
        Synthesize a broadband impulse-response WAV from DE pressure-derivative data.

        DE writes per-band pressure derivative signals (p_rec_off_deriv_band) to
        ``*_pressure.csv``: columns ``t``, ``125Hz``, ``250Hz``, ``500Hz``,
        ``1000Hz``, ``2000Hz``.

        These columns contain the **energy-decay envelope** (first backward
        difference of the squared pressure), not a signed pressure signal.
        To recover a perceptually plausible stochastic IR we:

          1. Resample each band's envelope from 20 kHz to 44.1 kHz.
          2. Clip to non-negative (energy is always ≥ 0).
          3. Take the square root → amplitude envelope per band.
          4. Generate a single white-noise vector, then band-limit it with an
             8th-order Butterworth filter centred on each octave-band frequency.
          5. Multiply the per-band amplitude envelope by the corresponding
             filtered noise and sum all bands → broadband stochastic IR.
          6. Normalise and write to 16-bit WAV at 44.1 kHz.

        Returns:
            Path to the WAV file, or ``None`` if no pressure CSV was found.
        """
        from math import ceil

        import pandas as pd
        from scipy.io import wavfile
        from scipy.signal import butter, resample_poly, sosfilt

        _FS_IN  = CHORAS_DE_SAMPLE_RATE   # 20 000 Hz (DE time step = 1/20000 s)
        _FS_OUT = AUDIO_SAMPLE_RATE                    # standard audio output rate
        _FILTER_ORDER = 8
        _NTH_OCTAVE   = 1                 # 1-octave bands
        _RANDOM_SEED  = 215

        csv_path = str(json_path).replace(".json", "_pressure.csv")
        if not Path(csv_path).exists():
            logger.warning(f"[DE→WAV] Pressure CSV not found: {csv_path}")
            return None

        try:
            df = pd.read_csv(csv_path)
            freq_cols = [c for c in df.columns if c != "t"]
            if not freq_cols:
                logger.warning("[DE→WAV] No frequency columns found in pressure CSV.")
                return None

            # Parse centre frequencies from column headers ("125Hz" → 125)
            center_freqs = []
            valid_cols: list[str] = []
            for col in freq_cols:
                try:
                    center_freqs.append(int(col.replace("Hz", "")))
                    valid_cols.append(col)
                except ValueError:
                    pass
            if not valid_cols:
                logger.warning("[DE→WAV] Could not parse any frequency columns.")
                return None
            nBands = len(valid_cols)

            # Shape: (nBands, nSamples_in)
            p_band = df[valid_cols].values.T.astype(np.float64)

            # ── 1. Resample to output sample rate ────────────────────────────
            n_in  = p_band.shape[1]
            n_out = ceil(n_in * _FS_OUT / _FS_IN)
            p_band_rs = np.zeros((nBands, n_out), dtype=np.float64)
            for i in range(nBands):
                resampled = resample_poly(p_band[i], up=int(_FS_OUT), down=int(_FS_IN))
                p_band_rs[i, : len(resampled)] = resampled[:n_out]

            # ── 2. Clip to non-negative (energy derivative must be ≥ 0) ──────
            p_band_rs = np.clip(p_band_rs, 0.0, None)

            # ── 3. Amplitude envelope = √(energy envelope) ──────────────────
            sqrt_env = np.sqrt(p_band_rs)  # (nBands, n_out)

            # ── 4. Band-limited noise ────────────────────────────────────────
            np.random.seed(_RANDOM_SEED)
            noise = np.random.uniform(-np.sqrt(3), np.sqrt(3), n_out)

            Nyquist = _FS_OUT / 2.0
            filt_noise_band: list[np.ndarray] = []
            for fc in center_freqs:
                low  = (fc / (2 ** (1.0 / (2 * _NTH_OCTAVE)))) / Nyquist
                high = (fc * (2 ** (1.0 / (2 * _NTH_OCTAVE)))) / Nyquist
                low  = float(np.clip(low,  0.001, 0.999))
                high = float(np.clip(high, 0.001, 0.999))
                sos  = butter(_FILTER_ORDER, [low, high], btype="band", output="sos")
                filt_noise_band.append(sosfilt(sos, noise))

            # Ensure filt_noise length matches envelope (resample_poly may differ by 1)
            noise_len = len(filt_noise_band[0])
            pad = noise_len - n_out
            if pad > 0:
                sqrt_env = np.pad(sqrt_env, ((0, 0), (0, pad)), mode="constant")
            env_len = sqrt_env.shape[1]

            # ── 5. Multiply envelope × noise, sum bands ──────────────────────
            ir = np.zeros(min(env_len, noise_len), dtype=np.float64)
            for i in range(nBands):
                ir += sqrt_env[i, : len(ir)] * filt_noise_band[i][: len(ir)]

            # ── 6. Scale to physical pressure amplitude ─────────────────────────
            # Read the steady-state SPL at the receiver (1 kHz band, index 3)
            # from the simulation JSON. This encodes source-receiver distance:
            # farther receivers have lower SPL → smaller IR amplitude.
            p_ref = 2e-5  # acoustic reference pressure [Pa]
            try:
                with open(json_path) as _jf:
                    _jdata = json.load(_jf)
                spl_t0 = _jdata["results"][0]["responses"][0]["parameters"]["spl_t0_freq"]
                # Use the 1 kHz band (index 3) as the reference level
                spl_1k = float(spl_t0[3])
                p_scale = p_ref * (10 ** (spl_1k / 20.0))  # [Pa]
            except Exception as _e:
                logger.warning(f"[DE→WAV] Could not read spl_t0_freq, falling back to unit scale: {_e}")
                p_scale = 1.0

            # Normalise stochastic IR to ±1 first, then apply physical scale [Pa]
            peak = np.max(np.abs(ir))
            if peak > 1e-12:
                ir = ir / peak
            ir = ir * p_scale  # now in [Pa]

            Path(CHORAS_RIR_DIR).mkdir(parents=True, exist_ok=True)
            wav_path = Path(CHORAS_RIR_DIR) / f"choras_{pair_key}.wav"
            wavfile.write(str(wav_path), _FS_OUT, ir.astype(np.float32))
            logger.info(
                f"[DE→WAV] Wrote {len(ir)} samples @ {_FS_OUT} Hz "
                f"(peak {p_scale:.4e} Pa) to {wav_path}"
            )
            return wav_path

        except Exception as exc:
            logger.error(f"[DE→WAV] Failed to export WAV: {exc}")
            return None

    @staticmethod
    def dg_results_to_wav(
        json_path: Path,
        receiver_index: int,
        pair_key: str,
    ) -> Optional[Path]:
        """
        Export the DG corrected impulse response for one receiver as a WAV file.

        DG writes ``receiverResults`` (the corrected broadband IR time series)
        directly into ``json_path`` under ``results[0].responses[receiver_index]``.

        Output WAV is written to ``CHORAS_RIR_DIR`` at 44.1 kHz.

        Returns:
            Path to the WAV file, or ``None`` on failure.
        """
        from scipy.io import wavfile

        try:
            with open(json_path) as f:
                data = json.load(f)

            responses = data.get("results", [{}])[0].get("responses", [])
            if receiver_index >= len(responses):
                logger.warning(f"[DG→WAV] Receiver index {receiver_index} out of range ({len(responses)} responses).")
                return None

            ir_raw = responses[receiver_index].get("receiverResults", [])
            if not ir_raw:
                logger.warning(f"[DG→WAV] receiverResults empty for receiver {receiver_index}.")
                return None

            ir = np.array(ir_raw, dtype=np.float64)
            # Flatten in case IRnew was saved as (1, N) instead of (N,).
            if ir.ndim > 1:
                ir = ir.flatten()
            # Replace NaN/Inf that can arise from edg_acoustics monopole correction
            # (divide-by-zero in TR_free at DC).
            ir = np.nan_to_num(ir, nan=0.0, posinf=0.0, neginf=0.0)

            # Write as float32 WAV — no normalisation so that the physical pressure
            # amplitude (which is inversely proportional to source-receiver distance)
            # is preserved. Closer receivers will have a larger peak than farther ones.
            Path(CHORAS_RIR_DIR).mkdir(parents=True, exist_ok=True)
            wav_path = Path(CHORAS_RIR_DIR) / f"choras_{pair_key}.wav"
            wavfile.write(str(wav_path), CHORAS_DG_SAMPLE_RATE, ir.astype(np.float32))
            logger.info(
                f"[DG→WAV] Wrote {len(ir)} samples to {wav_path} "
                f"(peak {np.max(np.abs(ir)):.4e})"
            )
            return wav_path

        except Exception as exc:
            logger.error(f"[DG→WAV] Failed to export WAV: {exc}")
            return None

    # ─── Acoustic parameter extraction ───────────────────────────────────────

    @staticmethod
    def extract_wav_acoustic_parameters(wav_path: Path) -> dict:
        """
        Compute acoustic parameters from a WAV impulse-response file.

        Normalises the IR before computing rt60/edt/c50/d50/drr.
        SPL is set to the relative energy level (placeholder — callers should
        override 'spl' with the physically-correct value for DE/DG via the
        extract_de_spl / extract_dg_spl helpers.
        """
        try:
            from scipy.io import wavfile as _wavfile
            from utils.acoustic_measurement import AcousticMeasurement

            fs, data = _wavfile.read(str(wav_path))
            ir = data.astype(np.float64)
            if ir.ndim > 1:
                ir = ir[:, 0]
            peak = np.max(np.abs(ir))
            if peak > 0:
                ir = ir / peak

            return AcousticMeasurement.calculate_acoustic_parameters_from_rir(ir, fs)
        except Exception as exc:
            logger.warning(f"[extract_wav_acoustic_parameters] Failed: {exc}")
            return {}

    @staticmethod
    def extract_de_spl(json_path: Path) -> float | None:
        """
        Return broadband SPL (dB SPL) for a DE pair from its results JSON.
        Uses the steady-state spl_t0_freq values written by the DE solver.
        """
        try:
            from utils.acoustic_measurement import AcousticMeasurement
            with open(json_path) as f:
                jdata = json.load(f)
            return AcousticMeasurement.calculate_de_spl_from_json(jdata)
        except Exception as exc:
            logger.warning(f"[extract_de_spl] Failed: {exc}")
            return None

    @staticmethod
    def extract_dg_spl(json_path: Path, receiver_index: int) -> float | None:
        """
        Compute physical SPL (dB SPL) for one DG receiver from its pressure IR.
        Uses receiverResults (Pa) from the DG JSON before any normalisation.
        """
        try:
            from utils.acoustic_measurement import AcousticMeasurement
            with open(json_path) as f:
                jdata = json.load(f)
            return AcousticMeasurement.calculate_dg_spl_from_json(jdata, receiver_index)
        except Exception as exc:
            logger.warning(f"[extract_dg_spl] Failed: {exc}")
            return None
