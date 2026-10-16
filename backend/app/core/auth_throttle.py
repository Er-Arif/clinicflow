"""Bounded, atomic, process-local auth budgets. Deploy exactly one V1 worker.

Reservations happen before credential checks, outside their database transaction.
Successful login clears the identity budget, never the shared IP budget.
"""

import hashlib
import logging
import math
from collections import deque
from ipaddress import ip_address
from threading import Lock
from time import monotonic

from fastapi import Request

from app.core.config import settings
from app.core.context import request_id_var
from app.core.errors import AppError

logger = logging.getLogger("clinicflow.auth")


class AuthThrottle:
    def __init__(self, *, timer=monotonic, max_keys: int = 10000):
        self.timer = timer
        self.max_keys = max_keys
        self._lock = Lock()
        self._attempts: dict[str, deque[float]] = {}

    @staticmethod
    def identity_key(identifier: str) -> str:
        return "identity:" + hashlib.sha256(identifier.strip().casefold().encode()).hexdigest()

    def check(self, ip: str | None, identifier: str | None = None) -> None:
        budgets = [("ip:" + ip, 20, 100)] if ip is not None else []
        if identifier is not None:
            budgets.append((self.identity_key(identifier), 5, 20))
        with self._lock:
            now = self.timer()
            # Bound memory without evicting active attacker budgets.
            if len(self._attempts) + len(budgets) > self.max_keys:
                self._attempts = {
                    key: values for key, values in self._attempts.items()
                    if values and values[-1] > now - 900
                }
            if len(self._attempts) + sum(key not in self._attempts for key, _, _ in budgets) > self.max_keys:
                self._deny(60)
            retry = 0
            for key, burst, sustained in budgets:
                values = self._attempts.setdefault(key, deque())
                while values and values[0] <= now - 900:
                    values.popleft()
                if len(values) >= sustained:
                    retry = max(retry, values[0] + 900 - now)
                recent = [stamp for stamp in values if stamp > now - 60]
                if len(recent) >= burst:
                    retry = max(retry, recent[0] + 60 - now)
            if retry > 0:
                self._deny(math.ceil(retry))
            for key, _, _ in budgets:
                self._attempts[key].append(now)

    def success(self, identifier: str) -> None:
        with self._lock:
            self._attempts.pop(self.identity_key(identifier), None)

    @staticmethod
    def _deny(retry: int) -> None:
        logger.warning("auth_throttled", extra={"request_id": request_id_var.get()})
        raise AppError(
            "AUTH_RATE_LIMITED", "Too many sign-in attempts. Try again later.", 429,
            {"retry_after_seconds": retry},
        )


auth_throttle = AuthThrottle()


def auth_client_ip(request: Request) -> str:
    if settings.client_ip_source == "railway":
        forwarded = request.headers.get("X-Real-IP")
        if not forwarded:
            return "unknown"

        try:
            return ip_address(forwarded.strip()).compressed
        except ValueError:
            logger.warning(
                "invalid_client_ip_header",
                extra={"request_id": request_id_var.get()},
            )
            return "unknown"

    return request.client.host if request.client else "unknown"


def throttle_auth_ip(request: Request) -> None:
    auth_throttle.check(auth_client_ip(request))
