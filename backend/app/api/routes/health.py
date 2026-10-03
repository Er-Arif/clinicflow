from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.db.session import get_db

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live(clock: Clock = Depends(get_clock)) -> dict[str, str]:
    return {
        "status": "ok",
        "utc_time": clock.now_utc().isoformat(),
    }


@router.get("/health/ready")
def ready(
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {
        "status": "ready",
        "clinic_date": clock.clinic_date().isoformat(),
    }
