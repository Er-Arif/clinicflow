from __future__ import annotations

import argparse
from getpass import getpass

from sqlalchemy import select

from app.core.security import PasswordService
from app.db.session import get_session_factory
from app.modules.clinic.models import Clinic, Doctor
from app.modules.identity.models import Role, User, UserRole
from app.modules.messaging.defaults import DEFAULT_MESSAGE_TEMPLATES
from app.modules.messaging.models import MessageTemplate


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap the first ClinicFlow Owner/Doctor user")
    parser.add_argument("--clinic-name", required=True)
    parser.add_argument("--owner-name", required=True)
    parser.add_argument("--login", required=True)
    args = parser.parse_args()
    password = getpass("Owner password: ")
    if len(password) < 10:
        raise SystemExit("Password must contain at least 10 characters.")

    with get_session_factory()() as db, db.begin():
            existing = db.scalar(select(User).where(User.login_identifier == args.login))
            if existing:
                raise SystemExit("A user with this login identifier already exists.")
    
            clinic = Clinic(clinic_name=args.clinic_name)
            db.add(clinic)
            db.flush()
    
            user = User(
                clinic_id=clinic.clinic_id,
                display_name=args.owner_name,
                login_identifier=args.login,
                password_hash=PasswordService.hash(password),
                active=True,
            )
            db.add(user)
            db.flush()
    
            roles = db.scalars(select(Role).where(Role.role_code.in_(["DOCTOR", "OWNER_ADMIN"]))).all()
            if len(roles) != 2:
                raise SystemExit("Seeded roles not found. Run Alembic migrations first.")
            for role in roles:
                db.add(UserRole(user_id=user.user_id, role_id=role.role_id, assigned_by=user.user_id))
    
            db.add(
                Doctor(
                    clinic_id=clinic.clinic_id,
                    user_id=user.user_id,
                    display_name=args.owner_name,
                    active=True,
                )
            )
            for template_type, language, body in DEFAULT_MESSAGE_TEMPLATES:
                db.add(
                    MessageTemplate(
                        clinic_id=clinic.clinic_id,
                        template_type=template_type,
                        language=language,
                        template_body=body,
                        active=True,
                        version=1,
                        updated_by=user.user_id,
                    )
                )
    print("Clinic and Owner/Doctor account created.")


if __name__ == "__main__":
    main()
