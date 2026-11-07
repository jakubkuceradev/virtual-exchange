"""Verify real token authentication, HTTP grants, and configuration lifecycle."""

import hashlib
import json
import logging
import traceback
from datetime import UTC, datetime
from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app
from virtual_exchange.auth import (
    AuthConfigurationError,
    AuthenticationFailed,
    Authenticator,
    PermissionDenied,
    require_permission,
)
from virtual_exchange.http_auth import identity_dependency, permission_dependency
from virtual_exchange.types import AuthenticatedIdentity, Permission

# Synthetic credentials exclusively for tests; never usable in a running deployment.
TOKENS = {
    "read": "test-alice-read",
    "both": "test-alice-both",
    "trade": "test-trade",
    "none": "test-none",
}
CHALLENGE = 'Bearer realm="exchange"'


def record(token, account="alice", permissions=("read",)):
    return {
        "token_sha256": hashlib.sha256(token.encode("ascii")).hexdigest(),
        "account_id": account,
        "permissions": list(permissions),
    }


def write_config(path, records):
    path.write_text(json.dumps({"version": 1, "credentials": records}))
    return path


@pytest.fixture
def config(tmp_path):
    return write_config(
        tmp_path / "credentials.json",
        [
            record(TOKENS["read"]),
            record(TOKENS["both"], permissions=("read", "trade")),
            record(TOKENS["trade"], permissions=("trade",)),
            record(TOKENS["none"], permissions=()),
        ],
    )


@pytest.fixture
def authenticator(config):
    return Authenticator.from_config(path=config)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    "kind,grants",
    [
        ("read", ["read"]),
        ("both", ["read", "trade"]),
        ("trade", ["trade"]),
        ("none", []),
    ],
)
def test_identity_cannot_be_selected_by_client(authenticator, kind, grants, caplog):
    caplog.set_level(logging.DEBUG)
    with TestClient(create_app(authenticator=authenticator)) as client:
        response = client.request(
            "GET",
            "/identity?account_id=bob",
            headers=bearer(TOKENS[kind]),
            json={"account_id": "bob"},
        )
    assert response.status_code == 200
    assert response.json() == {"account_id": "alice", "permissions": grants}
    assert response.headers["cache-control"] == "no-store"
    assert TOKENS[kind] not in response.text + caplog.text
    assert "token_sha256" not in response.text


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": ""},
        {"Authorization": "Basic test-alice-read"},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer "},
        {"Authorization": "Bearer test-alice-read extra"},
        {"Authorization": "Bearer test-alice-read,"},
        {"Authorization": "Bearer test-alice-read\t"},
        {"Authorization": "Bearer unknown-secret"},
        {"Authorization": "Bearer TEST-ALICE-READ"},
        [
            ("Authorization", "Bearer test-alice-read"),
            ("Authorization", "Bearer test-alice-both"),
        ],
    ],
)
def test_bad_credentials_have_generic_challenges(authenticator, headers, caplog):
    caplog.set_level(logging.DEBUG)
    with TestClient(create_app(authenticator=authenticator)) as client:
        response = client.get("/identity", headers=headers)
    assert response.status_code == 401
    assert response.json() == {
        "error": "invalid_token" if headers else "authentication_required"
    }
    assert response.headers["www-authenticate"] == CHALLENGE + (
        ', error="invalid_token"' if headers else ""
    )
    assert response.headers["cache-control"] == "no-store"
    for token in (*TOKENS.values(), "unknown-secret"):
        assert token not in response.text + caplog.text


def test_scheme_is_case_insensitive(authenticator):
    with TestClient(create_app(authenticator=authenticator)) as client:
        assert (
            client.get(
                "/identity", headers={"Authorization": "bEaReR  test-alice-read"}
            ).status_code
            == 200
        )


@pytest.mark.parametrize(
    "headers",
    [{}, bearer(TOKENS["read"]), {"Authorization": "not bearer"}, bearer("unknown")],
)
def test_health_ignores_optional_credentials(authenticator, headers):
    with TestClient(create_app(authenticator=authenticator)) as client:
        assert client.get("/health", headers=headers).json() == {"status": "ok"}
        assert client.get("/does-not-exist", headers=headers).status_code == 404


def test_tokens_in_query_or_form_do_not_authenticate(authenticator):
    with TestClient(create_app(authenticator=authenticator)) as client:
        assert client.get("/identity?access_token=synthetic-token").status_code == 401
        assert (
            client.request(
                "GET", "/identity", content="access_token=synthetic-token"
            ).status_code
            == 401
        )


@pytest.mark.parametrize("permission", list(Permission))
@pytest.mark.parametrize("kind", TOKENS)
def test_independent_grants_through_real_http_dependency(
    authenticator, permission, kind
):
    app = create_app(authenticator=authenticator)
    required = permission_dependency(
        identity=identity_dependency(authenticator), permission=permission
    )

    @app.get("/test-protected")
    def protected(identity: Annotated[AuthenticatedIdentity, Depends(required)]):
        return {"account_id": identity.account_id}

    with TestClient(app) as client:
        response = client.get("/test-protected", headers=bearer(TOKENS[kind]))
        assert client.get("/test-protected").status_code == 401
    allowed = kind == "both" or kind == permission.value
    assert response.status_code == (200 if allowed else 403)
    if not allowed:
        assert (
            response.headers["www-authenticate"]
            == f'{CHALLENGE}, error="insufficient_scope", scope="{permission.value}"'
        )
        assert response.json() == {"error": "insufficient_scope"}


