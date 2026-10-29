"""Attach food orders to customer accounts.

Revision ID: 0007_customer_owned_orders
Revises: 0006_delivery_location_tracking
"""
import sqlalchemy as sa

from alembic import op

revision = "0007_customer_owned_orders"
down_revision = "0006_delivery_location_tracking"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("food_orders", sa.Column("customer_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_food_orders_customer_id_users",
        "food_orders",
        "users",
        ["customer_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_food_orders_customer_id", "food_orders", ["customer_id"])


def downgrade():
    op.drop_index("ix_food_orders_customer_id", table_name="food_orders")
    op.drop_constraint("fk_food_orders_customer_id_users", "food_orders", type_="foreignkey")
    op.drop_column("food_orders", "customer_id")
