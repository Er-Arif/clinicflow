from __future__ import annotations

import ast
from pathlib import Path

MODULES_DIR = Path(__file__).resolve().parents[1] / "app" / "modules"


def _python_files(module_name: str) -> list[Path]:
    return sorted((MODULES_DIR / module_name).glob("*.py"))


def _attribute_path(node: ast.expr) -> tuple[str, ...]:
    parts: list[str] = []
    current: ast.expr = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        parts.append(current.id)
    return tuple(reversed(parts))


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def test_patients_do_not_import_appointment_business_services() -> None:
    violations: list[str] = []
    forbidden_prefix = "app.modules.appointments.service"

    for path in _python_files("patients"):
        for node in ast.walk(_parse(path)):
            if isinstance(node, ast.ImportFrom) and node.module:
                if node.module.startswith(forbidden_prefix):
                    violations.append(f"{path.name}:{node.lineno} imports {node.module}")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith(forbidden_prefix):
                        violations.append(f"{path.name}:{node.lineno} imports {alias.name}")

    assert not violations, "Patient module crossed the appointment service boundary:\n" + "\n".join(
        violations
    )


def test_reporting_service_remains_read_only() -> None:
    violations: list[str] = []
    forbidden_db_methods = {"add", "add_all", "delete", "flush", "commit", "rollback"}
    forbidden_sql_mutations = {"insert", "update", "delete"}

    for path in _python_files("reporting"):
        for node in ast.walk(_parse(path)):
            if isinstance(node, ast.ImportFrom) and node.module == "sqlalchemy":
                for alias in node.names:
                    if alias.name in forbidden_sql_mutations:
                        violations.append(
                            f"{path.name}:{node.lineno} imports sqlalchemy.{alias.name}"
                        )
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                owner = _attribute_path(node.func.value)
                if node.func.attr in forbidden_db_methods and owner in {("db",), ("self", "db")}:
                    violations.append(
                        f"{path.name}:{node.lineno} calls {'.'.join(owner)}.{node.func.attr}()"
                    )

    assert not violations, "Reporting must stay read-only:\n" + "\n".join(violations)


def test_http_routers_do_not_write_directly_through_db_session() -> None:
    violations: list[str] = []
    forbidden_db_methods = {"add", "add_all", "delete", "flush", "commit", "rollback"}

    for path in sorted(MODULES_DIR.glob("*/router.py")):
        for node in ast.walk(_parse(path)):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            owner = _attribute_path(node.func.value)
            if node.func.attr in forbidden_db_methods and owner in {("db",), ("session",)}:
                violations.append(
                    f"{path.relative_to(MODULES_DIR)}:{node.lineno} calls "
                    f"{'.'.join(owner)}.{node.func.attr}()"
                )

    assert not violations, "HTTP routers must delegate writes to application services:\n" + "\n".join(
        violations
    )
