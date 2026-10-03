from sqlalchemy import delete

from app.core.clock import get_clock
from app.db.session import get_session_factory
from app.modules.idempotency.models import IdempotencyRecord


def main() -> None:
    clock = get_clock()
    with get_session_factory()() as db, db.begin():
        result = db.execute(
            delete(IdempotencyRecord).where(IdempotencyRecord.expires_at < clock.now_utc())
        )
        removed = result.rowcount or 0
    print(f"expired_idempotency_records_removed={removed}")


if __name__ == "__main__":
    main()
