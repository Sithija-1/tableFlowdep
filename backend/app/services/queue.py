from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    QueueEntry,
    QueueStatus,
    Restaurant,
    RestaurantTable,
    SeatingRecord,
    TableStatus,
    User,
)
from app.services.reservations import find_reserved_table_ids
from app.services.table_status import clear_expired_unavailability, restaurant_now


class QueueWorkflowError(Exception):
    """Raised for invalid host-desk transitions."""


def add_to_queue(
    db: Session,
    *,
    restaurant_id: int,
    customer_name: str,
    customer_phone: str | None,
    guest_count: int,
) -> QueueEntry:
    # Serialise allocation by taking the restaurant row lock before numbering the party.
    restaurant = db.scalar(
        select(Restaurant).where(Restaurant.id == restaurant_id).with_for_update()
    )
    if restaurant is None:
        raise LookupError("Restaurant not found")

    count = db.scalar(
        select(func.count(QueueEntry.id)).where(QueueEntry.restaurant_id == restaurant_id)
    )
    entry = QueueEntry(
        restaurant_id=restaurant_id,
        customer_name=customer_name,
        customer_phone=customer_phone,
        guest_count=guest_count,
        queue_number=f"Q-{int(count or 0) + 1:03d}",
    )
    db.add(entry)
    db.flush()
    return entry


def call_queue_entry(db: Session, *, entry_id: int) -> QueueEntry:
    entry = db.scalar(
        select(QueueEntry)
        .where(QueueEntry.id == entry_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if entry is None:
        raise LookupError("Queue entry not found")
    if entry.status not in {QueueStatus.WAITING, QueueStatus.CALLED}:
        raise QueueWorkflowError("Only waiting parties can be called")
    entry.status = QueueStatus.CALLED
    db.flush()
    return entry


def seat_queue_entry(
    db: Session,
    *,
    entry_id: int,
    table_id: int,
    assigned_by: User,
) -> tuple[QueueEntry, RestaurantTable]:
    entry_ref = db.get(QueueEntry, entry_id)
    if entry_ref is None:
        raise LookupError("Queue entry not found")

    # Lock the candidate table before changing the queue assignment, matching the
    # reservation workflow's table-first lock order.
    table = db.scalar(select(RestaurantTable).where(RestaurantTable.id == table_id).with_for_update())
    entry = db.scalar(select(QueueEntry).where(QueueEntry.id == entry_id).with_for_update())
    if entry is None:
        raise LookupError("Queue entry not found")
    if table is None or table.restaurant_id != entry.restaurant_id:
        raise QueueWorkflowError("Choose a table in the same restaurant")
    if entry.status not in {QueueStatus.WAITING, QueueStatus.CALLED}:
        raise QueueWorkflowError("Only active queue entries can be seated")
    restaurant = db.get(Restaurant, entry.restaurant_id)
    now = restaurant_now(restaurant.timezone if restaurant else "Asia/Colombo")
    clear_expired_unavailability(table, now=now)
    if table.status != TableStatus.AVAILABLE:
        raise QueueWorkflowError("Choose an available table")
    reserved_tables = find_reserved_table_ids(
        db,
        reservation_date=now.date(),
        slot_start=now.time().replace(tzinfo=None),
        table_ids=[table.id],
    )
    if table.id in reserved_tables:
        raise QueueWorkflowError("This table is reserved for an overlapping time slot")
    if table.capacity < entry.guest_count:
        raise QueueWorkflowError("Table does not fit this party")

    entry.status = QueueStatus.SEATED
    table.status = TableStatus.OCCUPIED
    table.unavailable_until = None
    db.add(SeatingRecord(table_id=table.id, queue_entry_id=entry.id, assigned_by_id=assigned_by.id))
    db.flush()
    return entry, table
