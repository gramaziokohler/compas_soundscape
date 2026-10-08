"""VirtualUser: one simulated browser session (own identity, own cookies)."""

from __future__ import annotations

import re
import time
from contextlib import asynccontextmanager
from http.cookies import SimpleCookie
from typing import AsyncIterator, Optional

import httpx

from config import (
    CF_CLIENT_ID_HEADER,
    CF_CLIENT_SECRET_HEADER,
    CONNECT_TIMEOUT_S,
    HTTP_TIMEOUT_S,
    KEEPALIVE_EXPIRY_S,
    LOADTEST_USER_HEADER,
    USER_AGENT,
    RunConfig,
)
from metrics import Metrics, RequestSample

# Collapse ids in paths so samples group per endpoint.
_ID_SEGMENT = re.compile(r"/(?:[0-9a-fA-F-]{16,}|loadtest-[\w-]+)(?=/|$)")
_STATIC_HASH = re.compile(r"/_next/static/.*$")


def endpoint_name(method: str, path: str) -> str:
    path = path.split("?", 1)[0]
    if path.startswith("/_next/static/"):
        path = _STATIC_HASH.sub("/_next/static/*", path)
    return f"{method} {_ID_SEGMENT.sub('/{id}', path)}"


class AccessDeniedError(RuntimeError):
    """The Cloudflare edge redirected to its login page (service token rejected)."""


class VirtualUser:
    """Wraps an httpx client with per-user auth headers and manual cookie handling.

    Cookies are tracked by hand (not by httpx's jar) because the backend sets
    ``Secure`` cookies, which a standard jar refuses to send back over plain
    http — that would turn every request of a local smoke run into a brand-new
    anonymous user.
    """

    def __init__(self, index: int, cfg: RunConfig, metrics: Metrics) -> None:
        self.index = index
        self.user_id = f"vu-{index + 1:02d}"
        self.cfg = cfg
        self.metrics = metrics
        self.workspace_id: Optional[str] = None
        self.email: Optional[str] = None
        self._cookies: dict[str, str] = {}

        headers = {"User-Agent": USER_AGENT, LOADTEST_USER_HEADER: self.user_id}
        if cfg.has_service_token:
            headers[CF_CLIENT_ID_HEADER] = cfg.cf_client_id
            headers[CF_CLIENT_SECRET_HEADER] = cfg.cf_client_secret
        self.client = httpx.AsyncClient(
            base_url=cfg.base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(HTTP_TIMEOUT_S, connect=CONNECT_TIMEOUT_S),
            limits=httpx.Limits(keepalive_expiry=KEEPALIVE_EXPIRY_S),
            follow_redirects=False,
            verify=cfg.verify_tls,
        )

    async def close(self) -> None:
        await self.client.aclose()

    # ─── Cookies ─────────────────────────────────────────────────────────
    def _cookie_header(self) -> dict[str, str]:
        if not self._cookies:
            return {}
        return {"Cookie": "; ".join(f"{k}={v}" for k, v in self._cookies.items())}

    def _absorb_cookies(self, response: httpx.Response) -> None:
        for raw in response.headers.get_list("set-cookie"):
            parsed = SimpleCookie()
            try:
                parsed.load(raw)
            except Exception:  # noqa: BLE001 - ignore malformed cookies
                continue
            for name, morsel in parsed.items():
                self._cookies[name] = morsel.value
        self.client.cookies.clear()

    @staticmethod
    def _check_access(response: httpx.Response) -> None:
        location = response.headers.get("location", "")
        if response.status_code in (301, 302, 303) and "cloudflareaccess.com" in location:
            raise AccessDeniedError("Cloudflare Access redirected to login — check the service token + Service Auth policy")

    # ─── Requests ────────────────────────────────────────────────────────
    async def request(self, method: str, path: str, *, name: str | None = None, **kwargs) -> Optional[httpx.Response]:
        """Send a request and record its timing. Returns None on transport error."""
        label = name or endpoint_name(method, path)
        headers = {**kwargs.pop("headers", {}), **self._cookie_header()}
        start = time.perf_counter()
        try:
            response = await self.client.request(method, path, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            self.metrics.record(RequestSample(label, 0, time.perf_counter() - start, f"{type(exc).__name__}: {exc}"))
            return None
        self.metrics.record(RequestSample(label, response.status_code, time.perf_counter() - start,
                                          None if response.status_code < 400 else response.text[:200]))
        self._absorb_cookies(response)
        self._check_access(response)
        return response

    async def get(self, path: str, **kwargs) -> Optional[httpx.Response]:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs) -> Optional[httpx.Response]:
        return await self.request("POST", path, **kwargs)

    @asynccontextmanager
    async def stream(self, method: str, path: str, **kwargs) -> AsyncIterator[httpx.Response]:
        """Streaming request (SSE). Timing recorded is time-to-headers."""
        label = endpoint_name(method, path)
        headers = {**kwargs.pop("headers", {}), **self._cookie_header()}
        start = time.perf_counter()
        async with self.client.stream(method, path, headers=headers, **kwargs) as response:
            self.metrics.record(RequestSample(label, response.status_code, time.perf_counter() - start))
            self._absorb_cookies(response)
            self._check_access(response)
            yield response
