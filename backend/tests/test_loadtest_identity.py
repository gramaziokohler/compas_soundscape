"""
Unit tests for the load-test identity path in services/access_service.py.

Run: pytest backend/tests/test_loadtest_identity.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/

from services import access_service  # noqa: E402
from config.constants import CF_ACCESS_JWT_HEADER, LOADTEST_USER_HEADER  # noqa: E402

ALLOWED_CN = "allowed-client-id.access"


def _request(user_id: str | None = "vu-01", jwt: str | None = "token") -> SimpleNamespace:
    headers = {}
    if jwt is not None:
        headers[CF_ACCESS_JWT_HEADER] = jwt
    if user_id is not None:
        headers[LOADTEST_USER_HEADER] = user_id
    return SimpleNamespace(headers=headers, cookies={})


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(access_service, "LOADTEST_SERVICE_TOKEN_IDS", frozenset({ALLOWED_CN}))


def _claims(monkeypatch, claims: dict | None) -> None:
    monkeypatch.setattr(access_service, "_verify_cf_claims", lambda _token: claims)


def test_allowlisted_service_token_maps_to_loadtest_user(enabled, monkeypatch):
    _claims(monkeypatch, {"common_name": ALLOWED_CN})
    assert access_service.extract_loadtest_email(_request("VU-07")) == "loadtest-vu-07@loadtest.local"


def test_unknown_service_token_is_rejected(enabled, monkeypatch):
    _claims(monkeypatch, {"common_name": "someone-else.access"})
    assert access_service.extract_loadtest_email(_request()) is None


@pytest.mark.parametrize("user_id", [None, "", "bad id", "x" * 33, "../etc"])
def test_invalid_user_header_is_rejected(enabled, monkeypatch, user_id):
    _claims(monkeypatch, {"common_name": ALLOWED_CN})
    assert access_service.extract_loadtest_email(_request(user_id)) is None


def test_unverifiable_jwt_is_rejected(enabled, monkeypatch):
    _claims(monkeypatch, None)
    assert access_service.extract_loadtest_email(_request()) is None


def test_feature_off_by_default(monkeypatch):
    monkeypatch.setattr(access_service, "LOADTEST_SERVICE_TOKEN_IDS", frozenset())
    _claims(monkeypatch, {"common_name": ALLOWED_CN})
    assert access_service.extract_loadtest_email(_request()) is None


def test_user_jwt_is_not_remapped(enabled, monkeypatch):
    # A real user's JWT (has `email`) must never be turned into a load-test user,
    # even if the header is present — extract_email() handles it instead.
    _claims(monkeypatch, {"common_name": ALLOWED_CN, "email": "real@user.com"})
    assert access_service.extract_loadtest_email(_request()) is None
    assert access_service.verify_cf_jwt("token") == "real@user.com"
