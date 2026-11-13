"""BENCHMARK SCENES: link the input files of each scene here.

A scene is one measured setup of the BRAS reference scenes (RS1-RS7):

    geometry      the BRAS SketchUp model (.skp, read directly) or an OBJ of the objects; the floor of
                  a hemi-anechoic chamber is added by ``ground`` (it must span the whole domain)
    materials     material name in the model -> BRAS 3-line material CSV (several materials allowed);
                  .skp faces whose material is not listed are left out (icons, supports, floor patch)
    measurements  SOFA GeneralFIR with the measured IRs (positions come from the .skp labels)
    source        loudspeaker directivity file; orientations come from the .skp labels
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


def _rs(n: int, folder: str) -> Path:
    return BRAS_ROOT / f"1_scene_descriptions-RS{n}/1 Scene descriptions/{folder}"


RS1 = _rs(1, "RS1 single reflection (infinite plate)")
RS2 = _rs(2, "RS2 single reflection (finite plate)")
RS3 = _rs(3, "RS3 multiple reflection (parallel finite plates)")
RS4 = _rs(4, "RS4 single reflection (reflector array)")
RS5 = _rs(5, "RS5 diffraction (infinite wedge)")
RS6 = _rs(6, "RS6 diffraction (finite body)")
RS7 = _rs(7, "RS7 multiple diffraction (seat dip effect)")


# ═══ 2. What each field means ═══════════════════════════════════════════════
@dataclass(frozen=True)
class GeometryInput:
    skp: Optional[Path] = None            # BRAS SketchUp model, read directly (metres, Z up); or
    obj: Optional[Path] = None            # an OBJ export of the objects only
    up_axis: str = "y"                    # OBJ: "y" for SketchUp / Rhino exports (rotated to the Z-up SOFA frame)
    material_key: str = "usemtl"          # OBJ: face label that picks the material, "usemtl" or "group" (g / o lines)
    scale: float = 1.0                    # model units -> metres (0.001 for an OBJ in millimetres)
    expected_bbox: Optional[tuple] = None  # ((xmin, ymin, zmin), (xmax, ymax, zmax)) m of the kept faces, checked
    extrude: dict = field(default_factory=dict)  # .skp material pattern -> (dx, dy, dz) m: a layer drawn as one
                                                 # face (the RS2 absorber) becomes a closed slab
    empty_bbox: Optional[tuple] = None    # scenes without any object (floor only): where the empty-domain
                                          # markers go and what the grid is aligned to

    @property
    def path(self) -> Path:
        return self.skp if self.skp is not None else self.obj


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
                                                      # toward +y, theta up); read from the .skp labels when
                                                      # empty; with aim_point too -> checked to agree
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


@dataclass(frozen=True)
class AnimationSpec:
    enabled: bool = True
    source: str = "LS1"                   # loudspeaker of the omni pulse
    receiver: str = "MP1"                 # microphone whose IRs are drawn next to the field
    plane_z: Optional[float] = None       # horizontal plane (m); None = the loudspeaker's height
    duration_ms: float = 36.0


@dataclass(frozen=True)
class PraSpec:
    """The second engine: the app's pyroomacoustics path (geometrical acoustics), run on the CPU
    while PFFDTD uses the GPU and drawn as a third curve."""
    enabled: bool = True
    max_order: int = 3                    # image-source order (the app's default)
    ray_tracing: bool = False             # the hybrid's ray-traced tail has no meaning in an open scene
    boxes: bool = False                   # each object as its bounding box: one wall per side (plates, partition,
                                          # body, rows); a layer drawn as one face (``extrude``) stays that face
    lift_m: float = 0.0                   # boxes standing on the floor raised this much (0: they stand on it)


@dataclass(frozen=True)
class Scene:
    name: str
    label: str
    geometry: GeometryInput
    materials: dict                       # model material name (fnmatch pattern) -> MaterialInput; "*" = rest (OBJ)
    measurements: Path                    # SOFA GeneralFIR (BRAS RS*_RIRs_*.sofa)
    source: SourceInput
    temperature_c: float                  # chamber conditions during the measurement
    humidity: float
    band_test: BandTest = field(default_factory=BandTest)
    gain_pair: str = "LS1-MP1"            # one level calibration: its direct sound sets the global gain
    smoke_pairs: tuple = ("LS1-MP1",)     # default pairs (all of them with BRAS_FULL=1)
    animation: AnimationSpec = field(default_factory=AnimationSpec)
    ground: Optional[GroundPlane] = None  # hemi-anechoic chamber floor (RS1, RS5-RS7)
    positions: str = "auto"               # "labels" (.skp text labels, authoritative per the BRAS documentation),
                                          # "sofa", or "auto" = labels when the model has them
    chamber: str = ""                     # for the report
    pra: PraSpec = field(default_factory=PraSpec)


# ═══ 3. The scenes ══════════════════════════════════════════════════════════
# One entry per measured setup of the BRAS documentation (Appendix "Reference scenes"). Geometry,
# positions and loudspeaker orientations are read from the .skp; the documentation gives the
# material of each scene in AllMaterials.pdf (the .skp texture names differ: "MDF12mm" in RS2-RS4 is
# the 25 mm MDF plate, mat_MDF25mmA_plane in RS2 / RS3 and mat_MDF25mmB_plane in RS4; "Plaster_Mortar_White" in RS2 is the RockFon absorber).
TU_BERLIN = "fully anechoic chamber, TU Berlin"
RWTH = "hemi-anechoic chamber, RWTH Aachen (reflective tiled floor)"

MDF_25MM = MaterialInput(csv=SURFACES / "mat_MDF25mmA_plane_00deg.csv")      # RS2, RS3
MDF_25MM_B = MaterialInput(csv=SURFACES / "mat_MDF25mmB_plane_00deg.csv")    # RS4, RS5 (same absorption data as A)
MDF_12MM = MaterialInput(csv=SURFACES / "mat_MDF12mm_plane_00deg.csv")       # RS1 diffusor, RS6, RS7
ROCKFON = MaterialInput(csv=SURFACES / "mat_RockFonSonarG_00deg.csv")        # RS1, RS2 absorber (normal incidence)
ROCKFON_45DEG = MaterialInput(csv=SURFACES / "mat_RockFonSonarG_45deg.csv")
TILES = MaterialInput(csv=SURFACES / "mat_Tiles.csv")                        # RWTH chamber floor
FLOOR = GroundPlane(z=0.0, material="floor")                                 # key "floor" of the scene's materials

GENELEC = SourceInput(directivity=GENELEC_8020C)   # orientations: the (phi, theta) of each LS label in the .skp
# geometric acoustics on RS1_absorbing and RS2-RS7: every object is a box (the absorber slab, a plate,
# the partition, the body, a row of blocks), so each side is one wall; the RS1 diffusor keeps its mesh
BOXES = PraSpec(boxes=True)

# Band test: two stages; the final one compares 125 Hz - 2 kHz (0.8 x 2.5 kHz). 27.456 points per
# wavelength at 500 Hz = 25 mm cells (the plate thickness). The free air per domain face is computed
# from the scene (bras_domain.edge_padding_m); a grid that does not fit the GPU (PFFDTD_GPU_MEMORY_GB)
# is coarsened first (bras_constants.PPW_MIN).
RS_STAGES = {500.0: 27.456, 2500.0: 10.0}
RS_BANDS = BandTest(stages=RS_STAGES, fmin_hz=125.0)
# RS3: flutter between two plates 10 m apart (29 ms per round trip): a 100 ms window holds three round trips
RS3_BANDS = BandTest(stages=RS_STAGES, fmin_hz=125.0, gate_ms=100.0, duration_s=0.14)

# RS2 (TU Berlin, 17.6 degC, 47 %): six loudspeakers on a 4 m arc aimed at the plate's reflection
# point (0, 0, 1.02); MP1-MP3 in front of the plate, MP4 / MP5 behind it.
RS2_SOURCE = SourceInput(directivity=GENELEC_8020C, aim_point=(0.0, 0.0, 1.02))
RS2_RIGID = {"MDF12mm": MDF_25MM}
RS2_MATERIALS = {"MDF12mm": MDF_25MM, "Plaster_Mortar_White": ROCKFON}
RS2_ABSORBER_SLAB = {"Plaster_Mortar_White": (-0.020, 0.0, 0.0)}   # 20 mm RockFon, drawn as its front face only
RS2_COMMON = dict(source=RS2_SOURCE, temperature_c=17.6, humidity=47.0, gain_pair="LS1-MP1", band_test=RS_BANDS,
                  smoke_pairs=("LS1-MP1", "LS4-MP4"), animation=AnimationSpec(source="LS1", receiver="MP1"),
                  chamber=TU_BERLIN, pra=BOXES)
RS2_2M = {**RS2_COMMON}
# RS1 (RWTH, 20.3 degC, 41.5 %): loudspeakers and microphones at 30 / 45 / 60 deg above a 4.2 x 4.2 m
# sample on the floor; all in the plane y = 2.985.
RS1_COMMON = dict(source=GENELEC, temperature_c=20.3, humidity=41.5, ground=FLOOR, gain_pair="LS3-MP3",
                  band_test=RS_BANDS, smoke_pairs=("LS1-MP1", "LS3-MP3"),
                  animation=AnimationSpec(source="LS1", receiver="MP1"), chamber=RWTH)
RS1_SAMPLE_FOOTPRINT = ((3.397, 0.881, 0.0), (7.603, 5.087, 0.05))   # where the absorber lies in the other variants


def _skp(folder: Path, name: str, **kw) -> GeometryInput:
    return GeometryInput(skp=folder / "Geometry" / name, **kw)


SCENES: dict[str, Scene] = {s.name: s for s in [
    # ── RS1: single reflection, "infinite" plate ──────────────────────────────
    Scene(name="RS1_rigid", label="RS1: reflection on the rigid floor",
          geometry=_skp(RS1, "RS1_RIR_Rigid.skp", empty_bbox=RS1_SAMPLE_FOOTPRINT),   # absorber and diffusor are hidden
          materials={"floor": TILES}, measurements=RS1 / "RIRs/RS1_RIRs_Rigid.sofa", **RS1_COMMON),
    Scene(name="RS1_absorbing", label="RS1: reflection on RockFon Sonar G (20 mm, on the floor)",
          geometry=_skp(RS1, "RS1_RIR_Absorbing.skp"),
          materials={"mat_RockFonSonarG": ROCKFON, "floor": TILES},
          measurements=RS1 / "RIRs/RS1_RIRs_Absorbing.sofa", **RS1_COMMON,
          pra=BOXES),   # the 49 tiles (1 mm slits) are one 4.2 x 4.2 m slab: one box on the floor
    Scene(name="RS1_diffuse", label="RS1: reflection on the MDF diffusor",
          geometry=_skp(RS1, "RS1_RIR_Diffuse.skp"),
          materials={"mat_MDF12mm_plane": MDF_12MM, "floor": TILES},
          measurements=RS1 / "RIRs/RS1_RIRs_Diffuse.sofa", **RS1_COMMON),
    # ── RS2: single reflection and diffraction, finite plate ──────────────────
    Scene(name="RS2_1m_rigid", label="RS2: 1 m MDF plate, rigid",
          geometry=_skp(RS2, "RS2_RIR_1mPlate_rigid.skp", expected_bbox=((-0.027, -0.5, 0.52), (-0.002, 0.5, 1.52))),
          materials=RS2_RIGID, measurements=RS2 / "RIRs/RS2_RIRs_1mPlate_rigid.sofa", **RS2_COMMON),
    Scene(name="RS2_1m_absorbing", label="RS2: 1 m MDF plate with RockFon Sonar G",
          geometry=_skp(RS2, "RS2_RIR_1mPlate_absorbing.skp", extrude=RS2_ABSORBER_SLAB),
          materials=RS2_MATERIALS, measurements=RS2 / "RIRs/RS2_RIRs_1mPlate_absorbing.sofa", **RS2_COMMON),
    Scene(name="RS2_2m_rigid", label="RS2: 2 m MDF plate, rigid",
          geometry=_skp(RS2, "RS2_RIR_2mPlate_rigid.skp"),
          materials=RS2_RIGID, measurements=RS2 / "RIRs/RS2_RIRs_2mPlate_rigid.sofa", **RS2_2M),
    # only LS1-LS3 / MP1-MP3 were measured with the 2 m absorbing plate
    Scene(name="RS2_2m_absorbing", label="RS2: 2 m MDF plate with RockFon Sonar G",
          geometry=_skp(RS2, "RS2_RIR_2mPlate_absorbing.skp", extrude=RS2_ABSORBER_SLAB,
                        expected_bbox=((-0.047, -1.0, 0.02), (0.0, 1.0, 2.02))),
          materials=RS2_MATERIALS, measurements=RS2 / "RIRs/RS2_RIRs_2mPlate_absorbing.sofa",
          **{**RS2_2M, "smoke_pairs": ("LS1-MP1", "LS3-MP3")}),
    # ── RS3: multiple reflection between two parallel 2 m plates (17.3 degC, 49.5 %) ──
    Scene(name="RS3", label="RS3: multiple reflection between two 2 m MDF plates",
          geometry=_skp(RS3, "RS3_RIR_2mPlateRigid.skp"), materials={"MDF12mm": MDF_25MM},
          measurements=RS3 / "RIRs/RS3_RIRs.sofa", source=GENELEC, temperature_c=17.3, humidity=49.5,
          gain_pair="LS1-MP1", smoke_pairs=("LS1-MP1",), band_test=RS3_BANDS,
          pra=PraSpec(max_order=8, boxes=True),   # three round trips between the plates in the 100 ms window
          animation=AnimationSpec(source="LS1", receiver="MP1", duration_ms=70.0), chamber=TU_BERLIN),
    # ── RS4: reflector array of nine 68 cm MDF plates (17.6 degC, 45.5 %) ─────
    Scene(name="RS4_on_center", label="RS4: reflector array, aimed at a plate centre",
          geometry=_skp(RS4, "RS4_RIR_onCenter.skp"), materials={"MDF12mm": MDF_25MM_B},
          measurements=RS4 / "RIRs/RS4_RIRs_onCenter.sofa", source=GENELEC, temperature_c=17.6, humidity=45.5,
          gain_pair="LS1-MP1", smoke_pairs=("LS1-MP1", "LS3-MP3"), band_test=RS_BANDS,
          animation=AnimationSpec(source="LS1", receiver="MP1"), chamber=TU_BERLIN, pra=BOXES),
    Scene(name="RS4_off_center", label="RS4: reflector array, aimed between two plates",
          geometry=_skp(RS4, "RS4_RIR_offCenter.skp"), materials={"MDF12mm": MDF_25MM_B},
          measurements=RS4 / "RIRs/RS4_RIRs_offCenter.sofa", source=GENELEC, temperature_c=17.6, humidity=45.5,
          gain_pair="LS4-MP4", smoke_pairs=("LS4-MP4", "LS6-MP6"), band_test=RS_BANDS,
          animation=AnimationSpec(source="LS4", receiver="MP4"), chamber=TU_BERLIN, pra=BOXES),
    # ── RS5: diffraction at a 2.07 m partition (RWTH, 20.3 degC, 40.3 %) ──────
    Scene(name="RS5", label="RS5: diffraction at a 2.07 m MDF partition",
          geometry=_skp(RS5, "RS5_RIR.skp"), materials={"mat_MDF25mmB_plane": MDF_25MM_B, "floor": TILES},
          measurements=RS5 / "RIRs/RS5_RIRs.sofa", source=GENELEC, temperature_c=20.3, humidity=40.3, ground=FLOOR,
          gain_pair="LS3-MP4", smoke_pairs=("LS3-MP4", "LS1-MP1"), band_test=RS_BANDS,
          animation=AnimationSpec(source="LS1", receiver="MP1"), chamber=RWTH, pra=BOXES),
    # ── RS6: diffraction around a 0.72 x 0.72 x 4.14 m body (RWTH, 19.9 degC, 40.1 %) ──
    Scene(name="RS6", label="RS6: diffraction around a finite MDF body",
          geometry=_skp(RS6, "RS6_RIR.skp"), materials={"mat_MDF12mm_plane": MDF_12MM, "floor": TILES},
          measurements=RS6 / "RIRs/RS6_RIRs.sofa", source=GENELEC, temperature_c=19.9, humidity=40.1, ground=FLOOR,
          gain_pair="LS3-MP3", smoke_pairs=("LS3-MP3", "LS1-MP2"), band_test=RS_BANDS,
          animation=AnimationSpec(source="LS2", receiver="MP2"), chamber=RWTH, pra=BOXES),
    # ── RS7: seat dip, 15 rows of 0.24 m blocks (RWTH, 19.2 degC, 40.3 %) ─────
    Scene(name="RS7", label="RS7: multiple diffraction over 15 rows of blocks (seat dip)",
          geometry=_skp(RS7, "RS7_RIR.skp"), materials={"mat_MDF12mm_plane": MDF_12MM, "floor": TILES},
          measurements=RS7 / "RIRs/RS7_RIRs.sofa", source=GENELEC, temperature_c=19.2, humidity=40.3, ground=FLOOR,
          gain_pair="LS2-MP4", smoke_pairs=("LS2-MP4", "LS1-MP1"), band_test=RS_BANDS,
          animation=AnimationSpec(source="LS2", receiver="MP1"), chamber=RWTH, pra=BOXES),
    # ── Variant: the RS2 absorber with its 45 deg in-situ absorption ──────────
    Scene(name="RS2_2m_absorbing_45deg", label="RS2: 2 m MDF plate with RockFon Sonar G (45 deg absorption)",
          geometry=_skp(RS2, "RS2_RIR_2mPlate_absorbing.skp", extrude=RS2_ABSORBER_SLAB),
          materials={"MDF12mm": MDF_25MM, "Plaster_Mortar_White": ROCKFON_45DEG},
          measurements=RS2 / "RIRs/RS2_RIRs_2mPlate_absorbing.sofa",
          **{**RS2_2M, "smoke_pairs": ("LS1-MP1", "LS3-MP3")}),
]}
# the scenes "run all" goes through (the documentation's reference scenes; variants are run by name)
RS_SCENES = [n for n in SCENES if not n.endswith("_45deg")]


DEFAULT_SCENE = "RS2_1m_rigid"
SCENE_ENV = "BRAS_SCENE"


def get_scene(name: Optional[str] = None) -> Scene:
    name = name or os.environ.get(SCENE_ENV, DEFAULT_SCENE)
    if name not in SCENES:
        raise KeyError(f"Unknown scene {name!r}; defined in scenes.py: {sorted(SCENES)}")
    return SCENES[name]


def missing_inputs(scene: Scene) -> list[Path]:
    """Input files of ``scene`` that are not on disk (the benchmark skips the scene if any)."""
    paths = [scene.geometry.path, scene.measurements]
    paths += [m.csv for m in scene.materials.values() if m.csv is not None]
    if scene.source.directivity is not None:
        paths.append(scene.source.directivity)
    return [p for p in paths if not Path(p).exists()]
