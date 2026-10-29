"""Host menu items and online payment tracking.

Revision ID: 0005_menu_payments
Revises: 0004_food_orders
"""
import sqlalchemy as sa
from alembic import op

revision = "0005_menu_payments"
down_revision = "0004_food_orders"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("menu_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("restaurant_id", sa.Integer(), sa.ForeignKey("restaurants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("detail", sa.String(400), nullable=False),
        sa.Column("category", sa.String(60), nullable=False),
        sa.Column("image", sa.String(500), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("available", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_menu_items_restaurant_id", "menu_items", ["restaurant_id"])
    op.add_column("food_orders", sa.Column("payment_status", sa.String(20), nullable=False, server_default="UNPAID"))
    op.add_column("food_orders", sa.Column("stripe_session_id", sa.String(255), nullable=True))
    # Seed the original showcase items for restaurant 1 only, preserving the existing appearance.
    bind = op.get_bind()
    for name, detail, category, image, price in [
        ("Ember-roasted scallop", "Brown butter · sea herbs · smoked leek", "Small plates", "/images/dish-scallop.png", 2800),
        ("Black garlic pappardelle", "Wild mushroom · aged parmesan · pepper leaf", "Mains", "/images/dish-pasta.png", 3200),
        ("Pistachio mille-feuille", "Lemon verbena · salted caramel · late berries", "Dessert", "/images/dish-dessert.png", 1800),
    ]:
        bind.execute(sa.text("INSERT INTO menu_items (restaurant_id,name,detail,category,image,price_cents,available) SELECT id,:name,:detail,:category,:image,:price,true FROM restaurants WHERE id=1"), dict(name=name,detail=detail,category=category,image=image,price=price))


def downgrade():
    op.drop_column("food_orders", "stripe_session_id")
    op.drop_column("food_orders", "payment_status")
    op.drop_index("ix_menu_items_restaurant_id", "menu_items")
    op.drop_table("menu_items")
