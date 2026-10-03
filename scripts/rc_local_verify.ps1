$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BackendLock = Join-Path $RootDir "backend\uv.lock"
$MobileLock = Join-Path $RootDir "mobile\package-lock.json"
$Compose = Join-Path $RootDir "infra\docker-compose.yml"
$TestDb = "clinicflow_rc_test"
$DatabaseUrl = "postgresql+psycopg://clinicflow:clinicflow@localhost:5432/$TestDb"

if (-not (Test-Path $BackendLock)) {
    throw "backend/uv.lock is missing. Run 'cd backend; uv lock' online, review it, and commit it before RC."
}
if (-not (Test-Path $MobileLock)) {
    throw "mobile/package-lock.json is missing. Run 'cd mobile; npm install', review it, and commit it before RC."
}

foreach ($Command in @("docker", "uv", "npm")) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$Command is required for RC verification."
    }
}

function Remove-RcDatabase {
    try {
        & docker compose -f $Compose exec -T postgres dropdb -U clinicflow --if-exists $TestDb 2>$null | Out-Null
    }
    catch {
        # Cleanup is best-effort so the original verification error is preserved.
    }
}

try {
    & docker compose -f $Compose up -d postgres
    if ($LASTEXITCODE -ne 0) { throw "Failed to start PostgreSQL." }

    Remove-RcDatabase
    & docker compose -f $Compose exec -T postgres createdb -U clinicflow $TestDb
    if ($LASTEXITCODE -ne 0) { throw "Failed to create disposable RC database." }

    Push-Location (Join-Path $RootDir "backend")
    try {
        $env:CLINICFLOW_DATABASE_URL = $DatabaseUrl
        $env:CLINICFLOW_RUN_INTEGRATION = "1"

        & uv sync --frozen --dev
        if ($LASTEXITCODE -ne 0) { throw "uv sync failed." }
        & uv run alembic upgrade head
        if ($LASTEXITCODE -ne 0) { throw "Alembic migration failed." }
        & uv run ruff check .
        if ($LASTEXITCODE -ne 0) { throw "Ruff failed." }
        & uv run pytest
        if ($LASTEXITCODE -ne 0) { throw "Backend tests failed." }
    }
    finally {
        Pop-Location
    }

    Push-Location (Join-Path $RootDir "mobile")
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
        & npm run lint
        if ($LASTEXITCODE -ne 0) { throw "Mobile lint failed." }
        & npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw "Mobile TypeScript check failed." }
    }
    finally {
        Pop-Location
    }

    Write-Host "ClinicFlow local RC verification passed. Physical Android-device UAT is still required."
}
finally {
    Remove-RcDatabase
}
