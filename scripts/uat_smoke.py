from __future__ import annotations

import argparse
from getpass import getpass
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


def call(
    base_url: str,
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: dict[str, Any] | None = None,
) -> Any:
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Accept": "application/json",
        "X-Request-ID": str(uuid4()),
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(base_url.rstrip("/") + path, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else None
    except HTTPError as exc:
        payload = exc.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} failed: HTTP {exc.code}: {payload}") from exc
    except URLError as exc:
        raise SystemExit(f"{method} {path} could not connect: {exc.reason}") from exc


def check(label: str, value: Any) -> Any:
    print(f"PASS  {label}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only ClinicFlow deployed UAT smoke test")
    parser.add_argument("--base-url", required=True, help="Example: https://clinic.example.com")
    parser.add_argument("--login", required=True, help="Owner/Admin login identifier")
    args = parser.parse_args()
    password = os.getenv("CLINICFLOW_UAT_PASSWORD") or getpass("ClinicFlow password: ")

    live = call(args.base_url, "GET", "/health/live")
    assert live["status"] == "ok"
    check("liveness", live)

    ready = call(args.base_url, "GET", "/health/ready")
    assert ready["status"] == "ready"
    check("readiness + database", ready)

    info = call(args.base_url, "GET", "/api/v1/system/info")
    assert info["service"] == "clinicflow-api"
    system_summary = (
        f"system info backend={info['api_version']} "
        f"commit={info['build_commit']} env={info['environment']}"
    )
    check(system_summary, info)

    tokens = call(
        args.base_url,
        "POST",
        "/api/v1/auth/login",
        body={"login_identifier": args.login, "password": password, "device_label": "RC smoke"},
    )
    access = tokens["access_token"]
    if tokens["user"].get("must_change_password"):
        raise SystemExit("Smoke-test account still requires a password change.")
    check("login", tokens["user"]["display_name"])

    me = call(args.base_url, "GET", "/api/v1/auth/me", token=access)
    check(f"authenticated context roles={','.join(me['roles'])}", me)

    clinic_time = call(args.base_url, "GET", "/api/v1/clinic/time", token=access)
    check(f"clinic clock {clinic_time['clinic_date']} {clinic_time['timezone']}", clinic_time)

    doctors = call(args.base_url, "GET", "/api/v1/doctors", token=access)
    assert isinstance(doctors, list) and doctors
    check(f"doctor lookup ({len(doctors)})", doctors)

    fee = call(args.base_url, "GET", "/api/v1/fee-configurations/current", token=access)
    check(f"fee configuration regular={fee['regular_fee']} followup={fee['followup_fee']}", fee)

    home = call(args.base_url, "GET", "/api/v1/home/assistant", token=access)
    check("assistant read model", home)

    call(args.base_url, "POST", "/api/v1/auth/logout", token=access)
    check("logout", True)
    print("\nClinicFlow read-only deployed smoke test passed.")


if __name__ == "__main__":
    main()
