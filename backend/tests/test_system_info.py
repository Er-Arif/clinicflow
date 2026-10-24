from app.api.routes.system import SystemInfoResponse, system_info
from app.core.config import Settings, settings


def test_latest_mobile_version_is_configurable() -> None:
    config = Settings(
        latest_mobile_version="1.2.3",
        latest_mobile_version_code=7,
    )

    assert config.latest_mobile_version == "1.2.3"
    assert config.latest_mobile_version_code == 7


def test_system_info_reports_typed_mobile_update_contract() -> None:
    info = system_info()

    assert isinstance(info, SystemInfoResponse)
    assert info.latest_mobile_version == settings.latest_mobile_version
    assert info.latest_mobile_version_code == settings.latest_mobile_version_code
    assert info.minimum_mobile_version == settings.minimum_mobile_version
    assert info.minimum_mobile_version_code == settings.minimum_mobile_version_code
    assert info.mobile_update_mandatory == settings.mobile_update_mandatory
