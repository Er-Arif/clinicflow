from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.requests import Request as StarletteRequest

from app.core import auth_throttle


def _probe_app() -> FastAPI:
    app = FastAPI()

    @app.get("/ip")
    def client_ip(request: Request) -> dict[str, str]:
        return {"ip": auth_throttle.auth_client_ip(request)}

    return app


def _request(*, peer: str, forwarded_for: str) -> StarletteRequest:
    return StarletteRequest(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [(b"x-forwarded-for", forwarded_for.encode("ascii"))],
            "client": (peer, 12345),
            "server": ("testserver", 80),
        }
    )


def test_render_client_ip_uses_leftmost_forwarded_address(monkeypatch) -> None:
    monkeypatch.setattr(auth_throttle.settings, "client_ip_source", "render")

    with TestClient(_probe_app()) as client:
        response = client.get(
            "/ip",
            headers={"X-Forwarded-For": "203.0.113.42, 10.0.0.8"},
        )

    assert response.status_code == 200
    assert response.json() == {"ip": "203.0.113.42"}


def test_render_client_ip_normalizes_ipv6(monkeypatch) -> None:
    monkeypatch.setattr(auth_throttle.settings, "client_ip_source", "render")

    with TestClient(_probe_app()) as client:
        response = client.get(
            "/ip",
            headers={"X-Forwarded-For": "2001:0db8:0000:0000:0000:0000:0000:0001"},
        )

    assert response.json() == {"ip": "2001:db8::1"}


def test_render_client_ip_fails_closed_for_missing_or_invalid_header(monkeypatch) -> None:
    monkeypatch.setattr(auth_throttle.settings, "client_ip_source", "render")

    with TestClient(_probe_app()) as client:
        missing = client.get("/ip")
        invalid = client.get(
            "/ip",
            headers={"X-Forwarded-For": "not-an-ip, 203.0.113.42"},
        )

    assert missing.json() == {"ip": "unknown"}
    assert invalid.json() == {"ip": "unknown"}


def test_trusted_proxy_accepts_forwarded_ip_only_from_configured_peer(monkeypatch) -> None:
    monkeypatch.setattr(auth_throttle.settings, "client_ip_source", "trusted_proxy")
    monkeypatch.setattr(auth_throttle.settings, "trusted_proxy_ips", ["172.30.0.10/32"])

    trusted = auth_throttle.auth_client_ip(
        _request(peer="172.30.0.10", forwarded_for="192.0.2.45")
    )
    untrusted = auth_throttle.auth_client_ip(
        _request(peer="172.30.0.11", forwarded_for="192.0.2.45")
    )

    assert trusted == "192.0.2.45"
    assert untrusted == "unknown"


def test_railway_client_ip_mode_remains_compatible(monkeypatch) -> None:
    monkeypatch.setattr(auth_throttle.settings, "client_ip_source", "railway")

    with TestClient(_probe_app()) as client:
        response = client.get("/ip", headers={"X-Real-IP": "198.51.100.9"})

    assert response.json() == {"ip": "198.51.100.9"}
