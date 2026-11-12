"""Ambisonic frame of the wave solver's outputs (numpy only, importable from every backend env).

The pressure-gradient encoding (postprocess.foa_channels, free_ir.reciprocal_channels) works on
the world axes: X channel = world +X, Y channel = world +Y. The geometric engines
(pyroomacoustics, compas_acoustics) and playback use the listener frame instead, whose front is
world -Y, left world +X and up world +Z (PyroomacousticsService.add_receiver_to_room). Every FOA
IR the wave solver writes is turned into that frame, so PFFDTD, compas_acoustics and hybrid
responses sound from the same directions.
"""

from __future__ import annotations

import numpy as np


def world_to_listener_foa(channels: np.ndarray) -> np.ndarray:
    """First-order AmbiX [W, Y, Z, X] (channels first) from world axes to the listener frame.

    X_listener = -Y_world (front), Y_listener = X_world (left), Z unchanged. Anything that is not
    4 channels (a mono response) is returned unchanged.
    """
    channels = np.asarray(channels)
    if channels.ndim != 2 or channels.shape[0] != 4:
        return channels
    w, y, z, x = channels
    return np.vstack([w, x, z, -y])
