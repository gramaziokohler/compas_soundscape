"""Cloudflare Access JWT verification.

Cloudflare Access authenticates users by email before forwarding the request to
the origin and attaches a signed JWT (``Cf-Access-Jwt-Assertion`` header, and
``CF_Authorization`` cookie). We verify that JWT against the team's JWKS and use
the ``email`` claim as the user identity — so the user never re-types their
email and no custom login flow is needed.

Requires ``PyJWT[crypto]``. When Cloudflare is not configured this module
returns ``None`` (the caller falls back to the anonymous session cookie), so
local development without Cloudflare keeps working.
"""

import logging
import threading
from typing import Optional

from config.constants import (
    CF_ACCESS_AUD,
    CF_ACCESS_COOKIE,
    CF_ACCESS_JWT_HEADER,
    CF_ACCESS_JWT_LEEWAY_S,
    CF_ACCESS_JWKS_CACHE_TTL_S,
    CF_ACCESS_TEAM_DOMAIN,
)

try:  # PyJWT is optional at import time so the app still boots without it.
    import jwt
    from jwt import PyJWKClient

    _JWT_AVAILABLE = True
except Exception:  # pragma: no cover - exercised only when the dep is missing
    jwt = None  # type: ignore[assignment]
    PyJWKClient = None  # type: ignore[assignment]
    _JWT_AVAILABLE = False


logger = logging.getLogger(__name__)

_jwks_client = None
_jwks_lock = threading.Lock()


def cf_configured() -> bool:
    """True when Cloudflare Access enforcement is enabled via env."""
    return bool(CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD)


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None:
        with _jwks_lock:
            if _jwks_client is None:
                certs_url = f"https://{CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs"
                try:
                    _jwks_client = PyJWKClient(
                        certs_url,
                        cache_keys=True,
                        lifespan=CF_ACCESS_JWKS_CACHE_TTL_S,
                    )
                except TypeError:
                    # Older PyJWT without the `lifespan` kwarg.
                    _jwks_client = PyJWKClient(certs_url, cache_keys=True)
    return _jwks_client


def verify_cf_jwt(token: str) -> Optional[str]:
    """Verify a Cloudflare Access JWT and return the lower-cased email.

    Checks the signature (RS256 via the team JWKS), issuer, audience, and
    expiry. Returns ``None`` on any failure.
    """
    if not _JWT_AVAILABLE:
        logger.error("PyJWT is not installed — cannot verify Cloudflare Access tokens.")
        return None
    if not token:
        return None

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=CF_ACCESS_AUD,
            issuer=f"https://{CF_ACCESS_TEAM_DOMAIN}",
            # Tolerate a small origin<->Cloudflare clock skew: without it a
            # freshly issued token (nbf/iat in the "near future" relative to a
            # lagging origin clock) is rejected, and the request silently falls
            # back to an anonymous session.
            leeway=CF_ACCESS_JWT_LEEWAY_S,
            options={"require": ["exp", "iss", "aud"]},
        )
    except Exception as exc:  # noqa: BLE001 - any verification failure is a reject
        logger.warning("Cloudflare Access JWT rejected: %s", exc)
        return None

    email = str(claims.get("email") or "").strip().lower()
    if not email:
        logger.warning(
            "Cloudflare Access JWT verified but has no `email` claim (claims: %s)",
            sorted(claims.keys()),
        )
        return None
    return email


def extract_email(request) -> Optional[str]:
    """Pull + verify the email from the CF header (preferred) or cookie.

    The header is only trustworthy when the origin is reachable *solely* through
    Cloudflare (Tunnel / Authenticated Origin Pulls). The JWT signature check
    still protects against forged headers if the origin is ever exposed.

    Both sources are tried: a stale/invalid ``Cf-Access-Jwt-Assertion`` header
    must not mask a valid ``CF_Authorization`` cookie (and vice versa). This is
    the difference between resolving the real user and silently degrading to an
    anonymous session when a browser returns from a new network/IP with only one
    of the two credentials refreshed.
    """
    for source, token in (
        ("header", request.headers.get(CF_ACCESS_JWT_HEADER)),
        ("cookie", request.cookies.get(CF_ACCESS_COOKIE)),
    ):
        if not token:
            continue
        email = verify_cf_jwt(token)
        if email:
            return email
        logger.info("Cloudflare Access %s token present but not verifiable", source)
    return None
