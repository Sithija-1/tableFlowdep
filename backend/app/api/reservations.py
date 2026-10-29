from datetime import date, time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, require_roles
from app.db.session import get_db
from app.models import Reservation, ReservationStatus, Restaurant, RestaurantTable, Role, User
from app.realtime.hub import event_hub
from app.schemas.reservations import (
    HostReservationPublic,
    ReservationCancellation,
    ReservationCreate,
    ReservationPublic,
)
from app.schemas.restaurants import TablePublic
from app.services.reservations import (
    ReservationConflictError,
    cancel_reservation,
    check_in_reservation,
    complete_reservation,
    create_reservation,
    find_available_tables,
    list_host_reservations,
    reservation_check_in_open,
)
from app.services.table_status import restaurant_now

router = APIRouter(prefix="/reservations", tags=["reservations"])


@router.get("", response_model=list[HostReservationPublic])
def list_for_host(
    restaurant_id: int,
    user: User = Depends(require_roles(Role.HOST, Role.MANAGER, Role.ADMIN)),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Return current and future reservations for the host desk."""
    del user  # Authorization is enforced by the dependency above.
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        return []
    now = restaurant_now(restaurant.timezone)
    in_progress = list_host_reservations(
        db, restaurant_id=restaurant_id, now=now
    )
    return [
        {
            **ReservationPublic.model_validate(reservation).model_dump(),
            "can_check_in": reservation.status == ReservationStatus.CONFIRMED
            and reservation_check_in_open(reservation, now=now),
            "can_complete": reservation.status == ReservationStatus.CHECKED_IN,
        }
        for reservation in in_progress
    ]


@router.get("/availability", response_model=list[TablePublic])
def availability(
    restaurant_id: int = Query(gt=0),
    reservation_date: date = Query(...),
    slot_start: time = Query(...),
    guest_count: int = Query(ge=1, le=20),
    db: Session = Depends(get_db),
) -> list[RestaurantTable]:
    return find_available_tables(
        db,
        restaurant_id=restaurant_id,
        reservation_date=reservation_date,
        slot_start=slot_start,
        guest_count=guest_count,
    )


@router.get("/mine", response_model=list[ReservationPublic])
def list_mine(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[Reservation]:
    return list(
        db.scalars(
            select(Reservation)
            .where(Reservation.customer_id == user.id)
            .order_by(Reservation.reservation_date.desc(), Reservation.slot_start.desc())
        ).all()
    )


@router.post("", response_model=ReservationPublic, status_code=status.HTTP_201_CREATED)
async def reserve(
    payload: ReservationCreate,
    user: User = Depends(require_roles(Role.CUSTOMER)),
    db: Session = Depends(get_db),
) -> Reservation:
    try:
        reservation = create_reservation(db, customer=user, **payload.model_dump())
        db.commit()
        db.refresh(reservation)
    except ReservationConflictError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That arrival time just filled up") from exc

    await event_hub.broadcast(
        reservation.table.restaurant_id,
        {"type": "reservation.created", "reservation_id": reservation.id, "table_id": reservation.table_id},
    )
    return reservation


@router.post("/{reservation_id}/cancel", response_model=ReservationPublic)
async def cancel(
    reservation_id: int,
    _: ReservationCancellation,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Reservation:
    reservation = db.scalar(
        select(Reservation)
        .where(Reservation.id == reservation_id)
        .with_for_update()
    )
    if reservation is None:
        raise HTTPException(status_code=404, detail="Reservation not found")
    try:
        cancel_reservation(db, reservation=reservation, customer=user)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="You cannot cancel this reservation") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    db.commit()
    db.refresh(reservation)
    await event_hub.broadcast(
        reservation.table.restaurant_id,
        {"type": "reservation.cancelled", "reservation_id": reservation.id, "table_id": reservation.table_id},
    )
    return reservation


@router.post("/{reservation_id}/check-in", response_model=ReservationPublic)
async def check_in(
    reservation_id: int,
    user: User = Depends(require_roles(Role.HOST, Role.MANAGER, Role.ADMIN)),
    db: Session = Depends(get_db),
) -> Reservation:
    try:
        reservation = check_in_reservation(
            db, reservation_id=reservation_id, assigned_by=user
        )
        db.commit()
        db.refresh(reservation)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await event_hub.broadcast(
        reservation.table.restaurant_id,
        {
            "type": "reservation.checked_in",
            "reservation_id": reservation.id,
            "table_id": reservation.table_id,
        },
    )
    return reservation


@router.post("/{reservation_id}/complete", response_model=ReservationPublic)
async def complete(
    reservation_id: int,
    _: User = Depends(require_roles(Role.HOST, Role.MANAGER, Role.ADMIN)),
    db: Session = Depends(get_db),
) -> Reservation:
    try:
        reservation = complete_reservation(db, reservation_id=reservation_id)
        db.commit()
        db.refresh(reservation)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await event_hub.broadcast(
        reservation.table.restaurant_id,
        {
            "type": "reservation.completed",
            "reservation_id": reservation.id,
            "table_id": reservation.table_id,
        },
    )
    return reservation
