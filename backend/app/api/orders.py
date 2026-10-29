import json
import os
import secrets
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.db.session import get_db
from app.models import FoodOrder, MenuItem, Reservation, Restaurant, RestaurantTable, Role, User
from app.services.reservation_slots import slot_overlap_filters
from app.services.table_status import restaurant_now, unavailable_for_slot

router = APIRouter(prefix="/orders", tags=["orders"])

# Prices and identity are authoritative on the server, not supplied by customers.
CATALOG = {
    "scallop": ("Ember-roasted scallop", 2800),
    "pasta": ("Black garlic pappardelle", 3200),
    "dessert": ("Pistachio mille-feuille", 1800),
}


class OrderLine(BaseModel):
    item_id: int
    quantity: int = Field(ge=1, le=30)


class CreateOrder(BaseModel):
    restaurant_id: int
    customer_name: str = Field(min_length=2, max_length=120)
    customer_phone: str = Field(min_length=7, max_length=32, pattern=r"^\+?[0-9][0-9\s().-]{5,30}$")
    order_type: Literal["DINE_IN", "TAKEAWAY", "DELIVERY"]
    table_number: str | None = None
    dine_in_date: date | None = None
    dine_in_time: time | None = None
    delivery_address: str | None = None
    delivery_latitude: float | None = Field(default=None, ge=-90, le=90)
    delivery_longitude: float | None = Field(default=None, ge=-180, le=180)
    payment_method: Literal["CASH", "CARD_ON_ARRIVAL", "CARD_ONLINE", "SIMULATED_CARD"]
    card_number: str | None = Field(default=None, max_length=32)
    card_expiry: str | None = Field(default=None, max_length=7)
    card_cvv: str | None = Field(default=None, max_length=4)
    items: list[OrderLine] = Field(min_length=1, max_length=30)


class StatusUpdate(BaseModel):
    status: Literal["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"]


