# backend/models/schemas.py
# Pydantic Models for Request Bodies

from pydantic import BaseModel


class PromptRequest(BaseModel):
    prompt: str | None = None
    num_sounds: int = 5
    entities: list[dict] | None = None


class SoundGenerationRequest(BaseModel):
    sounds: list[dict]
    bounding_box: dict | None = None
    apply_denoising: bool = False


class IFCEntityInfo(BaseModel):
    index: int
    type: str
    name: str | None
    position: list[float]


class IFCSoundGenerationRequest(BaseModel):
    entities: list[IFCEntityInfo]
    max_sounds: int = 10


class IFCPromptGenerationRequest(BaseModel):
    entities: list[IFCEntityInfo]
    max_sounds: int = 10


class RhinoEntityInfo(BaseModel):
    index: int
    type: str
    name: str | None
    layer: str | None
    material: str | None
    position: list[float]


class RhinoSoundGenerationRequest(BaseModel):
    entities: list[RhinoEntityInfo]
    max_sounds: int = 10


class RhinoPromptGenerationRequest(BaseModel):
    entities: list[RhinoEntityInfo]
    max_sounds: int = 10


class UnifiedPromptGenerationRequest(BaseModel):
    context: str | None = None
    num_sounds: int = 5
    entities: list[dict] | None = None
