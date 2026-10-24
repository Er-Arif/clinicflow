import pytest

from app.api.routes import system as system_route
from app.core.config import Settings, validate_runtime_settings

VALID_APK_URL = (
    "https://github.com/Er-Arif/clinicflow/releases/download/"
    "v1.0.0/clinicflow-v1.0.0.apk"
)
VALID_SHA256 = "a" * 64


def _settings(**overrides) -> Settings:
    values = {
        "environment": "test",
        "minimum_mobile_version": "1.0.0-rc.1",
        "minimum_mobile_version_code": 1,
        "latest_mobile_version": "1.0.0",
        "latest_mobile_version_code": 2,
        "mobile_apk_url": "",
        "mobile_apk_sha256": "",
        "mobile_release_notes": "",
        "mobile_update_mandatory": False,
    }
    values.update(overrides)
    return Settings(**values)


def test_update_policy_accepts_github_release_apk_with_sha256() -> None:
    validate_runtime_settings(
        _settings(
            mobile_apk_url=VALID_APK_URL,
            mobile_apk_sha256=VALID_SHA256,
            mobile_release_notes="Production release",
        )
    )


def test_update_policy_rejects_invalid_versions() -> None:
    with pytest.raises(RuntimeError, match="LATEST_MOBILE_VERSION"):
        validate_runtime_settings(_settings(latest_mobile_version="latest"))


def test_update_policy_rejects_minimum_code_above_latest_code() -> None:
    with pytest.raises(RuntimeError, match="MINIMUM_MOBILE_VERSION_CODE"):
        validate_runtime_settings(
            _settings(minimum_mobile_version_code=3, latest_mobile_version_code=2)
        )


@pytest.mark.parametrize(
    ("apk_url", "sha256"),
    [
        (VALID_APK_URL, ""),
        ("", VALID_SHA256),
    ],
)
def test_update_policy_requires_apk_url_and_sha_together(apk_url: str, sha256: str) -> None:
    with pytest.raises(RuntimeError, match="configured together"):
        validate_runtime_settings(
            _settings(mobile_apk_url=apk_url, mobile_apk_sha256=sha256)
        )


@pytest.mark.parametrize(
    "apk_url",
    [
        "http://github.com/Er-Arif/clinicflow/releases/download/v1.0.0/app.apk",
        "https://example.com/Er-Arif/clinicflow/releases/download/v1.0.0/app.apk",
        "https://github.com/Er-Arif/clinicflow/releases/tag/v1.0.0",
        "https://github.com/Er-Arif/clinicflow/releases/download/v1.0.0/app.zip",
        "https://github.com/Er-Arif/clinicflow/releases/download/v1.0.0/app.apk?token=secret",
    ],
)
def test_update_policy_rejects_non_release_apk_urls(apk_url: str) -> None:
    with pytest.raises(RuntimeError, match="release APK URL"):
        validate_runtime_settings(
            _settings(mobile_apk_url=apk_url, mobile_apk_sha256=VALID_SHA256)
        )


def test_update_policy_rejects_invalid_sha256() -> None:
    with pytest.raises(RuntimeError, match="64 hexadecimal"):
        validate_runtime_settings(
            _settings(mobile_apk_url=VALID_APK_URL, mobile_apk_sha256="not-a-sha")
        )


def test_mandatory_update_requires_download_metadata() -> None:
    with pytest.raises(RuntimeError, match="MOBILE_UPDATE_MANDATORY"):
        validate_runtime_settings(_settings(mobile_update_mandatory=True))


def test_system_info_exposes_normalized_update_contract(monkeypatch) -> None:
    monkeypatch.setattr(system_route.settings, "minimum_mobile_version", "1.0.0-rc.1")
    monkeypatch.setattr(system_route.settings, "minimum_mobile_version_code", 1)
    monkeypatch.setattr(system_route.settings, "latest_mobile_version", "1.0.0")
    monkeypatch.setattr(system_route.settings, "latest_mobile_version_code", 2)
    monkeypatch.setattr(system_route.settings, "mobile_apk_url", f"  {VALID_APK_URL}  ")
    monkeypatch.setattr(system_route.settings, "mobile_apk_sha256", VALID_SHA256.upper())
    monkeypatch.setattr(system_route.settings, "mobile_release_notes", "  Stable release  ")
    monkeypatch.setattr(system_route.settings, "mobile_update_mandatory", True)

    info = system_route.system_info()

    assert info.minimum_mobile_version == "1.0.0-rc.1"
    assert info.minimum_mobile_version_code == 1
    assert info.latest_mobile_version == "1.0.0"
    assert info.latest_mobile_version_code == 2
    assert info.mobile_apk_url == VALID_APK_URL
    assert info.mobile_apk_sha256 == VALID_SHA256
    assert info.mobile_release_notes == "Stable release"
    assert info.mobile_update_mandatory is True
