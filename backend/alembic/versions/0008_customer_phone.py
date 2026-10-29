"""Store customer contact phones on accounts and food orders.

Revision ID: 0008_customer_phone
Revises: 0007_customer_owned_orders
"""
import sqlalchemy as sa

from alembic import op

revision = "0008_customer_phone"
down_revision = "0007_customer_owned_orders"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column("food_orders", sa.Column("customer_phone", sa.String(length=32), nullable=True))


def downgrade():
    op.drop_column("food_orders", "customer_phone")
    op.drop_column("users", "phone")
