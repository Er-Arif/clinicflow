from fastapi import APIRouter

from app.api.routes.health import router as health_router
from app.api.routes.system import router as system_router
from app.core.config import settings
from app.modules.appointments.router import router as appointments_router
from app.modules.clinic.router import context_router as clinic_context_router
from app.modules.clinic.router import router as clinic_router
from app.modules.followups.router import router as followups_router
from app.modules.identity.admin_router import router as admin_router
from app.modules.identity.router import router as auth_router
from app.modules.messaging.router import router as messaging_router
from app.modules.patients.router import router as patients_router
from app.modules.payments.router import router as payments_router
from app.modules.reporting.router import router as reporting_router
from app.modules.scheduling.router import router as scheduling_router
from app.modules.visits.router import router as visits_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(system_router, prefix=settings.api_prefix)
api_router.include_router(auth_router, prefix=settings.api_prefix)
api_router.include_router(admin_router, prefix=settings.api_prefix)
api_router.include_router(clinic_router, prefix=settings.api_prefix)
api_router.include_router(clinic_context_router, prefix=settings.api_prefix)
api_router.include_router(scheduling_router, prefix=settings.api_prefix)
api_router.include_router(appointments_router, prefix=settings.api_prefix)
api_router.include_router(visits_router, prefix=settings.api_prefix)
api_router.include_router(payments_router, prefix=settings.api_prefix)
api_router.include_router(followups_router, prefix=settings.api_prefix)
api_router.include_router(messaging_router, prefix=settings.api_prefix)
api_router.include_router(reporting_router, prefix=settings.api_prefix)
api_router.include_router(patients_router, prefix=settings.api_prefix)
