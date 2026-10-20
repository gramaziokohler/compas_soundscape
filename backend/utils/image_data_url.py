"""Decode ``data:image/...;base64,`` URLs (bug-report and study-moment screenshots)."""

import base64
import binascii

# Magic-byte prefix → file extension of the accepted screenshot formats.
IMAGE_SIGNATURES: dict[bytes, str] = {
    b"\x89PNG\r\n\x1a\n": "png",
    b"\xff\xd8\xff": "jpg",
}


def decode_image_data_url(data_url: str, max_bytes: int) -> tuple[bytes, str]:
    """Decode a base64 image data URL; return ``(bytes, ext)``.

    Raises ``ValueError`` for malformed data, unsupported formats, or oversize images.
    """
    _, _, encoded = data_url.partition(",")
    if not encoded:
        raise ValueError("Screenshot must be a base64 data URL")
    # Base64 inflates by 4/3 — reject obviously oversize payloads before decoding.
    if len(encoded) * 3 // 4 > max_bytes:
        raise ValueError("Screenshot is too large")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Screenshot is not valid base64") from exc
    for signature, ext in IMAGE_SIGNATURES.items():
        if raw.startswith(signature):
            return raw, ext
    raise ValueError("Screenshot must be a PNG or JPEG image")
