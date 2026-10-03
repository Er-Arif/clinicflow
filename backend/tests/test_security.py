from uuid import uuid4

from app.core.clock import SystemClock
from app.core.security import PasswordService, TokenService


def test_argon2_password_round_trip() -> None:
    password_hash = PasswordService.hash("strong-test-password")
    assert password_hash != "strong-test-password"
    assert PasswordService.verify(password_hash, "strong-test-password")
    assert not PasswordService.verify(password_hash, "wrong-password")


def test_access_token_round_trip(monkeypatch) -> None:
    monkeypatch.setattr("app.core.config.settings.access_token_secret", "test-secret-that-is-at-least-32-bytes-long")
    clock = SystemClock("Asia/Kolkata")
    service = TokenService(clock)
    user_id, clinic_id, session_id = uuid4(), uuid4(), uuid4()
    token = service.create_access_token(
        user_id=user_id, clinic_id=clinic_id, session_id=session_id
    )
    claims = service.decode_access_token(token)
    assert claims.user_id == user_id
    assert claims.clinic_id == clinic_id
    assert claims.session_id == session_id
