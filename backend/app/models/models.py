import enum
from datetime import date, datetime, time

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Role(str, enum.Enum):
    CUSTOMER = "CUSTOMER"
    HOST = "HOST"
    WAITER = "WAITER"
    MANAGER = "MANAGER"
    ADMIN = "ADMIN"


class TableStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    RESERVED = "RESERVED"
    OCCUPIED = "OCCUPIED"
    UNAVAILABLE = "UNAVAILABLE"


class ReservationStatus(str, enum.Enum):
    CONFIRMED = "CONFIRMED"
    CHECKED_IN = "CHECKED_IN"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class QueueStatus(str, enum.Enum):
    WAITING = "WAITING"
    CALLED = "CALLED"
    SEATED = "SEATED"
    CANCELLED = "CANCELLED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, name="role"), default=Role.CUSTOMER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    reservations: Mapped[list["Reservation"]] = relationship(back_populates="customer")


class Restaurant(Base):
    __tablename__ = "restaurants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Colombo")
    opening_hour: Mapped[int] = mapped_column(Integer, default=17)
    closing_hour: Mapped[int] = mapped_column(Integer, default=23)

    tables: Mapped[list["RestaurantTable"]] = relationship(back_populates="restaurant")


class RestaurantTable(Base):
    __tablename__ = "restaurant_tables"
    __table_args__ = (UniqueConstraint("restaurant_id", "number", name="uq_table_number_per_restaurant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(16))
    capacity: Mapped[int] = mapped_column(Integer)
    status: Mapped[TableStatus] = mapped_column(Enum(TableStatus, name="table_status"), default=TableStatus.AVAILABLE)
    location: Mapped[str | None] = mapped_column(String(80), nullable=True)
    unavailable_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    restaurant: Mapped[Restaurant] = relationship(back_populates="tables")
    reservations: Mapped[list["Reservation"]] = relationship(back_populates="table")


class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (
        Index(
            "uq_active_table_reservation_slot",
            "table_id",
            "reservation_date",
            "slot_start",
            unique=True,
            postgresql_where=text("status IN ('CONFIRMED', 'CHECKED_IN')"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True
    )
    table_id: Mapped[int] = mapped_column(ForeignKey("restaurant_tables.id"), index=True)
    guest_name: Mapped[str] = mapped_column(String(120))
    guest_email: Mapped[str] = mapped_column(String(255), index=True)
    reservation_date: Mapped[date] = mapped_column(Date, index=True)
    slot_start: Mapped[time] = mapped_column(Time)
    guest_count: Mapped[int] = mapped_column(Integer)
    status: Mapped[ReservationStatus] = mapped_column(Enum(ReservationStatus, name="reservation_status"), default=ReservationStatus.CONFIRMED)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    customer: Mapped[User | None] = relationship(back_populates="reservations")
    table: Mapped[RestaurantTable] = relationship(back_populates="reservations")

    @property
    def table_number(self) -> str:
        return self.table.number


class QueueEntry(Base):
    __tablename__ = "queue_entries"
    __table_args__ = (UniqueConstraint("restaurant_id", "queue_number", name="uq_queue_number_per_restaurant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id"), index=True)
    customer_name: Mapped[str] = mapped_column(String(120))
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    guest_count: Mapped[int] = mapped_column(Integer)
    queue_number: Mapped[str] = mapped_column(String(16))
    status: Mapped[QueueStatus] = mapped_column(Enum(QueueStatus, name="queue_status"), default=QueueStatus.WAITING, index=True)
    arrived_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    restaurant: Mapped["Restaurant"] = relationship()


class SeatingRecord(Base):
    __tablename__ = "seating_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("restaurant_tables.id"), index=True)
    queue_entry_id: Mapped[int | None] = mapped_column(ForeignKey("queue_entries.id"), nullable=True)
    reservation_id: Mapped[int | None] = mapped_column(ForeignKey("reservations.id"), nullable=True)
    assigned_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FoodOrder(Base):
    __tablename__ = "food_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    tracking_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(120))
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    order_type: Mapped[str] = mapped_column(String(16))
    table_number: Mapped[str | None] = mapped_column(String(16), nullable=True)
    dine_in_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    dine_in_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    delivery_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivery_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    rider_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    rider_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    rider_location_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payment_method: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(32), default="PLACED")
    items: Mapped[str] = mapped_column(Text)
    total_cents: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    payment_status: Mapped[str] = mapped_column(String(20), default="UNPAID")
    stripe_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    detail: Mapped[str] = mapped_column(String(400), default="")
    category: Mapped[str] = mapped_column(String(60))
    image: Mapped[str] = mapped_column(String(500), default="/images/dish-pasta.png")
    price_cents: Mapped[int] = mapped_column(Integer)
    available: Mapped[bool] = mapped_column(default=True)
