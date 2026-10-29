"""Add timed maintenance and reservation completion lifecycle.

Revision ID: 0003_time_aware_seating
Revises: 0002_guest_reservations
Create Date: 2026-10-11
"""

import sqlalchemy as sa

from alembic import op

revision = "0003_time_aware_seating"
down_revision = "0002_guest_reservations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "restaurant_tables",
        sa.Column("unavailable_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'COMPLETED'")


def downgrade() -> None:
    op.drop_column("restaurant_tables", "unavailable_until")
    # PostgreSQL enum values cannot be removed without recreating the type.
