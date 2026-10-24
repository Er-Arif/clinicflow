from app.api.routes.system import system_info
from app.core.config import Settings, settings


def test_latest_mobile_version_is_configurable() -> None:
    config = Settings(latest_mobile_version="1.2.3")

    assert config.latest_mobile_version == "1.2.3"


def test_system_info_reports_latest_mobile_version() -> None:
    info = system_info()

    assert info["latest_mobile_version"] == settings.latest_mobile_version
