import asyncio
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.api.tables import update_table_status
from app.db.base import Base
from app.models import (
    QueueEntry,
    QueueStatus,
    Reservation,
    ReservationStatus,
    Restaurant,
    RestaurantTable,
    Role,
    SeatingRecord,
    TableStatus,
    User,
)
from app.schemas.restaurants import TableStatusUpdate
from app.services.queue import seat_queue_entry
from app.services.reservations import (
    check_in_reservation,
    complete_reservation,
    find_available_tables,
    list_host_reservations,
)
from app.services.table_status import (
    clear_expired_unavailability,
    current_table_statuses,
    reservation_overlaps_window,
)


def make_engine():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return engine


def add_restaurant_and_table(
    db: Session,
    *,
    number: str = "T01",
    status: TableStatus = TableStatus.AVAILABLE,
    unavailable_until: datetime | None = None,
) -> tuple[Restaurant, RestaurantTable]:
    restaurant = Restaurant(name=f"Test Restaurant {number}", timezone="Asia/Colombo")
    db.add(restaurant)
    db.flush()
    table = RestaurantTable(
        restaurant_id=restaurant.id,
        number=number,
        capacity=4,
        status=status,
        unavailable_until=unavailable_until,
    )
    db.add(table)
    db.flush()
    return restaurant, table


def add_reservation(
    db: Session,
    *,
    table: RestaurantTable,
    reservation_date,
    slot_start: time,
    status: ReservationStatus = ReservationStatus.CONFIRMED,
) -> Reservation:
    reservation = Reservation(
        table_id=table.id,
        guest_name="Test Guest",
        guest_email="guest@example.test",
        reservation_date=reservation_date,
        slot_start=slot_start,
        guest_count=2,
        status=status,
    )
    db.add(reservation)
    db.flush()
    return reservation


def test_timed_unavailability_expires_and_releases_table() -> None:
    engine = make_engine()
    now = datetime(2026, 10, 11, 18, 0, tzinfo=ZoneInfo("Asia/Colombo"))
    deadline = now.astimezone(UTC) + timedelta(hours=1)

    with Session(engine) as db:
        _, table = add_restaurant_and_table(
            db,
            status=TableStatus.UNAVAILABLE,
            unavailable_until=deadline,
        )
        assert current_table_statuses(db, tables=[table], now=now)[table.id] == TableStatus.UNAVAILABLE
        assert not clear_expired_unavailability(table, now=now + timedelta(minutes=59))
        assert clear_expired_unavailability(table, now=now + timedelta(hours=1))
        assert table.status == TableStatus.AVAILABLE
        assert table.unavailable_until is None

    engine.dispose()


def test_future_reservation_can_start_when_maintenance_ends() -> None:
    engine = make_engine()
    now = datetime(2026, 10, 11, 18, 0, tzinfo=ZoneInfo("Asia/Colombo"))
    deadline = now.astimezone(UTC) + timedelta(hours=1)

    with Session(engine) as db:
        restaurant, table = add_restaurant_and_table(
            db,
            status=TableStatus.UNAVAILABLE,
            unavailable_until=deadline,
        )
        assert find_available_tables(
            db,
            restaurant_id=restaurant.id,
            reservation_date=now.date(),
            slot_start=time(18, 30),
            guest_count=2,
        ) == []
        assert find_available_tables(
            db,
            restaurant_id=restaurant.id,
            reservation_date=now.date(),
            slot_start=time(19, 0),
            guest_count=2,
        ) == [table]

    engine.dispose()


def test_unavailable_window_cannot_overlap_a_confirmed_reservation() -> None:
    engine = make_engine()
    now = datetime(2026, 10, 11, 18, 0, tzinfo=ZoneInfo("Asia/Colombo"))

    with Session(engine) as db:
        _, table = add_restaurant_and_table(db)
        add_reservation(
            db,
            table=table,
            reservation_date=now.date(),
            slot_start=time(19, 0),
        )
        assert reservation_overlaps_window(
            db,
            table_id=table.id,
            starts_at=now,
            ends_at=now + timedelta(hours=1, minutes=1),
        )
        assert not reservation_overlaps_window(
            db,
            table_id=table.id,
            starts_at=now,
            ends_at=now + timedelta(hours=1),
        )

    engine.dispose()


def test_check_in_and_completion_update_reservation_and_table_together() -> None:
    engine = make_engine()
    now = datetime(2026, 10, 11, 18, 0, tzinfo=ZoneInfo("Asia/Colombo"))

    with Session(engine) as db:
        _, table = add_restaurant_and_table(db)
        host = User(
            email="host@example.test",
            full_name="Test Host",
            password_hash="not-used",
            role=Role.HOST,
        )
        db.add(host)
        db.flush()
        reservation = add_reservation(
            db,
            table=table,
            reservation_date=now.date(),
            slot_start=time(18, 0),
        )

        checked_in = check_in_reservation(
            db,
            reservation_id=reservation.id,
            assigned_by=host,
            now=now,
        )
        assert checked_in.status == ReservationStatus.CHECKED_IN
        assert table.status == TableStatus.OCCUPIED
        assert current_table_statuses(db, tables=[table], now=now)[table.id] == TableStatus.OCCUPIED
        assert db.scalar(select(func.count(SeatingRecord.id))) == 1

        completed = complete_reservation(
            db,
            reservation_id=reservation.id,
            now=now + timedelta(minutes=20),
        )
        assert completed.status == ReservationStatus.COMPLETED
        assert table.status == TableStatus.AVAILABLE
        assert current_table_statuses(db, tables=[table], now=now)[table.id] == TableStatus.AVAILABLE

    engine.dispose()


