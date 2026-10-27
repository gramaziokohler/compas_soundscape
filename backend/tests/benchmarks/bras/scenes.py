"""BENCHMARK SCENES: link the input files of each scene here.

A scene is one measured setup of the BRAS reference scenes (RS1-RS7):

    geometry      OBJ of the objects only (plate, wedge, blocks, ...); the floor of a
                  hemi-anechoic chamber is added by ``ground`` (it must span the whole domain)
    materials     OBJ material / group name -> BRAS 3-line material CSV (several materials allowed)
    measurements  SOFA GeneralFIR with the measured IRs and every source / receiver position
    source        loudspeaker directivity file + orientation of each loudspeaker
    band_test     simulated bands (fmax stages) and how the comparison is done

Add a scene: copy an entry of ``SCENES``, change the paths, then run (from backend/)

    BRAS_SCENE=<name> python -m pytest tests/benchmarks/bras -m bras_benchmark -s

Everything below is plain data: no code outside this file needs to change for a new RS scene.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ═══ 1. Where the data lives ════════════════════════════════════════════════
BRAS_ROOT = Path(os.environ.get("BRAS_ROOT", r"G:\My Drive\03_ETH Acoustic\06_Case studies\BRAS Benchmark"))

SURFACES = BRAS_ROOT / "3_surface_descriptions/3 Surface descriptions/_csv/initial_estimates"
GENELEC_8020C = (BRAS_ROOT / "2_source_and_receiver_descriptions-Genelec_8020c/2 Source and receiver descriptions"
                 / "Genelec 8020c/Genelec8020c_1x1_64442_IR_front_pole.csv")
RS2 = BRAS_ROOT / "1_scene_descriptions-RS2/1 Scene descriptions/RS2 single reflection (finite plate)"


# ═══ 2. What each field means ═══════════════════════════════════════════════
@dataclass(frozen=True)
class GeometryInput:
    obj: Path
    up_axis: str = "y"                    # "y": SketchUp / Rhino OBJ export (Y up), rotated to the Z-up SOFA frame
    material_key: str = "usemtl"          # face label that picks the material: "usemtl" or "group" (g / o lines)
    scale: float = 1.0                    # OBJ units -> metres (0.001 for millimetres)
    expected_bbox: Optional[tuple] = None  # ((xmin, ymin, zmin), (xmax, ymax, zmax)) m, checked after loading


@dataclass(frozen=True)
class MaterialInput:
    csv: Optional[Path] = None            # BRAS _csv file: line 1 third-octave centres (Hz), line 2 absorption
    alpha: Optional[float] = None         # or one absorption coefficient for every band


RIGID = MaterialInput(alpha=1e-3)         # the solver's minimum absorption


@dataclass(frozen=True)
class GroundPlane:
    """Reflective floor of a hemi-anechoic chamber, spanning the whole padded domain."""
    z: float = 0.0
    material: str = "floor"               # key of ``Scene.materials``


@dataclass(frozen=True)
class SourceInput:
    directivity: Optional[Path] = None    # BRAS *_IR_front_pole.csv or a SOFA source balloon (None = omni)
    directivity_format: str = "bras_csv"  # "bras_csv" | "sofa"
    aim_point: Optional[tuple] = None     # every loudspeaker points at this position (m), and / or
    orientations: dict = field(default_factory=dict)  # "LS1": (phi, theta) deg, BRAS labels (phi from +x
                                                      # toward +y, theta up); both given -> checked to agree
    phase: bool = True                    # put the loudspeaker's phase on the simulated IRs (bras_csv only)


@dataclass(frozen=True)
class BandTest:
    stages: dict = field(default_factory=lambda: {500.0: 27.456, 2000.0: 10.0})  # fmax (Hz) -> points per wavelength
    fmin_hz: float = 100.0                # compared band: fmin_hz ... fmax_fraction * fmax
    fmax_fraction: float = 0.8            # the solver's low-pass sits at fmax
    bands_per_octave: int = 3             # level-difference bands (3 = third octaves, 1 = octaves)
    smoothing_fraction: int = 12          # frequency-response curves: 1/12 octave smoothing
    gate_ms: float = 17.0                 # analysis window: pre_ms before to gate_ms after the direct sound
    pre_ms: float = 2.0
    duration_s: float = 0.05              # simulated IR length (longest direct path + gate + margin)
    padding_m: dict = field(default_factory=dict)  # fmax -> free air (m) for that stage (else Scene.padding_m);
                                          # less padding = smaller grid, the domain-edge echo is removed anyway


@dataclass(frozen=True)
class AnimationSpec:
    enabled: bool = True
    source: str = "LS1"                   # loudspeaker of the omni pulse
    receiver: str = "MP1"                 # microphone whose IRs are drawn next to the field
    plane_z: Optional[float] = None       # horizontal plane (m); None = the loudspeaker's height
    duration_ms: float = 36.0


@dataclass(frozen=True)
class Scene:
    name: str
    label: str
    geometry: GeometryInput
    materials: dict                       # OBJ material / group name (fnmatch pattern) -> MaterialInput; "*" = rest
    measurements: Path                    # SOFA GeneralFIR (BRAS RS*_RIRs_*.sofa)
    source: SourceInput
    temperature_c: float                  # chamber conditions during the measurement
    humidity: float
    band_test: BandTest = field(default_factory=BandTest)
    gain_pair: str = "LS1-MP1"            # one level calibration: its direct sound sets the global gain
    smoke_pairs: tuple = ("LS1-MP1",)     # default pairs (all of them with BRAS_FULL=1)
    animation: AnimationSpec = field(default_factory=AnimationSpec)
    ground: Optional[GroundPlane] = None  # hemi-anechoic chamber floor (RS1, RS5-RS7)
    padding_m: float = 3.0                # free air around everything (the domain edge echo is removed)


# ═══ 3. The scenes ══════════════════════════════════════════════════════════
# RS2 (TU Berlin, fully anechoic, 17.6 degC, 47 %): six Genelec 8020c on a 4 m arc, all aimed at the
# plate's reflection point (0, 0, 1.02); MP1-MP3 in front of the plate, MP4/MP5 behind it.
RS2_SOURCE = SourceInput(
    directivity=GENELEC_8020C, aim_point=(0.0, 0.0, 1.02),
    orientations={"LS1": (-150, 0), "LS2": (-135, 0), "LS3": (-120, 0), "LS4": (150, 0), "LS5": (135, 0), "LS6": (120, 0)},
)
# Band test: 125 Hz - 2 kHz on the final stage (compared up to 0.8 fmax = 2 kHz, so fmax = 2.5 kHz;
# 2.5 m of padding keeps that grid within the 8 GB GPU: h = 12.5 mm, 348 M nodes).
RS2_BANDS = BandTest(stages={500.0: 27.456, 2500.0: 10.0}, fmin_hz=125.0, padding_m={2500.0: 2.5})
RS2_COMMON = dict(source=RS2_SOURCE, temperature_c=17.6, humidity=47.0, gain_pair="LS1-MP1", band_test=RS2_BANDS,
                  smoke_pairs=("LS1-MP1", "LS4-MP4"), animation=AnimationSpec(source="LS1", receiver="MP1"))
# The 2 m plate (2 x 2 m) makes the domain larger: 2.3 m of padding keeps it within the GPU budget.
RS2_2M_BANDS = BandTest(stages=RS2_BANDS.stages, fmin_hz=RS2_BANDS.fmin_hz, padding_m={2500.0: 2.3})
MDF_25MM = MaterialInput(csv=SURFACES / "mat_MDF25mmA_plane_00deg.csv")
ROCKFON = MaterialInput(csv=SURFACES / "mat_RockFonSonarG_00deg.csv")
ROCKFON_45DEG = MaterialInput(csv=SURFACES / "mat_RockFonSonarG_45deg.csv")  # LS1-LS3 hit the plate at 30 / 45 / 60 deg

SCENES: dict[str, Scene] = {
    "RS2_1m_rigid": Scene(
        name="RS2_1m_rigid", label="RS2: 1 m MDF plate, rigid",
        geometry=GeometryInput(obj=RS2 / "Geometry/RS2_RIR_1mPlate_rigid.obj",
                               expected_bbox=((-0.027, -0.5, 0.52), (-0.002, 0.5, 1.52))),
        materials={"*": MDF_25MM},
        measurements=RS2 / "RIRs/RS2_RIRs_1mPlate_rigid.sofa",
        **RS2_COMMON,
    ),
    # Export the OBJs below from the .skp with one material (usemtl) per surface type, e.g.
    # "RockFon" on the absorber faces and "MDF" elsewhere; patterns are matched in order, "*" last.
    "RS2_1m_absorbing": Scene(
        name="RS2_1m_absorbing", label="RS2: 1 m MDF plate with RockFon Sonar G",
        geometry=GeometryInput(obj=RS2 / "Geometry/RS2_RIR_1mPlate_absorbing.obj"),
        materials={"*RockFon*": ROCKFON, "*": MDF_25MM},
        measurements=RS2 / "RIRs/RS2_RIRs_1mPlate_absorbing.sofa",
        **RS2_COMMON,
    ),
    "RS2_2m_rigid": Scene(
        name="RS2_2m_rigid", label="RS2: 2 m MDF plate, rigid",
        geometry=GeometryInput(obj=RS2 / "Geometry/RS2_RIR_2mPlate_rigid.obj"),
        materials={"*": MDF_25MM},
        measurements=RS2 / "RIRs/RS2_RIRs_2mPlate_rigid.sofa",
        **RS2_COMMON,
    ),
    # The Rhino OBJ has no usemtl, the groups pick the material: "reflection" = the 25 mm MDF plate
    # (x -0.047 .. -0.022), "absorbption" (sic) = the 20 mm RockFon layer on the loudspeaker side
    # (x -0.020 .. 0). Only LS1-LS3 / MP1-MP3 were measured with the 2 m absorbing plate.
    "RS2_2m_absorbing": Scene(
        name="RS2_2m_absorbing", label="RS2: 2 m MDF plate with RockFon Sonar G",
        geometry=GeometryInput(obj=RS2 / "Geometry/RS2_RIR_2mPlate_absorbing.obj", material_key="group",
                               expected_bbox=((-0.047, -1.0, 0.02), (0.0, 1.0, 2.02))),
        materials={"absorb*": ROCKFON, "*": MDF_25MM},
        measurements=RS2 / "RIRs/RS2_RIRs_2mPlate_absorbing.sofa",
        **{**RS2_COMMON, "smoke_pairs": ("LS1-MP1", "LS3-MP3"), "band_test": RS2_2M_BANDS},
    ),
    "RS2_2m_absorbing_45deg": Scene(
        name="RS2_2m_absorbing_45deg", label="RS2: 2 m MDF plate with RockFon Sonar G (45 deg absorption)",
        geometry=GeometryInput(obj=RS2 / "Geometry/RS2_RIR_2mPlate_absorbing.obj", material_key="group",
                               expected_bbox=((-0.047, -1.0, 0.02), (0.0, 1.0, 2.02))),
        materials={"absorb*": ROCKFON_45DEG, "*": MDF_25MM},
        measurements=RS2 / "RIRs/RS2_RIRs_2mPlate_absorbing.sofa",
        **{**RS2_COMMON, "smoke_pairs": ("LS1-MP1", "LS3-MP3"), "band_test": RS2_2M_BANDS},
    ),
    # Template for a hemi-anechoic scene (RWTH chamber, tiled floor): fill in the paths and the
    # loudspeaker orientations from the scene description, then uncomment.
    # "RS5_wedge": Scene(
    #     name="RS5_wedge", label="RS5: diffraction at a 2.07 m MDF partition",
    #     geometry=GeometryInput(obj=BRAS_ROOT / "1_scene_descriptions-RS5/.../RS5_RIR.obj"),
    #     materials={"*": MaterialInput(csv=SURFACES / "mat_MDF25mmB_plane_00deg.csv"),
    #                "floor": MaterialInput(csv=SURFACES / "mat_Tiles.csv")},
    #     measurements=BRAS_ROOT / "1_scene_descriptions-RS5/.../RS5_RIRs.sofa",
    #     source=SourceInput(directivity=GENELEC_8020C, orientations={"LS1": (0, 0), ...}),
    #     temperature_c=20.3, humidity=40.3, ground=GroundPlane(z=0.0, material="floor"),
    #     smoke_pairs=("LS1-MP1",),
    # ),
}

DEFAULT_SCENE = "RS2_1m_rigid"
SCENE_ENV = "BRAS_SCENE"


def get_scene(name: Optional[str] = None) -> Scene:
    name = name or os.environ.get(SCENE_ENV, DEFAULT_SCENE)
    if name not in SCENES:
        raise KeyError(f"Unknown scene {name!r}; defined in scenes.py: {sorted(SCENES)}")
    return SCENES[name]


def missing_inputs(scene: Scene) -> list[Path]:
    """Input files of ``scene`` that are not on disk (the benchmark skips the scene if any)."""
    paths = [scene.geometry.obj, scene.measurements]
    paths += [m.csv for m in scene.materials.values() if m.csv is not None]
    if scene.source.directivity is not None:
        paths.append(scene.source.directivity)
    return [p for p in paths if not Path(p).exists()]
