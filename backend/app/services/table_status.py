from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import Reservation, ReservationStatus, RestaurantTable, TableStatus
from app.services.reservation_slots import slot_overlap_filters


def restaurant_now(timezone: str, *, at: datetime | None = None) -> datetime:
    """Return an aware local time for a restaurant's operational timezone."""
    zone = ZoneInfo(timezone)
    if at is None:
        return datetime.now(zone)
    return at.replace(tzinfo=zone) if at.tzinfo is None else at.astimezone(zone)


def _deadline_in_timezone(value: datetime | None, timezone: ZoneInfo) -> datetime | None:
    if value is None:
        return None
    # SQLite drops tzinfo when round-tripping DateTime(timezone=True); stored deadlines
    # are normalized to UTC, so restore that information before comparing.
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return aware.astimezone(timezone)


def clear_expired_unavailability(table: RestaurantTable, *, now: datetime) -> bool:
    """Lazily release a timed maintenance flag once its end time has passed."""
    if table.status != TableStatus.UNAVAILABLE or table.unavailable_until is None:
        return False
    deadline = _deadline_in_timezone(table.unavailable_until, now.tzinfo)
    if deadline is None or deadline > now:
        return False
    table.status = TableStatus.AVAILABLE
    table.unavailable_until = None
    return True


def unavailable_for_slot(table: RestaurantTable, *, slot_start: datetime) -> bool:
    """Whether an active maintenance window overlaps a one-hour reservation slot."""
    if table.status != TableStatus.UNAVAILABLE:
        return False
    deadline = _deadline_in_timezone(table.unavailable_until, slot_start.tzinfo)
    return deadline is None or deadline > slot_start


def reservation_overlaps_window(
    db: Session,
    *,
    table_id: int,
    starts_at: datetime,
    ends_at: datetime,
) -> bool:
    """Check active one-hour reservations against a time-bounded maintenance window."""
    reservations = db.scalars(
        select(Reservation).where(
            Reservation.table_id == table_id,
            Reservation.status.in_(
                (ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN)
            ),
            Reservation.reservation_date >= starts_at.date() - timedelta(days=1),
            Reservation.reservation_date <= ends_at.date(),
        )
    ).all()
    for reservation in reservations:
        reservation_start = datetime.combine(
            reservation.reservation_date, reservation.slot_start
        ).replace(tzinfo=starts_at.tzinfo)
        reservation_end = reservation_start + timedelta(hours=1)
        if starts_at < reservation_end and reservation_start < ends_at:
            return True
    return False


def current_table_statuses(
    db: Session,
    *,
    tables: list[RestaurantTable],
    now: datetime,
) -> dict[int, TableStatus]:
    """Overlay live reservation state on persistent physical table conditions."""
    if not tables:
        return {}

    live_reservations = db.execute(
        select(Reservation.table_id, Reservation.status).where(
            Reservation.table_id.in_([table.id for table in tables]),
            *slot_overlap_filters(
                now.date(), now.time().replace(tzinfo=None)
            ),
        )
    ).all()
    status_by_table: dict[int, TableStatus] = {}
    for table_id, reservation_status in live_reservations:
        next_status = (
            TableStatus.OCCUPIED
            if reservation_status == ReservationStatus.CHECKED_IN
            else TableStatus.RESERVED
        )
        if next_status == TableStatus.OCCUPIED or table_id not in status_by_table:
            status_by_table[table_id] = next_status

    effective: dict[int, TableStatus] = {}
    for table in tables:
        if table.status == TableStatus.OCCUPIED:
            effective[table.id] = table.status
        elif unavailable_for_slot(table, slot_start=now):
            effective[table.id] = TableStatus.UNAVAILABLE
        else:
            effective[table.id] = status_by_table.get(table.id, TableStatus.AVAILABLE)
    return effective


def has_current_or_future_reservation(
    db: Session,
    *,
    table_id: int,
    now: datetime,
) -> bool:
    """A reservation only protects a table until its one-hour slot has ended."""
    lower_bound = now.replace(tzinfo=None) - timedelta(hours=1)
    live_or_future = [
        Reservation.reservation_date > now.date(),
        and_(
            Reservation.reservation_date == now.date(),
            Reservation.slot_start > lower_bound.time(),
        ),
    ]
    if lower_bound.date() < now.date():
        live_or_future.append(
            and_(
                Reservation.reservation_date == lower_bound.date(),
                Reservation.slot_start > lower_bound.time(),
            )
        )

    return (
        db.scalar(
            select(Reservation.id)
            .where(
                Reservation.table_id == table_id,
                Reservation.status.in_(
                    (ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN)
                ),
                or_(*live_or_future),
            )
            .limit(1)
        )
        is not None
    )
