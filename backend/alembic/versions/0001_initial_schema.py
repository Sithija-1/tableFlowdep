"""Create the first TableFlow operational schema.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-10-10
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


role = postgresql.ENUM(
    "CUSTOMER", "HOST", "WAITER", "MANAGER", "ADMIN", name="role", create_type=False
)
table_status = postgresql.ENUM(
    "AVAILABLE", "RESERVED", "OCCUPIED", "UNAVAILABLE", name="table_status", create_type=False
)
reservation_status = postgresql.ENUM(
    "CONFIRMED", "CHECKED_IN", "CANCELLED", name="reservation_status", create_type=False
)
queue_status = postgresql.ENUM(
    "WAITING", "CALLED", "SEATED", "CANCELLED", name="queue_status", create_type=False
)


def upgrade() -> None:
    bind = op.get_bind()
    role.create(bind, checkfirst=True)
    table_status.create(bind, checkfirst=True)
    reservation_status.create(bind, checkfirst=True)
    queue_status.create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", role, nullable=False, server_default="CUSTOMER"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "restaurants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Colombo"),
        sa.Column("opening_hour", sa.Integer(), nullable=False, server_default="17"),
        sa.Column("closing_hour", sa.Integer(), nullable=False, server_default="23"),
        sa.UniqueConstraint("name"),
    )

    op.create_table(
        "restaurant_tables",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("restaurant_id", sa.Integer(), sa.ForeignKey("restaurants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(length=16), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("status", table_status, nullable=False, server_default="AVAILABLE"),
        sa.Column("location", sa.String(length=80)),
        sa.UniqueConstraint("restaurant_id", "number", name="uq_table_number_per_restaurant"),
    )
    op.create_index("ix_restaurant_tables_restaurant_id", "restaurant_tables", ["restaurant_id"])

    op.create_table(
        "reservations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("table_id", sa.Integer(), sa.ForeignKey("restaurant_tables.id"), nullable=False),
        sa.Column("reservation_date", sa.Date(), nullable=False),
        sa.Column("slot_start", sa.Time(), nullable=False),
        sa.Column("guest_count", sa.Integer(), nullable=False),
        sa.Column("status", reservation_status, nullable=False, server_default="CONFIRMED"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reservations_customer_id", "reservations", ["customer_id"])
    op.create_index("ix_reservations_table_id", "reservations", ["table_id"])
    op.create_index("ix_reservations_reservation_date", "reservations", ["reservation_date"])
    op.create_index(
        "uq_active_table_reservation_slot",
        "reservations",
        ["table_id", "reservation_date", "slot_start"],
        unique=True,
        postgresql_where=sa.text("status IN ('CONFIRMED', 'CHECKED_IN')"),
    )

    op.create_table(
        "queue_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("restaurant_id", sa.Integer(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("customer_name", sa.String(length=120), nullable=False),
        sa.Column("customer_phone", sa.String(length=32)),
        sa.Column("guest_count", sa.Integer(), nullable=False),
        sa.Column("queue_number", sa.String(length=16), nullable=False),
        sa.Column("status", queue_status, nullable=False, server_default="WAITING"),
        sa.Column("arrived_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("restaurant_id", "queue_number", name="uq_queue_number_per_restaurant"),
    )
    op.create_index("ix_queue_entries_restaurant_id", "queue_entries", ["restaurant_id"])
    op.create_index("ix_queue_entries_status", "queue_entries", ["status"])
    op.create_index("ix_queue_entries_arrived_at", "queue_entries", ["arrived_at"])

    op.create_table(
        "seating_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("table_id", sa.Integer(), sa.ForeignKey("restaurant_tables.id"), nullable=False),
        sa.Column("queue_entry_id", sa.Integer(), sa.ForeignKey("queue_entries.id")),
        sa.Column("reservation_id", sa.Integer(), sa.ForeignKey("reservations.id")),
        sa.Column("assigned_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_seating_records_table_id", "seating_records", ["table_id"])


def downgrade() -> None:
    op.drop_table("seating_records")
    op.drop_table("queue_entries")
    op.drop_index("uq_active_table_reservation_slot", table_name="reservations")
    op.drop_table("reservations")
    op.drop_table("restaurant_tables")
    op.drop_table("restaurants")
    op.drop_table("users")
    bind = op.get_bind()
    queue_status.drop(bind, checkfirst=True)
    reservation_status.drop(bind, checkfirst=True)
    table_status.drop(bind, checkfirst=True)
    role.drop(bind, checkfirst=True)
