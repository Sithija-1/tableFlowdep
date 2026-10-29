"""Create the local demo restaurant and a staff account without committing credentials."""

import os

from sqlalchemy import select

from app.core.security import hash_password, verify_password
from app.db.session import SessionLocal
from app.models import Restaurant, RestaurantTable, Role, TableStatus, User

DEMO_TABLES = (
    ("T01", 2, TableStatus.AVAILABLE, "Window"),
    ("T02", 4, TableStatus.AVAILABLE, "Main dining"),
    ("T03", 6, TableStatus.AVAILABLE, "Main dining"),
    ("T04", 2, TableStatus.AVAILABLE, "Bar"),
    ("T05", 6, TableStatus.AVAILABLE, "Main dining"),
    ("T06", 4, TableStatus.AVAILABLE, "Kitchen side"),
    ("T07", 6, TableStatus.AVAILABLE, "Private corner"),
    ("T08", 4, TableStatus.AVAILABLE, "Terrace"),
    ("T09", 4, TableStatus.AVAILABLE, "Terrace"),
    ("T10", 8, TableStatus.AVAILABLE, "Private dining"),
)


def seed() -> None:
    password = os.environ.get("TABLEFLOW_DEMO_HOST_PASSWORD")
    if not password:
        raise RuntimeError("Set TABLEFLOW_DEMO_HOST_PASSWORD before running the demo seed")

    email = os.environ.get("TABLEFLOW_DEMO_HOST_EMAIL", "host@tableflowdemo.com").lower()
    with SessionLocal() as db:
        restaurant = db.scalar(select(Restaurant).where(Restaurant.name == "TableFlow — The Meridian"))
        if restaurant is None:
            restaurant = Restaurant(name="TableFlow — The Meridian", timezone="Asia/Colombo")
            db.add(restaurant)
            db.flush()
            db.add_all(
                RestaurantTable(
                    restaurant_id=restaurant.id,
                    number=number,
                    capacity=capacity,
                    status=status,
                    location=location,
                )
                for number, capacity, status, location in DEMO_TABLES
            )

        host = db.scalar(select(User).where(User.email == email))
        if host is None:
            db.add(
                User(
                    email=email,
                    full_name="Maya Chen",
                    password_hash=hash_password(password),
                    role=Role.HOST,
                )
            )
        elif not verify_password(password, host.password_hash):
            # The ignored .env file is the source of truth for the local demo host.
            host.password_hash = hash_password(password)
        db.commit()
        print(f"Seed complete. Restaurant ID: {restaurant.id}; staff email: {email}")


if __name__ == "__main__":
    seed()
