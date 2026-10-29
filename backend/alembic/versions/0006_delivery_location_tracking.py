"""Store customer and dispatch coordinates for delivery tracking.

Revision ID: 0006_delivery_location_tracking
Revises: 0005_menu_payments
"""
import sqlalchemy as sa

from alembic import op

revision = "0006_delivery_location_tracking"
down_revision = "0005_menu_payments"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("food_orders", sa.Column("delivery_latitude", sa.Float(), nullable=True))
    op.add_column("food_orders", sa.Column("delivery_longitude", sa.Float(), nullable=True))
    op.add_column("food_orders", sa.Column("rider_latitude", sa.Float(), nullable=True))
    op.add_column("food_orders", sa.Column("rider_longitude", sa.Float(), nullable=True))
    op.add_column(
        "food_orders",
        sa.Column("rider_location_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("food_orders", "rider_location_updated_at")
    op.drop_column("food_orders", "rider_longitude")
    op.drop_column("food_orders", "rider_latitude")
    op.drop_column("food_orders", "delivery_longitude")
    op.drop_column("food_orders", "delivery_latitude")
