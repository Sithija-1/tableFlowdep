from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import Select, and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Reservation,
    ReservationStatus,
    Restaurant,
    RestaurantTable,
    SeatingRecord,
    TableStatus,
    User,
)
from app.services.reservation_slots import slot_overlap_filters
from app.services.table_status import (
    clear_expired_unavailability,
    restaurant_now,
    unavailable_for_slot,
)


class ReservationConflictError(Exception):
    """Raised when no compatible table can be secured for an arrival slot."""


def find_reserved_table_ids(
    db: Session,
    *,
    reservation_date: date,
    slot_start: time,
    table_ids: list[int],
) -> set[int]:
    if not table_ids:
        return set()
    return set(
        db.scalars(
            select(Reservation.table_id).where(
                Reservation.table_id.in_(table_ids),
                *slot_overlap_filters(reservation_date, slot_start),
            )
        ).all()
    )


def _candidate_tables(
    restaurant_id: int,
    reservation_date: date,
    slot_start: time,
    guest_count: int,
) -> Select[tuple[RestaurantTable]]:
    overlapping_reservation = select(Reservation.id).where(
        Reservation.table_id == RestaurantTable.id,
        *slot_overlap_filters(reservation_date, slot_start),
    )
    return (
        select(RestaurantTable)
        .where(
            RestaurantTable.restaurant_id == restaurant_id,
            RestaurantTable.capacity >= guest_count,
            ~overlapping_reservation.exists(),
        )
        .order_by(RestaurantTable.capacity.asc(), RestaurantTable.number.asc())
    )


def find_available_tables(
    db: Session,
    *,
    restaurant_id: int,
    reservation_date: date,
    slot_start: time,
    guest_count: int,
) -> list[RestaurantTable]:
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        return []
    target = datetime.combine(reservation_date, slot_start).replace(
        tzinfo=ZoneInfo(restaurant.timezone)
    )
    candidates = db.scalars(
        _candidate_tables(restaurant_id, reservation_date, slot_start, guest_count)
    ).all()
    return [table for table in candidates if not unavailable_for_slot(table, slot_start=target)]


def create_reservation(
    db: Session,
    *,
    customer: User | None,
    restaurant_id: int,
    reservation_date: date,
    slot_start: time,
    guest_count: int,
    guest_name: str,
    guest_email: str,
    preferred_table_id: int | None,
    notes: str | None,
) -> Reservation:
    """Lock and claim a requested compatible table, or the smallest compatible table."""
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise ReservationConflictError
    target = datetime.combine(reservation_date, slot_start).replace(
        tzinfo=ZoneInfo(restaurant.timezone)
    )
    candidate_query = _candidate_tables(
        restaurant_id, reservation_date, slot_start, guest_count
    )
    if preferred_table_id is not None:
        candidate_query = candidate_query.where(RestaurantTable.id == preferred_table_id)

    candidates = db.scalars(
        candidate_query.with_for_update(skip_locked=True)
    ).all()

    for table in candidates:
        if unavailable_for_slot(table, slot_start=target):
            continue
        reservation = Reservation(
            customer_id=customer.id if customer is not None else None,
            table_id=table.id,
            guest_name=guest_name.strip(),
            guest_email=guest_email.lower(),
            reservation_date=reservation_date,
            slot_start=slot_start,
            guest_count=guest_count,
            notes=notes,
        )
        try:
            with db.begin_nested():
                db.add(reservation)
                db.flush()
            return reservation
        except IntegrityError:
            # A second writer claimed this table after availability was evaluated.
            continue

    raise ReservationConflictError


def reservation_check_in_open(reservation: Reservation, *, now: datetime) -> bool:
    reservation_start = datetime.combine(
        reservation.reservation_date, reservation.slot_start
    ).replace(tzinfo=now.tzinfo)
    return reservation_start - timedelta(minutes=30) <= now < reservation_start + timedelta(hours=1)


def list_host_reservations(
    db: Session,
    *,
    restaurant_id: int,
    now: datetime,
) -> list[Reservation]:
    """Keep seated parties visible until a host explicitly releases their table."""
    reservations = db.scalars(
        select(Reservation)
        .join(Reservation.table)
        .where(
            RestaurantTable.restaurant_id == restaurant_id,
            or_(
                Reservation.status == ReservationStatus.CHECKED_IN,
                and_(
                    Reservation.status == ReservationStatus.CONFIRMED,
                    Reservation.reservation_date >= now.date() - timedelta(days=1),
                ),
            ),
        )
        .order_by(Reservation.reservation_date.asc(), Reservation.slot_start.asc())
    ).all()
    return [
        reservation
        for reservation in reservations
        if reservation.status == ReservationStatus.CHECKED_IN
        or datetime.combine(
            reservation.reservation_date, reservation.slot_start
        ).replace(tzinfo=now.tzinfo)
        + timedelta(hours=1)
        > now
    ]


