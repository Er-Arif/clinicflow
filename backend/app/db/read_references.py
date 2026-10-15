"""Request-local, clinic-scoped FK batches for list response serialization.

Missing references stay missing: serialization never falls back to per-row SQL.
Command/detail paths continue using their own live Session reads.
"""

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session


class ReadReferences:
    def __init__(self, db: Session, clinic_id):
        self.db = db
        self.clinic_id = clinic_id
        self.rows: dict[type, dict] = {}

    def load(self, model, ids) -> list:
        ids = {value for value in ids if value is not None}
        key = inspect(model).primary_key[0]
        rows = list(self.db.scalars(select(model).where(
            model.clinic_id == self.clinic_id, key.in_(ids),
        ))) if ids else []
        self.rows[model] = {getattr(row, key.key): row for row in rows}
        return rows

    def get(self, model, identity):
        return self.rows[model].get(identity)
