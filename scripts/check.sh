#!/usr/bin/env sh
set -eu
(cd backend && python -m compileall -q app tests alembic)
echo "Python syntax OK"
