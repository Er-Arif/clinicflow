from uuid import UUID

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    login_identifier: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=1, max_length=512)
    device_label: str | None = Field(default=None, max_length=120)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=512)


class UserContextResponse(BaseModel):
    user_id: UUID
    clinic_id: UUID
    display_name: str
    roles: list[str]
    permissions: list[str]
    must_change_password: bool


class TokenPairResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserContextResponse


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=512)
    new_password: str = Field(min_length=10, max_length=128)
