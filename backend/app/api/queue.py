from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.db.session import get_db
from app.models import QueueEntry, QueueStatus, Role, User
from app.realtime.hub import event_hub
from app.schemas.queue import QueueCreate, QueuePublic, SeatQueueEntry
from app.services.queue import (
    QueueWorkflowError,
    add_to_queue,
    call_queue_entry,
    seat_queue_entry,
)

router = APIRouter(prefix="/queue", tags=["queue"])
host_roles = (Role.HOST, Role.MANAGER, Role.ADMIN)


@router.post("", response_model=QueuePublic, status_code=status.HTTP_201_CREATED)
async def join_queue(payload: QueueCreate, db: Session = Depends(get_db)) -> QueueEntry:
    try:
        entry = add_to_queue(db, **payload.model_dump())
        db.commit()
        db.refresh(entry)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await event_hub.broadcast(
        entry.restaurant_id,
        {"type": "queue.created", "queue_entry_id": entry.id},
    )
    return entry


@router.get("", response_model=list[QueuePublic])
def list_queue(
    restaurant_id: int,
    _: User = Depends(require_roles(*host_roles)),
    db: Session = Depends(get_db),
) -> list[QueueEntry]:
    return list(
        db.scalars(
            select(QueueEntry)
            .where(
                QueueEntry.restaurant_id == restaurant_id,
                QueueEntry.status.in_((QueueStatus.WAITING, QueueStatus.CALLED)),
            )
            .order_by(QueueEntry.arrived_at)
        ).all()
    )


@router.post("/{entry_id}/call", response_model=QueuePublic)
async def call(
    entry_id: int,
    _: User = Depends(require_roles(*host_roles)),
    db: Session = Depends(get_db),
) -> QueueEntry:
    try:
        entry = call_queue_entry(db, entry_id=entry_id)
        db.commit()
        db.refresh(entry)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except QueueWorkflowError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await event_hub.broadcast(entry.restaurant_id, {"type": "queue.called", "queue_entry_id": entry.id})
    return entry


@router.post("/{entry_id}/seat", response_model=QueuePublic)
async def seat(
    entry_id: int,
    payload: SeatQueueEntry,
    user: User = Depends(require_roles(*host_roles)),
    db: Session = Depends(get_db),
) -> QueueEntry:
    try:
        entry, table = seat_queue_entry(db, entry_id=entry_id, assigned_by=user, **payload.model_dump())
        db.commit()
        db.refresh(entry)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except QueueWorkflowError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await event_hub.broadcast(
        entry.restaurant_id,
        {"type": "queue.seated", "queue_entry_id": entry.id, "table_id": table.id},
    )
    return entry
