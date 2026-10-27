"""Source orientation ↔ world rotation, shared by both simulation engines.

World frame (Speckle / three.js scene): right-handed, Z-up. The listener convention
of speckle-camera-controller.ts is reused for sources:

* yaw = 0 faces -Y, +yaw turns toward -X, +pitch tilts up (+Z),
  forward = (-sin(yaw)·cos(pitch), -cos(yaw)·cos(pitch), sin(pitch));
* roll turns about the forward axis (right-hand rule).

Balloon source frame (SOFA sources, BRAS front-pole CSV): +x front / on-axis,
+y left, +z up. ``rotation_matrix`` maps source-frame vectors to the world.
"""

from __future__ import annotations

import numpy as np

# Columns = world images of the source axes at yaw = pitch = roll = 0:
# source +x (front) -> -Y, source +y (left) -> +X, source +z (up) -> +Z.
SOURCE_TO_WORLD_BASE = np.array([[0.0, 1.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])


def _rx(a: float) -> np.ndarray:
    c, s = np.cos(a), np.sin(a)
    return np.array([[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]])


def _ry(a: float) -> np.ndarray:
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]])


def _rz(a: float) -> np.ndarray:
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def rotation_matrix(yaw: float = 0.0, pitch: float = 0.0, roll: float = 0.0) -> np.ndarray:
    """3x3 matrix taking source-frame vectors to world vectors.

    ``rotation_matrix(y, p, r) @ (1, 0, 0)`` equals the camera forward vector of
    the listener convention for every yaw / pitch (roll leaves the axis fixed).
    """
    return SOURCE_TO_WORLD_BASE @ _rz(-float(yaw)) @ _ry(-float(pitch)) @ _rx(float(roll))


def forward_vector(yaw: float = 0.0, pitch: float = 0.0) -> np.ndarray:
    """World unit vector the source points at."""
    return rotation_matrix(yaw, pitch, 0.0)[:, 0]


def rotate_source_frame(vectors: np.ndarray, yaw: float, pitch: float, roll: float) -> np.ndarray:
    """Rotate ``(n, 3)`` source-frame vectors into the world frame."""
    v = np.asarray(vectors, dtype=np.float64)
    return v @ rotation_matrix(yaw, pitch, roll).T


def spherical_to_cartesian(azimuth: np.ndarray, colatitude: np.ndarray) -> np.ndarray:
    """Radians (azimuth from +x in the xy plane, colatitude from +z) -> ``(n, 3)`` unit vectors."""
    az = np.asarray(azimuth, dtype=np.float64)
    col = np.asarray(colatitude, dtype=np.float64)
    return np.column_stack([np.sin(col) * np.cos(az), np.sin(col) * np.sin(az), np.cos(col)])


def front_pole_to_cartesian(phi_deg: np.ndarray, theta_deg: np.ndarray) -> np.ndarray:
    """BRAS front-pole angles -> ``(n, 3)`` unit vectors in the source frame.

    Theta is the angle from the +x front axis (0 front, 180 back); phi rotates about
    that axis (0 -> +z, 90 -> +y): x = cos T, y = sin T·sin P, z = sin T·cos P.
    """
    p = np.deg2rad(np.asarray(phi_deg, dtype=np.float64))
    t = np.deg2rad(np.asarray(theta_deg, dtype=np.float64))
    return np.column_stack([np.cos(t), np.sin(t) * np.sin(p), np.sin(t) * np.cos(p)])


def unit(vectors: np.ndarray) -> np.ndarray:
    """Normalise rows of ``(n, 3)`` to unit length (zero rows stay zero)."""
    v = np.asarray(vectors, dtype=np.float64)
    norm = np.linalg.norm(v, axis=-1, keepdims=True)
    return np.divide(v, norm, out=np.zeros_like(v), where=norm > 0)
