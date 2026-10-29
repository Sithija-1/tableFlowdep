"""Support customer reservations before account creation.

Revision ID: 0002_guest_reservations
Revises: 0001_initial_schema
Create Date: 2026-10-10
"""

import sqlalchemy as sa

from alembic import op

revision = "0002_guest_reservations"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reservations", sa.Column("guest_name", sa.String(length=120), nullable=True))
    op.add_column("reservations", sa.Column("guest_email", sa.String(length=255), nullable=True))
    op.execute("UPDATE reservations SET guest_name = 'Guest', guest_email = 'unknown@example.invalid'")
    op.alter_column("reservations", "guest_name", nullable=False)
    op.alter_column("reservations", "guest_email", nullable=False)
    op.create_index("ix_reservations_guest_email", "reservations", ["guest_email"])
    op.alter_column("reservations", "customer_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("reservations", "customer_id", existing_type=sa.Integer(), nullable=False)
    op.drop_index("ix_reservations_guest_email", table_name="reservations")
    op.drop_column("reservations", "guest_email")
    op.drop_column("reservations", "guest_name")
