from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class NumberCounter(Base):
    __tablename__ = "number_counters"
    __table_args__ = (
        PrimaryKeyConstraint("clinic_id", "counter_key", name="pk_number_counters"),
    )

    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False
    )
    counter_key: Mapped[str] = mapped_column(String(64), nullable=False)
    last_value: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Patient(Base):
    __tablename__ = "patients"
    __table_args__ = (
        UniqueConstraint("clinic_id", "patient_code", name="uq_patients_clinic_patient_code"),
        CheckConstraint(
            "gender IN ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY')",
            name="gender_allowed",
        ),
        CheckConstraint(
            "preferred_language IN ('EN', 'HI')",
            name="preferred_language_allowed",
        ),
        CheckConstraint(
            "approximate_age_years IS NULL OR (approximate_age_years >= 0 AND approximate_age_years <= 130)",
            name="approximate_age_range",
        ),
        CheckConstraint(
            "(date_of_birth IS NOT NULL AND approximate_age_years IS NULL AND age_as_of_date IS NULL) "
            "OR (date_of_birth IS NULL AND approximate_age_years IS NOT NULL AND age_as_of_date IS NOT NULL)",
            name="dob_or_approximate_age",
        ),
        CheckConstraint(
            "whatsapp_same_as_mobile = FALSE OR "
            "(mobile_e164 IS NOT NULL AND whatsapp_e164 = mobile_e164)",
            name="whatsapp_contact_consistency",
        ),
        Index(
            "ix_patients_full_name_trgm",
            "full_name",
            postgresql_using="gin",
            postgresql_ops={"full_name": "gin_trgm_ops"},
        ),
    )

    patient_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    patient_code: Mapped[str] = mapped_column(String(32), nullable=False)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    mobile_e164: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    whatsapp_e164: Mapped[str | None] = mapped_column(String(16), nullable=True)
    whatsapp_same_as_mobile: Mapped[bool] = mapped_column(Boolean, nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    approximate_age_years: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    age_as_of_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str] = mapped_column(String(24), nullable=False)
    preferred_language: Mapped[str] = mapped_column(String(2), nullable=False)
    reminders_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