def check_in_reservation(
    db: Session,
    *,
    reservation_id: int,
    assigned_by: User,
    now: datetime | None = None,
) -> Reservation:
    """Check a party in and atomically turn its assigned table occupied."""
    reservation_ref = db.get(Reservation, reservation_id)
    if reservation_ref is None:
        raise LookupError("Reservation not found")

    table = db.scalar(
        select(RestaurantTable)
        .where(RestaurantTable.id == reservation_ref.table_id)
        .with_for_update()
    )
    if table is None:
        raise LookupError("Reservation table not found")
    reservation = db.scalar(
        select(Reservation)
        .where(Reservation.id == reservation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if reservation is None:
        raise LookupError("Reservation not found")
    if reservation.table_id != table.id:
        raise ValueError("Reservation table assignment changed; reload and try again")
    restaurant = db.get(Restaurant, table.restaurant_id)
    local_now = restaurant_now(
        restaurant.timezone if restaurant else "Asia/Colombo", at=now
    )
    clear_expired_unavailability(table, now=local_now)

    if reservation.status != ReservationStatus.CONFIRMED:
        raise ValueError("Only confirmed reservations can be checked in")

    if not reservation_check_in_open(reservation, now=local_now):
        raise ValueError("Check-in opens 30 minutes before the reservation and closes after its one-hour slot")

    if table.status == TableStatus.UNAVAILABLE:
        raise ValueError("This table is currently unavailable")
    if table.status == TableStatus.OCCUPIED:
        raise ValueError("This table is already occupied")

    reservation.status = ReservationStatus.CHECKED_IN
    table.status = TableStatus.OCCUPIED
    table.unavailable_until = None
    db.add(
        SeatingRecord(
            table_id=table.id,
            reservation_id=reservation.id,
            assigned_by_id=assigned_by.id,
        )
    )
    db.flush()
    return reservation


def complete_reservation(
    db: Session,
    *,
    reservation_id: int,
    now: datetime | None = None,
) -> Reservation:
    """Finish a checked-in stay and release its table for the next party."""
    reservation_ref = db.get(Reservation, reservation_id)
    if reservation_ref is None:
        raise LookupError("Reservation not found")
    table = db.scalar(
        select(RestaurantTable)
        .where(RestaurantTable.id == reservation_ref.table_id)
        .with_for_update()
    )
    if table is None:
        raise LookupError("Reservation table not found")
    reservation = db.scalar(
        select(Reservation)
        .where(Reservation.id == reservation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if reservation is None:
        raise LookupError("Reservation not found")
    if reservation.table_id != table.id:
        raise ValueError("Reservation table assignment changed; reload and try again")
    if reservation.status != ReservationStatus.CHECKED_IN:
        raise ValueError("Only checked-in reservations can be completed")
    restaurant = db.get(Restaurant, table.restaurant_id)
    local_now = restaurant_now(
        restaurant.timezone if restaurant else "Asia/Colombo", at=now
    )
    clear_expired_unavailability(table, now=local_now)

    reservation.status = ReservationStatus.COMPLETED
    if table.status == TableStatus.OCCUPIED:
        table.status = TableStatus.AVAILABLE
    db.flush()
    return reservation


def complete_active_reservations_for_table(
    db: Session,
    *,
    table_id: int,
) -> None:
    """Keep the table's manual Available action in sync with reservation state."""
    reservations = db.scalars(
        select(Reservation)
        .where(
            Reservation.table_id == table_id,
            Reservation.status == ReservationStatus.CHECKED_IN,
        )
        .with_for_update()
    ).all()
    for reservation in reservations:
        reservation.status = ReservationStatus.COMPLETED


def cancel_reservation(db: Session, *, reservation: Reservation, customer: User) -> Reservation:
    if reservation.customer_id != customer.id and customer.role.value not in {"HOST", "MANAGER", "ADMIN"}:
        raise PermissionError
    if reservation.status == ReservationStatus.CANCELLED:
        return reservation
    if reservation.status in {
        ReservationStatus.CHECKED_IN,
        ReservationStatus.COMPLETED,
    }:
        raise ValueError("Seated or completed reservations cannot be cancelled")
    reservation.status = ReservationStatus.CANCELLED
    db.flush()
    return reservation
