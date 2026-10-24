import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.errors import AppError
from app.core.mobile_compat import require_supported_mobile
from app.main import app


def test_initial_v1_baseline_allows_legacy_client_without_header(monkeypatch) -> None:
    monkeypatch.setattr(settings, "minimum_mobile_version_code", 1)

    require_supported_mobile(None)


def test_missing_or_old_build_is_rejected_after_minimum_advances(monkeypatch) -> None:
    monkeypatch.setattr(settings, "minimum_mobile_version", "1.1.0")
    monkeypatch.setattr(settings, "minimum_mobile_version_code", 3)
    monkeypatch.setattr(settings, "latest_mobile_version", "1.2.0")
    monkeypatch.setattr(settings, "latest_mobile_version_code", 4)

    with pytest.raises(AppError) as missing:
        require_supported_mobile(None)
    assert missing.value.status_code == 426
    assert missing.value.code == "MOBILE_UPDATE_REQUIRED"
    assert missing.value.details["installed_version_code"] is None

    with pytest.raises(AppError) as old:
        require_supported_mobile("2")
    assert old.value.status_code == 426
    assert old.value.details == {
        "installed_version_code": 2,
        "minimum_version": "1.1.0",
        "minimum_version_code": 3,
        "latest_version": "1.2.0",
        "latest_version_code": 4,
    }

    require_supported_mobile("3")
    require_supported_mobile("4")


def test_malformed_build_code_fails_closed(monkeypatch) -> None:
    monkeypatch.setattr(settings, "minimum_mobile_version_code", 1)

    for value in ("", "latest", "0", "-1", "1.5"):
        with pytest.raises(AppError) as error:
            require_supported_mobile(value)
        assert error.value.status_code == 426
        assert error.value.code == "MOBILE_UPDATE_REQUIRED"


def test_business_api_enforces_build_but_update_and_auth_paths_stay_reachable(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "minimum_mobile_version", "1.1.0")
    monkeypatch.setattr(settings, "minimum_mobile_version_code", 3)
    monkeypatch.setattr(settings, "latest_mobile_version", "1.2.0")
    monkeypatch.setattr(settings, "latest_mobile_version_code", 4)

    with TestClient(app) as client:
        blocked = client.get("/api/v1/clinic/time")
        supported = client.get(
            "/api/v1/clinic/time",
            headers={"X-ClinicFlow-Mobile-Version-Code": "3"},
        )
        system_info = client.get("/api/v1/system/info")
        auth_validation = client.post("/api/v1/auth/login", json={})

    assert blocked.status_code == 426
    assert blocked.json()["error"]["code"] == "MOBILE_UPDATE_REQUIRED"
    assert blocked.json()["error"]["details"]["minimum_version_code"] == 3
    assert supported.status_code != 426
    assert system_info.status_code == 200
    assert auth_validation.status_code == 422
