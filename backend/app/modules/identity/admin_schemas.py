from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ALLOWED_ROLE_CODES = {"ASSISTANT", "DOCTOR", "OWNER_ADMIN"}


class RolePresetResponse(BaseModel):
    role_code: str
    display_name: str


class UserAdminResponse(BaseModel):
    user_id: UUID
    display_name: str
    login_identifier: str
    active: bool
    must_change_password: bool
    roles: list[str]
    linked_doctor_id: UUID | None
    last_login_at: datetime | None
    version: int


class UserListResponse(BaseModel):
    items: list[UserAdminResponse]


class UserCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=160)
    login_identifier: str = Field(min_length=1, max_length=160)
    temporary_password: str = Field(min_length=10, max_length=128)
    role_codes: list[str] = Field(min_length=1, max_length=3)

    @field_validator("role_codes")
    @classmethod
    def validate_roles(cls, value: list[str]) -> list[str]:
        normalized = sorted({item.strip().upper() for item in value if item.strip()})
        unknown = set(normalized) - ALLOWED_ROLE_CODES
        if unknown:
            raise ValueError(f"Unsupported role(s): {', '.join(sorted(unknown))}")
        if not normalized:
            raise ValueError("Select at least one role.")
        return normalized


class UserUpdateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    login_identifier: str | None = Field(default=None, min_length=1, max_length=160)
    active: bool | None = None
    role_codes: list[str] | None = Field(default=None, min_length=1, max_length=3)

    @field_validator("role_codes")
    @classmethod
    def validate_roles(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = sorted({item.strip().upper() for item in value if item.strip()})
        unknown = set(normalized) - ALLOWED_ROLE_CODES
        if unknown:
            raise ValueError(f"Unsupported role(s): {', '.join(sorted(unknown))}")
        if not normalized:
            raise ValueError("Select at least one role.")
        return normalized


class PasswordResetRequest(BaseModel):
    temporary_password: str = Field(min_length=10, max_length=128)
    reason: str = Field(min_length=2, max_length=300)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=10, max_length=128)
