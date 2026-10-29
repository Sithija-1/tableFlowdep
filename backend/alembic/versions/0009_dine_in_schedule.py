"""Store the selected dine-in arrival slot on food orders.

Revision ID: 0009_dine_in_schedule
Revises: 0008_customer_phone
"""
import sqlalchemy as sa

from alembic import op

revision = "0009_dine_in_schedule"
down_revision = "0008_customer_phone"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("food_orders", sa.Column("dine_in_date", sa.Date(), nullable=True))
    op.add_column("food_orders", sa.Column("dine_in_time", sa.Time(), nullable=True))


def downgrade():
    op.drop_column("food_orders", "dine_in_time")
    op.drop_column("food_orders", "dine_in_date")
