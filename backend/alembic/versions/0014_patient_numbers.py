"""migrate patient codes to practical numeric patient numbers

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    invalid_format = bind.execute(
        sa.text(
            """
            SELECT clinic_id, patient_code
            FROM patients
            WHERE NOT (
                patient_code ~ '^PT-[0-9]+$'
                OR patient_code ~ '^[0-9]+$'
            )
            LIMIT 1
            """
        )
    ).first()
    if invalid_format is not None:
        raise RuntimeError(
            "Cannot migrate patient numbers: found an unexpected patient_code "
            f"{invalid_format.patient_code!r} in clinic {invalid_format.clinic_id}."
        )

    nonpositive = bind.execute(
        sa.text(
            """
            SELECT clinic_id, patient_code
            FROM patients
            WHERE CASE
                WHEN patient_code ~ '^PT-[0-9]+$'
                    THEN substring(patient_code from '^PT-([0-9]+)$')::bigint
                ELSE patient_code::bigint
            END < 1
            LIMIT 1
            """
        )
    ).first()
    if nonpositive is not None:
        raise RuntimeError(
            "Cannot migrate patient numbers: patient numbers must be positive; "
            f"found {nonpositive.patient_code!r} in clinic {nonpositive.clinic_id}."
        )

    collision = bind.execute(
        sa.text(
            """
            WITH normalized AS (
                SELECT
                    clinic_id,
                    CASE
                        WHEN patient_code ~ '^PT-[0-9]+$'
                            THEN substring(patient_code from '^PT-([0-9]+)$')::bigint
                        ELSE patient_code::bigint
                    END AS patient_number
                FROM patients
            )
            SELECT clinic_id, patient_number, count(*) AS duplicate_count
            FROM normalized
            GROUP BY clinic_id, patient_number
            HAVING count(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if collision is not None:
        raise RuntimeError(
            "Cannot migrate patient numbers: multiple patient records normalize to "
            f"{collision.patient_number} in clinic {collision.clinic_id}."
        )

    bind.execute(
        sa.text(
            """
            UPDATE patients
            SET patient_code = lpad(
                (substring(patient_code from '^PT-([0-9]+)$')::bigint)::text,
                greatest(
                    4,
                    length((substring(patient_code from '^PT-([0-9]+)$')::bigint)::text)
                ),
                '0'
            )
            WHERE patient_code ~ '^PT-[0-9]+$'
            """
        )
    )

    bind.execute(
        sa.text(
            """
            INSERT INTO number_counters (clinic_id, counter_key, last_value, updated_at)
            SELECT clinic_id, 'PATIENT', max(patient_code::bigint), now()
            FROM patients
            GROUP BY clinic_id
            ON CONFLICT (clinic_id, counter_key)
            DO UPDATE SET
                last_value = greatest(number_counters.last_value, EXCLUDED.last_value),
                updated_at = now()
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE patients
            SET patient_code = 'PT-' || CASE
                WHEN length((patient_code::bigint)::text) < 6
                    THEN lpad((patient_code::bigint)::text, 6, '0')
                ELSE (patient_code::bigint)::text
            END
            WHERE patient_code ~ '^[0-9]+$'
            """
        )
    )