class RiderLocation(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


def serialize(order: FoodOrder):
    return {
        "id": order.id,
        "customer_id": order.customer_id,
        "tracking_token": order.tracking_token,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "order_type": order.order_type,
        "table_number": order.table_number,
        "dine_in_date": order.dine_in_date.isoformat() if order.dine_in_date else None,
        "dine_in_time": order.dine_in_time.isoformat() if order.dine_in_time else None,
        "delivery_address": order.delivery_address,
        "delivery_latitude": order.delivery_latitude,
        "delivery_longitude": order.delivery_longitude,
        "rider_latitude": order.rider_latitude,
        "rider_longitude": order.rider_longitude,
        "rider_location_updated_at": order.rider_location_updated_at.isoformat() if order.rider_location_updated_at else None,
        "payment_method": order.payment_method,
        "status": order.status,
        "payment_status": order.payment_status,
        "items": json.loads(order.items),
        "total_cents": order.total_cents,
        "created_at": order.created_at.isoformat() if order.created_at else None,
    }


@router.post("", status_code=201)
def create_order(
    payload: CreateOrder,
    user: User = Depends(require_roles(Role.CUSTOMER)),
    db: Session = Depends(get_db),
):
    restaurant = db.get(Restaurant, payload.restaurant_id)
    if restaurant is None:
        raise HTTPException(404, "Restaurant not found")
    if payload.payment_method == "SIMULATED_CARD":
        if payload.order_type != "DELIVERY":
            raise HTTPException(422, "Simulated card checkout is available for delivery orders only")
        digits = "".join(ch for ch in (payload.card_number or "") if ch.isdigit())
        if not 12 <= len(digits) <= 19 or not _passes_luhn(digits):
            raise HTTPException(422, "Enter a valid card number")
        if not payload.card_expiry or not _valid_expiry(payload.card_expiry):
            raise HTTPException(422, "Enter a valid future expiry date in MM/YY format")
        if not payload.card_cvv or not payload.card_cvv.isdigit() or len(payload.card_cvv) not in (3, 4):
            raise HTTPException(422, "Enter a valid card security code")
    elif any((payload.card_number, payload.card_expiry, payload.card_cvv)):
        raise HTTPException(422, "Card details are only accepted for simulated card checkout")
    if payload.payment_method == "CARD_ONLINE" and not os.getenv("STRIPE_SECRET_KEY"):
        raise HTTPException(503, "Online card payments are not configured yet; choose cash or card on arrival")
    if payload.order_type == "DINE_IN":
        if not payload.table_number:
            raise HTTPException(422, "Select a table")
        if payload.dine_in_date is None or payload.dine_in_time is None:
            raise HTTPException(422, "Choose your dine-in date and arrival time")
        now = restaurant_now(restaurant.timezone)
        target = datetime.combine(payload.dine_in_date, payload.dine_in_time).replace(
            tzinfo=ZoneInfo(restaurant.timezone)
        )
        if target < now:
            raise HTTPException(422, "Choose a future dine-in time")
        table = db.scalar(select(RestaurantTable).where(
            RestaurantTable.restaurant_id == payload.restaurant_id,
            RestaurantTable.number == payload.table_number,
        ).with_for_update())
        if table is None or unavailable_for_slot(table, slot_start=target):
            raise HTTPException(409, "The selected table is not available for dine-in")
        reserved = db.scalar(select(Reservation.id).where(
            Reservation.table_id == table.id,
            *slot_overlap_filters(payload.dine_in_date, payload.dine_in_time),
        ).limit(1))
        if reserved is not None:
            raise HTTPException(409, "This table is reserved around that time. Choose another table or arrival time.")
        # Lock the physical table row for this transaction so simultaneous checkouts
        # cannot both claim it. This also covers unpaid/pending food orders.
        request_start = datetime.combine(payload.dine_in_date, payload.dine_in_time)
        order_window_start = request_start - timedelta(hours=1)
        order_window_end = request_start + timedelta(hours=1)
        active_orders = db.scalars(select(FoodOrder).where(
            FoodOrder.restaurant_id == payload.restaurant_id,
            FoodOrder.order_type == "DINE_IN",
            FoodOrder.table_number == payload.table_number,
            FoodOrder.status.notin_(["CANCELLED", "COMPLETED"]),
        )).all()
        occupied = any(
            existing.dine_in_date is None or existing.dine_in_time is None
            or (datetime.combine(existing.dine_in_date, existing.dine_in_time) < order_window_end
                and order_window_start < datetime.combine(existing.dine_in_date, existing.dine_in_time) + timedelta(hours=1))
            for existing in active_orders
        )
        if occupied:
            raise HTTPException(409, "This table already has an order around that time. Choose another table or arrival time.")
    elif payload.dine_in_date is not None or payload.dine_in_time is not None:
        raise HTTPException(422, "Dine-in date and time are only accepted for dine-in orders")
    if payload.order_type == "DELIVERY" and not (payload.delivery_address or "").strip():
        raise HTTPException(422, "Delivery address is required")
    if payload.order_type == "DELIVERY" and (payload.delivery_latitude is None or payload.delivery_longitude is None):
        raise HTTPException(422, "Select the delivery location on the map")
    if payload.order_type != "DELIVERY" and any((payload.delivery_latitude is not None, payload.delivery_longitude is not None)):
        raise HTTPException(422, "A delivery location is only accepted for delivery orders")
    ids = {line.item_id for line in payload.items}
    menu = {item.id: item for item in db.scalars(select(MenuItem).where(
        MenuItem.restaurant_id == payload.restaurant_id, MenuItem.id.in_(ids), MenuItem.available.is_(True))).all()}
    if len(menu) != len(ids):
        raise HTTPException(422, "A selected menu item is unavailable")
    lines = [{"item_id": line.item_id, "name": menu[line.item_id].name, "quantity": line.quantity,
              "unit_cents": menu[line.item_id].price_cents} for line in payload.items]
    total = sum(line["unit_cents"] * line["quantity"] for line in lines)
    order = FoodOrder(restaurant_id=payload.restaurant_id, customer_id=user.id, tracking_token=secrets.token_urlsafe(24),
        customer_name=user.full_name, customer_phone=payload.customer_phone.strip(), order_type=payload.order_type,
        table_number=payload.table_number if payload.order_type == "DINE_IN" else None,
        dine_in_date=payload.dine_in_date if payload.order_type == "DINE_IN" else None,
        dine_in_time=payload.dine_in_time if payload.order_type == "DINE_IN" else None,
        delivery_address=payload.delivery_address.strip() if payload.order_type == "DELIVERY" else None,
        delivery_latitude=payload.delivery_latitude if payload.order_type == "DELIVERY" else None,
        delivery_longitude=payload.delivery_longitude if payload.order_type == "DELIVERY" else None,
        payment_method=payload.payment_method, items=json.dumps(lines), total_cents=total, status="PLACED",
        payment_status="PAID" if payload.payment_method == "SIMULATED_CARD" else "UNPAID")
    db.add(order)
    db.commit()
    db.refresh(order)
    return serialize(order)


@router.get("/mine")
def list_my_orders(
    user: User = Depends(require_roles(Role.CUSTOMER)),
    db: Session = Depends(get_db),
):
    orders = db.scalars(
        select(FoodOrder)
        .where(FoodOrder.customer_id == user.id)
        .order_by(FoodOrder.created_at.desc(), FoodOrder.id.desc())
    ).all()
    return [serialize(order) for order in orders]


def _passes_luhn(number: str) -> bool:
    checksum = 0
    for index, char in enumerate(reversed(number)):
        digit = int(char)
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit
    return checksum % 10 == 0


def _valid_expiry(value: str) -> bool:
    import re

    match = re.fullmatch(r"(0[1-9]|1[0-2])/(\d{2})", value)
    if not match:
        return False
    month, year = int(match.group(1)), 2000 + int(match.group(2))
    today = date.today()
    return (year, month) >= (today.year, today.month)


@router.get("/occupied-tables")
def occupied_tables(
    restaurant_id: int,
    reservation_date: date | None = None,
    slot_start: time | None = None,
    db: Session = Depends(get_db),
):
    """Public table numbers only; no guest/order details are exposed."""
    orders = db.scalars(select(FoodOrder).where(
        FoodOrder.restaurant_id == restaurant_id,
        FoodOrder.order_type == "DINE_IN",
        FoodOrder.status.notin_(["CANCELLED", "COMPLETED"]),
    )).all()
    if (reservation_date is None) != (slot_start is None):
        raise HTTPException(422, "Provide both reservation_date and slot_start")
    if reservation_date is not None and slot_start is not None:
        requested_start = datetime.combine(reservation_date, slot_start)
        window_start = requested_start - timedelta(hours=1)
        window_end = requested_start + timedelta(hours=1)
        orders = [order for order in orders if (
            order.dine_in_date is None or order.dine_in_time is None
            or (datetime.combine(order.dine_in_date, order.dine_in_time) < window_end
                and window_start < datetime.combine(order.dine_in_date, order.dine_in_time) + timedelta(hours=1))
        )]
    return {"table_numbers": list({order.table_number for order in orders if order.table_number})}


@router.get("/track/{tracking_token}")
def track_order(tracking_token: str, db: Session = Depends(get_db)):
    order = db.scalar(select(FoodOrder).where(FoodOrder.tracking_token == tracking_token))
    if order is None:
        raise HTTPException(404, "Order not found")
    return serialize(order)


@router.post("/track/{tracking_token}/cancel")
def cancel_order(tracking_token: str, db: Session = Depends(get_db)):
    order = db.scalar(select(FoodOrder).where(FoodOrder.tracking_token == tracking_token))
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.payment_method == "CARD_ONLINE" and order.stripe_session_id:
        raise HTTPException(409, "Please contact the restaurant to cancel an online card checkout")
    if order.payment_status == "PAID":
        raise HTTPException(409, "Please contact the restaurant about a refund before cancelling a paid order")
    if order.status not in ("PLACED", "CONFIRMED"):
        raise HTTPException(409, "Please contact the restaurant to cancel an order already being prepared")
    order.status = "CANCELLED"
    db.commit()
    return serialize(order)


@router.get("")
def list_orders(restaurant_id: int, _: User = Depends(require_roles(Role.HOST, Role.MANAGER, Role.ADMIN)), db: Session = Depends(get_db)):
    orders = db.scalars(select(FoodOrder).where(FoodOrder.restaurant_id == restaurant_id).order_by(FoodOrder.id.desc()).limit(150)).all()
    return [serialize(order) for order in orders]


@router.patch("/{order_id}")
def update_order(order_id: int, payload: StatusUpdate, _: User = Depends(require_roles(Role.HOST, Role.MANAGER, Role.ADMIN)), db: Session = Depends(get_db)):
    order = db.get(FoodOrder, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(409, "This order is closed")
    allowed = {"PLACED": {"CONFIRMED", "CANCELLED"}, "CONFIRMED": {"PREPARING", "CANCELLED"},
               "PREPARING": {"READY"}, "READY": {"OUT_FOR_DELIVERY", "COMPLETED"},
               "OUT_FOR_DELIVERY": {"COMPLETED"}}
    if order.payment_method == "CARD_ONLINE" and order.payment_status != "PAID" and payload.status != "CANCELLED":
        raise HTTPException(409, "Awaiting verified online payment")
    if payload.status not in allowed.get(order.status, set()):
        raise HTTPException(409, "Invalid status transition")
    if payload.status == "OUT_FOR_DELIVERY" and order.order_type != "DELIVERY":
        raise HTTPException(409, "Only delivery orders can be dispatched")
    order.status = payload.status
    db.commit()
    return serialize(order)


@router.patch("/{order_id}/payment")
def mark_order_paid(order_id: int, _: User = Depends(require_roles(Role.HOST, Role.MANAGER, Role.ADMIN)), db: Session = Depends(get_db)):
    """Record verified in-person payment. Stripe payment can only be marked by webhook."""
    order = db.get(FoodOrder, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.payment_method == "CARD_ONLINE":
        raise HTTPException(409, "Online card payments must be verified by Stripe")
    if order.status == "CANCELLED":
        raise HTTPException(409, "Cannot record payment for a cancelled order")
    if order.payment_status == "PAID":
        return serialize(order)
    order.payment_status = "PAID"
    db.commit()
    db.refresh(order)
    return serialize(order)


@router.patch("/{order_id}/location")
def update_rider_location(
    order_id: int,
    payload: RiderLocation,
    _: User = Depends(require_roles(Role.HOST, Role.MANAGER, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    """Store the dispatch device's latest GPS position for a delivery in progress."""
    order = db.get(FoodOrder, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.order_type != "DELIVERY" or order.status != "OUT_FOR_DELIVERY":
        raise HTTPException(409, "Live location is available while a delivery is out for delivery")
    order.rider_latitude = payload.latitude
    order.rider_longitude = payload.longitude
    order.rider_location_updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(order)
    return serialize(order)


class CheckoutRequest(BaseModel):
    tracking_token: str


@router.post("/{order_id}/checkout")
def stripe_checkout(order_id: int, payload: CheckoutRequest, db: Session = Depends(get_db)):
    """Create Stripe hosted checkout; card details never touch TableFlow."""
    import os
    from urllib import error, parse, request

    order = db.get(FoodOrder, order_id)
    if not order or not secrets.compare_digest(order.tracking_token, payload.tracking_token):
        raise HTTPException(404, "Order not found")
    if order.payment_method != "CARD_ONLINE" or order.status == "CANCELLED":
        raise HTTPException(409, "Online card checkout not available for this order")
    if order.payment_status == "PAID":
        raise HTTPException(409, "Already paid")
    key = os.getenv("STRIPE_SECRET_KEY", "")
    if not key:
        raise HTTPException(503, "Online card payments are not configured yet. Ask your host to connect Stripe.")
    origin = os.getenv("PUBLIC_CUSTOMER_URL", "http://localhost:3000").rstrip("/")
    currency = os.getenv("STRIPE_CURRENCY", "usd").lower()
    data = {
        "mode": "payment", "success_url": origin + "/?order=1&payment=success",
        "cancel_url": origin + "/?order=1&payment=cancelled",
        "client_reference_id": str(order.id),
        "metadata[order_id]": str(order.id),
        "line_items[0][price_data][currency]": currency,
        "line_items[0][price_data][product_data][name]": "TableFlow order #" + str(order.id),
        "line_items[0][price_data][unit_amount]": str(order.total_cents),
        "line_items[0][quantity]": "1",
    }
    req = request.Request("https://api.stripe.com/v1/checkout/sessions", data=parse.urlencode(data).encode(),
                          headers={"Authorization": "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with request.urlopen(req, timeout=15) as result:
            session = json.load(result)
    except (error.HTTPError, error.URLError, TimeoutError) as exc:
        raise HTTPException(502, "Payment provider unavailable; your order is saved but unpaid") from exc
    order.stripe_session_id = session["id"]
    db.commit()
    return {"checkout_url": session["url"]}


@router.post("/stripe/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Verify Stripe's signed webhook before marking payment successful."""
    import hashlib
    import hmac
    import os
    import time

    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    if not secret:
        raise HTTPException(503, "Stripe webhook not configured")
    body = await request.body()
    fields = dict(chunk.split("=", 1) for chunk in request.headers.get("stripe-signature", "").split(",") if "=" in chunk)
    stamp, signature = fields.get("t", ""), fields.get("v1", "")
    if not stamp.isdigit() or abs(time.time() - int(stamp)) > 300:
        raise HTTPException(400, "Invalid webhook timestamp")
    expected = hmac.new(secret.encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(400, "Invalid webhook signature")
    event = json.loads(body)
    if event.get("type") == "checkout.session.completed":
        session = event["data"]["object"]
        if session.get("payment_status") == "paid":
            order_id = session.get("metadata", {}).get("order_id")
            if str(order_id).isdigit():
                order = db.get(FoodOrder, int(order_id))
                if order and order.stripe_session_id == session.get("id") and session.get("amount_total") == order.total_cents:
                    order.payment_status = "PAID"
                    db.commit()
    return {"received": True}
