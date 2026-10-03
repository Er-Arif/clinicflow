from __future__ import annotations

import re

from app.core.errors import AppError

_NON_DIGIT = re.compile(r"\D+")


def normalize_indian_mobile(value: str) -> str:
    """Normalize an Indian mobile number to +91XXXXXXXXXX.

    V1 intentionally validates ordinary Indian mobile numbers rather than trying
    to be an international telephony library.
    """
    raw = value.strip()
    digits = _NON_DIGIT.sub("", raw)

    if digits.startswith("0091"):
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]

    if len(digits) != 10 or digits[0] not in "6789":
        raise AppError(
            code="INVALID_MOBILE_NUMBER",
            message="Enter a valid 10-digit Indian mobile number.",
            status_code=422,
        )
    return f"+91{digits}"


def try_normalize_indian_mobile(value: str) -> str | None:
    try:
        return normalize_indian_mobile(value)
    except AppError:
        return None


def display_indian_mobile(e164: str) -> str:
    digits = e164.removeprefix("+91")
    if len(digits) == 10:
        return f"{digits[:5]} {digits[5:]}"
    return e164
