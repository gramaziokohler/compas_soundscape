/**
 * Recommended ray count for the pyroomacoustics hybrid (ISM + ray tracing) simulator.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * 1. What the rays do in pyroomacoustics
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * The hybrid simulator "uses ISM to simulate the early reflections in the RIR and RT for the
 * diffuse tail" [1]. In the C++ core [2]:
 *   - energy is only logged at a microphone once `specular_counter >= ism_order`
 *     (`if (!(is_hybrid_sim && specular_counter < ism_order))`), so ISM owns the early part
 *     and rays contribute only beyond the Image-Source order;
 *   - each ray starts with `energy_0 = ENERGY_0 / n_rays` and is terminated when its energy
 *     drops below a RELATIVE threshold, `e_thres = energy_0 * energy_thres` (default 1e-7,
 *     i.e. ~70 dB of decay), or beyond `time_thres` — so the number of live rays does not
 *     depend on n_rays and stays constant through the tail;
 *   - a ray contributes when it passes within `mic_radius` of the microphone (receiver
 *     sphere), plus a deterministic "diffuse rain" term on scattering walls
 *     (`scat_trans = wall.scatter * transmitted * p_hit_equal * p_lambert`);
 *   - contributions are accumulated in an energy histogram of bin width `hist_bin_size`
 *     (default 4 ms) [2][3].
 *
 * Consequence: rays act as energy transporters, not explorers of the geometry. This is the
 * distinction Rindel draws for hybrid models: after the transition order "the rays are
 * treated as transporters of energy rather than explorers of the geometry" [4, §2.3].
 * Rindel's minimum-ray formula N ≥ 8π c² t² / A [4, eq. 1] sizes rays for *discovering*
 * reflection paths (image sources) up to time t; in pyroomacoustics ISM discovers those
 * exhaustively, so that formula is not the binding constraint and is not used here. For the
 * same reason the estimate below is independent of the Image-Source order.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * 2. Receiver-sphere statistics (the binding constraint)
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * In a diffuse field of volume V, N rays are spread uniformly, i.e. N/V rays per m³. During a
 * histogram bin Δt each ray travels c·Δt; a sphere of radius r presents a cross-section π r²,
 * so the expected number of ray crossings of the receiver per bin is
 *
 *     K = N · π r² · c · Δt / V                                                   (a)
 *
 * Crossings are a Poisson process, so the relative standard deviation of the energy collected
 * in a bin is 1/√K, and the corresponding level error is
 *
 *     ΔL ≈ 10·log10(1 + 1/√K) ≈ (10 / ln 10) / √K = 4.34 / √K   [dB]              (b)
 *
 * Solving (a)+(b) for N gives Vorländer's minimum number of rays [5], as used by COMSOL's
 * Ray Acoustics module (expression `(4.34/r_rec)^2 * Vol / pi / c0 / dt`) [6]:
 *
 *     N ≥ (4.34 / ΔL)² · V / (π r² c Δt)                                          (c)
 *
 * Because live rays never thin out over time in pyroomacoustics (relative termination, see
 * §1), K is stationary along the tail and (c) holds for every bin, not just the first.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * 3. Parameter choices
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *   ΔL = 1 dB  — the target used in Vorländer/COMSOL's worked example [6]; ≈ the just-
 *                noticeable difference for sound level, so per-bin fluctuations of the
 *                auralized tail are not audible. → K = 4.34² ≈ 19 hits per bin.
 *   r  = 0.5 m — pyroomacoustics `receiver_radius` default, mirrored from
 *                backend/config/constants.py (PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS).
 *   Δt = 4 ms  — pyroomacoustics `hist_bin_size` default [3], mirrored from the backend.
 *                COMSOL's example uses 10 ms; the finer bins here need ~2.5× more rays.
 *   c  = 343 m/s, V = acoustic-region bounding-box volume (overestimates the air volume of a
 *                non-box room, so the estimate errs high).
 *
 * Caveat: scattering walls add the deterministic diffuse-rain term (§1), which lowers the
 * variance below the pure Poisson model, so (c) is conservative for diffuse rooms and close to
 * exact for the default low scattering (0.05).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * References
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * [1] pyroomacoustics, `room.py` module docs, "Hybrid ISM/Ray Tracing Simulator".
 *     https://pyroomacoustics.readthedocs.io/en/stable/pyroomacoustics.room.html
 * [2] pyroomacoustics, `libroom_src/room.cpp` (simul_ray / scat_ray).
 *     https://github.com/LCAV/pyroomacoustics/blob/master/pyroomacoustics/libroom_src/room.cpp
 * [3] pyroomacoustics, `simulation.rt` module docs (receiver_radius, hist_bin_size, energy_thres).
 *     https://pyroomacoustics.readthedocs.io/en/stable/pyroomacoustics.simulation.rt.html
 * [4] J. H. Rindel, "Computer Simulation Techniques for Acoustical Design of Rooms",
 *     Acoustics Australia 23(3), 81–86, 1995.
 * [5] M. Vorländer, "Auralization: Fundamentals of Acoustics, Modelling, Simulation,
 *     Algorithms and Acoustic Virtual Reality", Springer, 2008.
 * [6] COMSOL Application Gallery, "Chamber Music Hall" (ray-count determination, Ref. 3 = [5]).
 *     https://doc.comsol.com/6.4/doc/com.comsol.help.models.aco.chamber_music_hall/chamber_music_hall.html
 */

import {
  DEFAULT_SPEED_OF_SOUND,
  PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS,
  PYROOMACOUSTICS_RAY_TRACING_HIST_BIN_SIZE,
  PYROOMACOUSTICS_RAY_TRACING_MAX_ERROR_DB,
} from '@/utils/constants';

export interface RayCountBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface RayCountEstimate {
  /** Recommended rays for ≤ ΔL dB per-bin level error (eq. c). Unclamped — the slider pins it. */
  recommended: number;
  /** Bounding-box volume in m³. */
  volume: number;
}

/** 10/ln(10) ≈ 4.34 — dB of level error per unit relative (Poisson) fluctuation, eq. (b). */
const DB_PER_RELATIVE_ERROR = 10 / Math.LN10;

/** Display rounding for ray counts. */
const RAY_COUNT_ROUNDING = 100;

/**
 * @param bounds Acoustic-region bounding box (metres), or null/undefined when unavailable.
 * @returns null when the bounding box is missing or degenerate.
 */
export function estimateRayCount(bounds: RayCountBounds | null | undefined): RayCountEstimate | null {
  if (!bounds) return null;

  const volume =
    (bounds.max[0] - bounds.min[0]) * (bounds.max[1] - bounds.min[1]) * (bounds.max[2] - bounds.min[2]);
  if (!(volume > 0)) return null;

  const r = PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS;
  // Receiver hits per bin required for the target error — inverse of eq. (b).
  const hitsPerBin = (DB_PER_RELATIVE_ERROR / PYROOMACOUSTICS_RAY_TRACING_MAX_ERROR_DB) ** 2;
  // Rays needed per expected hit per bin — inverse of eq. (a).
  const raysPerHit =
    volume / (Math.PI * r * r * DEFAULT_SPEED_OF_SOUND * PYROOMACOUSTICS_RAY_TRACING_HIST_BIN_SIZE);

  return {
    recommended: Math.ceil((hitsPerBin * raysPerHit) / RAY_COUNT_ROUNDING) * RAY_COUNT_ROUNDING,
    volume,
  };
}
