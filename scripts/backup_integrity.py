"""Portable SHA-256 sidecars: verify the requested dump, never a path from a sidecar."""

import argparse
import hashlib
from pathlib import Path


def digest(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def write_checksum(path: Path) -> None:
    if not path.stat().st_size:
        raise ValueError("Backup is empty")
    sidecar = path.with_name(path.name + ".sha256")
    # Exclusive creation prevents silently replacing evidence for an existing backup.
    with sidecar.open("x", encoding="ascii", newline="\n") as stream:
        stream.write(f"{digest(path)}  {path.name}\n")
    sidecar.chmod(0o600)


def verify_checksum(path: Path) -> None:
    expected = path.with_name(path.name + ".sha256").read_text(encoding="ascii")
    if expected != f"{digest(path)}  {path.name}\n":
        raise ValueError("Backup checksum mismatch or invalid sidecar")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["write", "verify"])
    parser.add_argument("dump", type=Path)
    args = parser.parse_args()
    try:
        (write_checksum if args.action == "write" else verify_checksum)(args.dump)
    except (OSError, ValueError) as exc:
        raise SystemExit(f"Backup integrity failed: {type(exc).__name__}") from None


if __name__ == "__main__":
    main()
