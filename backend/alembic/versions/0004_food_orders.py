"""Persistent QR food orders.

Revision ID: 0004_food_orders
Revises: 0003_time_aware_seating
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_food_orders"
down_revision = "0003_time_aware_seating"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("food_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("restaurant_id", sa.Integer(), sa.ForeignKey("restaurants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tracking_token", sa.String(64), nullable=False, unique=True),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("order_type", sa.String(16), nullable=False),
        sa.Column("table_number", sa.String(16)),
        sa.Column("delivery_address", sa.Text()),
        sa.Column("payment_method", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("items", sa.Text(), nullable=False),
        sa.Column("total_cents", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_food_orders_restaurant_id", "food_orders", ["restaurant_id"])
    op.create_index("ix_food_orders_tracking_token", "food_orders", ["tracking_token"], unique=True)


def downgrade():
    op.drop_index("ix_food_orders_tracking_token", "food_orders")
    op.drop_index("ix_food_orders_restaurant_id", "food_orders")
    op.drop_table("food_orders")
