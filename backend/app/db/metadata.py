# Import models here so Alembic can discover the complete metadata.
from app.db.base import Base  # noqa: F401
from app.modules.appointments.models import Appointment, AppointmentFeeAdjustment  # noqa: F401,E402
from app.modules.audit.models import AuditEvent  # noqa: F401
from app.modules.clinic.models import Clinic, Doctor  # noqa: F401
from app.modules.followups.models import FollowUpRecommendation  # noqa: F401,E402
from app.modules.idempotency.models import IdempotencyRecord  # noqa: F401
from app.modules.identity.models import (  # noqa: F401
    AuthSession,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from app.modules.messaging.models import MessageTemplate, Reminder  # noqa: F401,E402
from app.modules.patients.models import NumberCounter, Patient  # noqa: F401
from app.modules.payments.models import Payment, Receipt, UpiConfiguration  # noqa: F401,E402
from app.modules.scheduling.models import (  # noqa: F401
    FeeConfiguration,
    ScheduleDefinition,
    SessionDefinition,
    SessionOccurrence,
)
from app.modules.visits.models import Visit  # noqa: F401,E402
