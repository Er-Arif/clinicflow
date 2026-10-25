FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /bin/uv
COPY pyproject.toml uv.lock /app/
RUN uv sync --frozen --no-dev --no-install-project
ENV PATH="/app/.venv/bin:$PATH"

COPY app /app/app
COPY alembic /app/alembic
COPY alembic.ini /app/alembic.ini
COPY scripts /app/scripts

RUN useradd --system --uid 10001 clinicflow
USER clinicflow
CMD ["python", "-m", "scripts.serve"]
