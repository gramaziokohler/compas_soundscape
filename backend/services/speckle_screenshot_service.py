"""
speckle_screenshot_service.py
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Server-side rendering of 3D mesh screenshots using matplotlib.

Takes the geometry dict returned by SpeckleService.get_model_geometry() and
produces 3 base64-encoded PNG data URIs that match the three views captured by
the frontend captureSceneScreenshots.ts utility:

  [0]  Diagonal exterior — azimuth 45°, elevation 30°
  [1]  Floor plan (top-down) — elevation 90°
  [2]  Side elevation — elevation 0°, azimuth 180°
"""

from __future__ import annotations

import io
import base64
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# View definitions mirror captureSceneScreenshots.ts shot order
_VIEWS = [
    {"elev": 30,  "azim": 45,   "title": "Diagonal View"},
    {"elev": 90,  "azim": -90,  "title": "Floor Plan (Top-Down)"},
    {"elev": 0,   "azim": 180,  "title": "Side Elevation"},
]

_FIG_SIZE = (8, 6)   # inches
_FIG_DPI  = 100
_FACE_COLOR = "#b0c4de"   # steel-blue — matches the default Speckle viewer material


def render_model_screenshots(geometry_data: dict) -> list[str]:
    """
    Render 3 orthographic-like views of a mesh and return base64 PNG data URIs.

    Args:
        geometry_data: Dict returned by SpeckleService.get_model_geometry().
            Expected keys: "vertices" (list of [x,y,z]) and "faces" (list of [v0,v1,v2]).

    Returns:
        List of exactly 3 "data:image/png;base64,..." strings.

    Raises:
        ValueError: if the geometry data contains no vertices or faces.
        ImportError: if matplotlib / numpy are not installed.
    """
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")          # non-interactive, thread-safe backend
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection   # noqa: F401 (registered by import)

    vertices = geometry_data.get("vertices") or []
    faces    = geometry_data.get("faces")    or []

    if not vertices or not faces:
        raise ValueError(
            "render_model_screenshots: geometry_data has no vertices or faces"
        )

    verts_np = np.array(vertices, dtype=float)   # (N, 3)

    # Build the triangle list consumed by Poly3DCollection
    triangles = []
    for face in faces:
        if len(face) == 3:
            triangles.append([verts_np[i].tolist() for i in face])

    if not triangles:
        raise ValueError("render_model_screenshots: no valid triangles to render")

    # Scene bounds — used to set equal-aspect axes
    center = verts_np.mean(axis=0)
    half   = (verts_np.max(axis=0) - verts_np.min(axis=0)).max() * 0.55 + 1e-6

    screenshots: list[str] = []

    for view in _VIEWS:
        fig = plt.figure(figsize=_FIG_SIZE, dpi=_FIG_DPI)
        ax  = fig.add_subplot(111, projection="3d")

        poly = Poly3DCollection(triangles, alpha=0.85, linewidth=0)
        poly.set_facecolor(_FACE_COLOR)
        ax.add_collection3d(poly)

        ax.set_xlim(center[0] - half, center[0] + half)
        ax.set_ylim(center[1] - half, center[1] + half)
        ax.set_zlim(center[2] - half, center[2] + half)

        ax.view_init(elev=view["elev"], azim=view["azim"])
        ax.set_title(view["title"], fontsize=10)
        ax.set_xlabel("X", fontsize=7)
        ax.set_ylabel("Y", fontsize=7)
        ax.set_zlabel("Z", fontsize=7)
        ax.tick_params(labelsize=6)

        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=_FIG_DPI)
        plt.close(fig)
        buf.seek(0)
        b64 = base64.b64encode(buf.read()).decode("ascii")
        screenshots.append(f"data:image/png;base64,{b64}")

    logger.info(
        f"render_model_screenshots: rendered {len(screenshots)} view(s) "
        f"from {len(triangles)} triangles"
    )
    return screenshots
