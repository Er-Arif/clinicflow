from app.core.clock import SystemClock


def test_clinic_clock_uses_configured_timezone() -> None:
    clock = SystemClock("Asia/Kolkata")
    assert clock.clinic_now().tzinfo is not None
    assert clock.clinic_date() == clock.clinic_now().date()
