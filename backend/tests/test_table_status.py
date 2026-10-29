from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models import (
    Reservation,
    ReservationStatus,
    Restaurant,
    RestaurantTable,
    TableStatus,
)
from app.services.table_status import (
    current_table_statuses,
    has_current_or_future_reservation,
)


def test_live_table_statuses_follow_the_reservation_window() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 10, 11, 18, 30, tzinfo=ZoneInfo("Asia/Colombo"))

    with Session(engine) as db:
        restaurant = Restaurant(name="Test Restaurant", timezone="Asia/Colombo")
        db.add(restaurant)
        db.flush()
        tables = [
            RestaurantTable(
                restaurant_id=restaurant.id,
                number=f"T{index:02d}",
                capacity=2,
                status=status,
            )
            for index, status in enumerate(
                (
                    TableStatus.AVAILABLE,
                    TableStatus.OCCUPIED,
                    TableStatus.UNAVAILABLE,
                    TableStatus.AVAILABLE,
                    TableStatus.AVAILABLE,
                ),
                start=1,
            )
        ]
        db.add_all(tables)
        db.flush()
        db.add_all(
            [
                Reservation(
                    table_id=tables[0].id,
                    guest_name="Guest",
                    guest_email="guest@example.test",
                    reservation_date=now.date(),
                    slot_start=time(18, 0),
                    guest_count=2,
                    status=ReservationStatus.CONFIRMED,
                ),
                Reservation(
                    table_id=tables[1].id,
                    guest_name="Guest",
                    guest_email="guest@example.test",
                    reservation_date=now.date(),
                    slot_start=time(18, 0),
                    guest_count=2,
                    status=ReservationStatus.CONFIRMED,
                ),
                Reservation(
                    table_id=tables[3].id,
                    guest_name="Guest",
                    guest_email="guest@example.test",
                    reservation_date=now.date(),
                    slot_start=time(17, 0),
                    guest_count=2,
                    status=ReservationStatus.CONFIRMED,
                ),
                Reservation(
                    table_id=tables[4].id,
                    guest_name="Guest",
                    guest_email="guest@example.test",
                    reservation_date=now.date(),
                    slot_start=time(18, 0),
                    guest_count=2,
                    status=ReservationStatus.CHECKED_IN,
                ),
            ]
        )
        db.flush()

        statuses = current_table_statuses(db, tables=tables, now=now)

        assert statuses[tables[0].id] == TableStatus.RESERVED
        assert statuses[tables[1].id] == TableStatus.OCCUPIED
        assert statuses[tables[2].id] == TableStatus.UNAVAILABLE
        assert statuses[tables[3].id] == TableStatus.AVAILABLE
        assert statuses[tables[4].id] == TableStatus.OCCUPIED

    engine.dispose()


def test_expired_reservations_do_not_keep_a_table_reserved_or_block_maintenance() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 10, 11, 18, 30, tzinfo=ZoneInfo("Asia/Colombo"))

    with Session(engine) as db:
        restaurant = Restaurant(name="Test Restaurant", timezone="Asia/Colombo")
        db.add(restaurant)
        db.flush()
        table = RestaurantTable(
            restaurant_id=restaurant.id,
            number="T01",
            capacity=2,
            status=TableStatus.AVAILABLE,
        )
        db.add(table)
        db.flush()
        db.add(
            Reservation(
                table_id=table.id,
                guest_name="Guest",
                guest_email="guest@example.test",
                reservation_date=now.date(),
                slot_start=time(17, 0),
                guest_count=2,
                status=ReservationStatus.CONFIRMED,
            )
        )
        db.flush()

        assert current_table_statuses(db, tables=[table], now=now)[table.id] == TableStatus.AVAILABLE
        assert not has_current_or_future_reservation(db, table_id=table.id, now=now)

        future_booking = Reservation(
            table_id=table.id,
            guest_name="Guest",
            guest_email="guest@example.test",
            reservation_date=now.date() + timedelta(days=1),
            slot_start=time(18, 0),
            guest_count=2,
            status=ReservationStatus.CONFIRMED,
        )
        db.add(future_booking)
        db.flush()

        assert has_current_or_future_reservation(db, table_id=table.id, now=now)

    engine.dispose()


def test_reservation_window_expires_correctly_across_midnight() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    now = datetime(2026, 10, 12, 0, 30, tzinfo=ZoneInfo("Asia/Colombo"))

    with Session(engine) as db:
        restaurant = Restaurant(name="Overnight Test Restaurant", timezone="Asia/Colombo")
        db.add(restaurant)
        db.flush()
        table = RestaurantTable(
            restaurant_id=restaurant.id,
            number="T01",
            capacity=2,
            status=TableStatus.AVAILABLE,
        )
        db.add(table)
        db.flush()
        db.add(
            Reservation(
                table_id=table.id,
                guest_name="Guest",
                guest_email="guest@example.test",
                reservation_date=now.date() - timedelta(days=1),
                slot_start=time(23, 45),
                guest_count=2,
                status=ReservationStatus.CONFIRMED,
            )
        )
        db.flush()

        assert current_table_statuses(db, tables=[table], now=now)[table.id] == TableStatus.RESERVED
        assert has_current_or_future_reservation(db, table_id=table.id, now=now)

        slot_end = now + timedelta(minutes=15)
        assert (
            current_table_statuses(db, tables=[table], now=slot_end)[table.id]
            == TableStatus.AVAILABLE
        )
        assert not has_current_or_future_reservation(
            db, table_id=table.id, now=slot_end
        )

    engine.dispose()
