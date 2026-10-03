from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import tomllib

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return "unknown"


def _revision_values(path: Path) -> tuple[str | None, set[str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    revision: str | None = None
    parents: set[str] = set()

    for node in tree.body:
        name: str | None = None
        value: ast.expr | None = None
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            name, value = node.target.id, node.value
        elif (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
        ):
            name, value = node.targets[0].id, node.value

        if name == "revision" and isinstance(value, ast.Constant) and isinstance(value.value, str):
            revision = value.value
        elif name == "down_revision":
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parents.add(value.value)
            elif isinstance(value, (ast.Tuple, ast.List)):
                for item in value.elts:
                    if isinstance(item, ast.Constant) and isinstance(item.value, str):
                        parents.add(item.value)

    return revision, parents


def alembic_head() -> str:
    revisions: set[str] = set()
    parents: set[str] = set()
    for path in (ROOT / "backend" / "alembic" / "versions").glob("*.py"):
        revision, revision_parents = _revision_values(path)
        if revision:
            revisions.add(revision)
        parents.update(revision_parents)

    heads = sorted(revisions - parents)
    if len(heads) != 1:
        raise SystemExit(f"Expected exactly one Alembic head, found: {heads}")
    return heads[0]


def main() -> None:
    parser = argparse.ArgumentParser(description="Create ClinicFlow RC release manifest")
    parser.add_argument("--apk", required=True)
    parser.add_argument("--output", default="release-manifest.json")
    parser.add_argument("--commit", default=None)
    args = parser.parse_args()

    apk = Path(args.apk).resolve()
    if not apk.is_file():
        raise SystemExit(f"APK not found: {apk}")

    app_json = json.loads((ROOT / "mobile" / "app.json").read_text(encoding="utf-8"))["expo"]
    with (ROOT / "backend" / "pyproject.toml").open("rb") as handle:
        backend_version = tomllib.load(handle)["project"]["version"]

    manifest = {
        "product": "ClinicFlow",
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "git_commit": args.commit or git_commit(),
        "mobile": {
            "version": app_json["version"],
            "android_version_code": app_json["android"]["versionCode"],
            "apk_filename": apk.name,
            "apk_size_bytes": apk.stat().st_size,
            "apk_sha256": sha256(apk),
        },
        "backend": {
            "version": backend_version,
            "alembic_revision": alembic_head(),
        },
    }
    output = Path(args.output).resolve()
    output.write_text(json.dumps(manifest, indent=2) + "\n")
    print(output)


if __name__ == "__main__":
    main()
