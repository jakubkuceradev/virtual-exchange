"""Exercise the actual application's public HTTP behavior."""

import pytest
from fastapi.testclient import TestClient

from virtual_exchange.api import create_app


def test_health_reports_liveness():
    with TestClient(create_app()) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    "path", ["/does-not-exist", "/orders", "/docs", "/openapi.json"]
)
def test_unimplemented_routes_are_not_exposed(path):
    with TestClient(create_app()) as client:
        response = client.get(path)

    assert response.status_code == 404