def test_check_in_is_rejected_before_the_early_arrival_window() -> None:
    engine = make_engine()
    slot_start = datetime(2026, 10, 11, 18, 0, tzinfo=ZoneInfo("Asia/Colombo"))

    with Session(engine) as db:
        _, table = add_restaurant_and_table(db)
        host = User(
            email="host@example.test",
            full_name="Test Host",
            password_hash="not-used",
            role=Role.HOST,
        )
        db.add(host)
        db.flush()
        reservation = add_reservation(
            db,
            table=table,
            reservation_date=slot_start.date(),
            slot_start=slot_start.time(),
        )

        with pytest.raises(ValueError, match="Check-in opens"):
            check_in_reservation(
                db,
                reservation_id=reservation.id,
                assigned_by=host,
                now=slot_start - timedelta(minutes=31),
            )
        assert reservation.status == ReservationStatus.CONFIRMED
        assert table.status == TableStatus.AVAILABLE

    engine.dispose()


def test_checked_in_reservation_stays_visible_until_host_releases_table() -> None:
    engine = make_engine()
    slot_start = datetime(2026, 10, 11, 18, 0, tzinfo=ZoneInfo("Asia/Colombo"))
    now = slot_start + timedelta(hours=3)

    with Session(engine) as db:
        restaurant, table = add_restaurant_and_table(db)
        checked_in = add_reservation(
            db,
            table=table,
            reservation_date=slot_start.date(),
            slot_start=slot_start.time(),
            status=ReservationStatus.CHECKED_IN,
        )
        expired = add_reservation(
            db,
            table=table,
            reservation_date=slot_start.date(),
            slot_start=time(18, 30),
            status=ReservationStatus.CONFIRMED,
        )
        visible = list_host_reservations(
            db, restaurant_id=restaurant.id, now=now
        )

        assert [reservation.id for reservation in visible] == [checked_in.id]
        assert expired.id not in {reservation.id for reservation in visible}

    engine.dispose()


def test_queue_seating_clears_an_expired_maintenance_flag() -> None:
    engine = make_engine()
    now = datetime.now(ZoneInfo("Asia/Colombo"))

    with Session(engine) as db:
        restaurant, table = add_restaurant_and_table(
            db,
            status=TableStatus.UNAVAILABLE,
            unavailable_until=now.astimezone(UTC) - timedelta(minutes=1),
        )
        host = User(
            email="host@example.test",
            full_name="Test Host",
            password_hash="not-used",
            role=Role.HOST,
        )
        db.add(host)
        entry = QueueEntry(
            restaurant_id=restaurant.id,
            customer_name="Walk-in Guest",
            guest_count=2,
            queue_number="Q-001",
            status=QueueStatus.WAITING,
        )
        db.add(entry)
        db.flush()

        seated_entry, seated_table = seat_queue_entry(
            db,
            entry_id=entry.id,
            table_id=table.id,
            assigned_by=host,
        )
        assert seated_entry.status == QueueStatus.SEATED
        assert seated_table.status == TableStatus.OCCUPIED
        assert seated_table.unavailable_until is None

    engine.dispose()


def test_unavailable_status_requires_a_bounded_expiry() -> None:
    with pytest.raises(ValueError, match="Choose how long"):
        TableStatusUpdate(status=TableStatus.UNAVAILABLE)

    assert TableStatusUpdate(
        status=TableStatus.UNAVAILABLE,
        unavailable_for_minutes=60,
    ).unavailable_for_minutes == 60

    with pytest.raises(ValueError, match="only applies"):
        TableStatusUpdate(
            status=TableStatus.AVAILABLE,
            unavailable_for_minutes=60,
        )


def test_host_status_action_sets_and_clears_maintenance_expiry() -> None:
    engine = make_engine()
    with Session(engine) as db:
        _, table = add_restaurant_and_table(db)

        unavailable = asyncio.run(
            update_table_status(
                table.id,
                TableStatusUpdate(
                    status=TableStatus.UNAVAILABLE,
                    unavailable_for_minutes=30,
                ),
                None,
                db,
            )
        )
        assert unavailable["status"] == TableStatus.UNAVAILABLE
        unavailable_until = unavailable["unavailable_until"]
        assert unavailable_until is not None
        assert unavailable_until.replace(tzinfo=UTC) > datetime.now(UTC)

        available = asyncio.run(
            update_table_status(
                table.id,
                TableStatusUpdate(status=TableStatus.AVAILABLE),
                None,
                db,
            )
        )
        assert available["status"] == TableStatus.AVAILABLE
        assert available["unavailable_until"] is None

    engine.dispose()


def test_host_cannot_manually_occupy_a_table_with_an_arriving_reservation() -> None:
    engine = make_engine()
    with Session(engine) as db:
        restaurant, table = add_restaurant_and_table(db)
        now = datetime.now(ZoneInfo(restaurant.timezone))
        starts_soon = (now + timedelta(minutes=15)).replace(second=0, microsecond=0)
        add_reservation(
            db,
            table=table,
            reservation_date=starts_soon.date(),
            slot_start=starts_soon.time(),
        )

        with pytest.raises(HTTPException) as conflict:
            asyncio.run(
                update_table_status(
                    table.id,
                    TableStatusUpdate(status=TableStatus.OCCUPIED),
                    None,
                    db,
                )
            )

        assert conflict.value.status_code == 409
        assert table.status == TableStatus.AVAILABLE

    engine.dispose()