def test_core_exact_tokens_immutable_snapshot_and_no_expiry(authenticator, monkeypatch):
    original = authenticator.authenticate(token=TOKENS["read"])

    class FutureClock:
        @classmethod
        def now(cls, *args):
            return datetime(2099, 1, 1, tzinfo=UTC)

    monkeypatch.setattr("datetime.datetime", FutureClock)
    assert authenticator.authenticate(token=TOKENS["read"]) == original
    with pytest.raises(PermissionDenied):
        require_permission(identity=original, permission=Permission.TRADE)
    for token in ("", " test-alice-read", "test-alice-read ", "é", None):
        with pytest.raises(AuthenticationFailed) as error:
            authenticator.authenticate(token=token)
        assert str(error.value) == "Authentication required"
    credentials = {record("test")["token_sha256"]: original}
    snapshot = Authenticator(credentials=credentials)
    credentials.clear()
    assert snapshot.authenticate(token="test") == original
    assert TOKENS["read"] not in repr(authenticator)


def test_restart_replacement_and_independent_tokens(config, monkeypatch):
    monkeypatch.setenv("EXCHANGE_AUTH_CONFIG", str(config))
    old_app = create_app()
    unchanged_app = create_app()
    write_config(
        config,
        [record("replacement"), record(TOKENS["both"], permissions=("read", "trade"))],
    )
    new_app = create_app()
    for app in (old_app, unchanged_app):
        with TestClient(app) as client:
            assert (
                client.get("/identity", headers=bearer(TOKENS["read"])).status_code
                == 200
            )
            assert (
                client.get("/identity", headers=bearer("replacement")).status_code
                == 401
            )
    config.unlink()  # Existing apps use snapshots, never per-request file reads.
    with TestClient(new_app) as client:
        assert (
            client.get("/identity", headers=bearer(TOKENS["read"])).status_code == 401
        )
        assert client.get("/identity", headers=bearer("replacement")).status_code == 200
        assert client.get("/identity", headers=bearer(TOKENS["both"])).json()[
            "permissions"
        ] == ["read", "trade"]
    with pytest.raises(AuthConfigurationError):
        create_app()


@pytest.mark.parametrize(
    "document",
    [
        [],
        None,
        {},
        {"version": True, "credentials": []},
        {"version": 2, "credentials": []},
        {"version": 1, "credentials": {}},
        {"version": 1, "credentials": [], "extra": "secret"},
        {"version": 1, "credentials": [record("secret", permissions=("admin",))]},
        {"version": 1, "credentials": [record("secret", account="")]},
        {"version": 1, "credentials": [record("secret", account=[])]},
        {"version": 1, "credentials": [record("secret"), record("secret")]},
        {
            "version": 1,
            "credentials": [
                {"token_sha256": "secret", "account_id": "alice", "permissions": []}
            ],
        },
        {
            "version": 1,
            "credentials": [
                {"token_sha256": [], "account_id": "alice", "permissions": []}
            ],
        },
        {"version": 1, "credentials": [record("secret", permissions=([],))]},
        {"version": 1, "credentials": [{**record("secret"), "token": "secret"}]},
        {"version": 1, "credentials": ["secret"]},
    ],
)
def test_invalid_configuration_is_sanitized(tmp_path, document, caplog):
    caplog.set_level(logging.DEBUG)
    path = tmp_path / "private.json"
    path.write_text(json.dumps(document))
    with pytest.raises(AuthConfigurationError) as error:
        Authenticator.from_config(path=path)
    assert str(error.value) == "Invalid authentication configuration"
    diagnostic = "".join(traceback.format_exception(error.value))
    assert "secret" not in diagnostic + caplog.text


@pytest.mark.parametrize(
    "contents", [b'{"secret":', b"\xff", b'{"version":1,"version":1,"credentials":[]}']
)
def test_invalid_file_contents_are_sanitized(tmp_path, contents):
    path = tmp_path / "private.json"
    path.write_bytes(contents)
    with pytest.raises(
        AuthConfigurationError, match="^Invalid authentication configuration$"
    ):
        Authenticator.from_config(path=path)


def test_unconfigured_and_empty_app_deny_private_access(tmp_path, monkeypatch):
    monkeypatch.delenv("EXCHANGE_AUTH_CONFIG", raising=False)
    apps = [create_app()]
    path = write_config(tmp_path / "empty.json", [])
    monkeypatch.setenv("EXCHANGE_AUTH_CONFIG", str(path))
    apps.append(create_app())
    for app in apps:
        with TestClient(app) as client:
            assert client.get("/health").status_code == 200
            assert (
                client.get("/identity", headers=bearer("anything")).status_code == 401
            )
