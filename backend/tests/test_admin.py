from uuid import UUID

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.main import app
from app.modules.identity.admin_schemas import UserCreateRequest
from app.modules.identity.admin_service import validate_new_password
from app.modules.identity.dependencies import ensure_password_ready
from app.modules.identity.service import AuthContext


def _context(*, must_change_password: bool) -> AuthContext:
    return AuthContext(
        user_id=UUID("00000000-0000-0000-0000-000000000001"),
        clinic_id=UUID("00000000-0000-0000-0000-000000000002"),
        session_id=UUID("00000000-0000-0000-0000-000000000003"),
        display_name="Owner",
        roles=frozenset({"OWNER_ADMIN"}),
        permissions=frozenset({"users.manage", "clinic.settings.manage", "audit.view"}),
        must_change_password=must_change_password,
    )


def test_temporary_password_blocks_business_permissions() -> None:
    with pytest.raises(AppError) as exc:
        ensure_password_ready(_context(must_change_password=True))
    assert exc.value.code == "PASSWORD_CHANGE_REQUIRED"


def test_completed_password_change_allows_business_permissions() -> None:
    context = _context(must_change_password=False)
    assert ensure_password_ready(context) is context


def test_user_create_accepts_only_seeded_role_presets() -> None:
    with pytest.raises(ValidationError):
        UserCreateRequest(
            display_name="Staff",
            login_identifier="staff",
            temporary_password="temporary-password",
            role_codes=["SUPER_ADMIN"],
        )


def test_user_create_deduplicates_role_codes() -> None:
    request = UserCreateRequest(
        display_name="Staff",
        login_identifier="staff",
        temporary_password="temporary-password",
        role_codes=["assistant", "ASSISTANT"],
    )
    assert request.role_codes == ["ASSISTANT"]


def test_password_policy_requires_ten_characters() -> None:
    with pytest.raises(AppError) as exc:
        validate_new_password("short")
    assert exc.value.code == "PASSWORD_TOO_SHORT"
    validate_new_password("long-enough")


def test_m10_admin_routes_are_registered() -> None:
    paths = set(app.openapi()["paths"].keys())
    expected = {
        "/api/v1/auth/change-password",
        "/api/v1/clinic/settings",
        "/api/v1/doctors/{doctor_id}/settings",
        "/api/v1/roles",
        "/api/v1/users",
        "/api/v1/users/{user_id}",
        "/api/v1/users/{user_id}/reset-password",
        "/api/v1/audit-events/{audit_id}",
    }
    assert expected.issubset(paths)
