from datetime import date, datetime, time, timedelta

from sqlalchemy import and_, or_

from app.models import Reservation, ReservationStatus


def slot_overlap_filters(reservation_date: date, slot_start: time):
    """SQL filters for the one-hour reservation window around a requested slot."""
    requested_start = datetime.combine(reservation_date, slot_start)
    window_start = requested_start - timedelta(hours=1)
    window_end = requested_start + timedelta(hours=1)
    return (
        Reservation.reservation_date >= window_start.date(),
        Reservation.reservation_date <= window_end.date(),
        or_(
            Reservation.reservation_date > window_start.date(),
            and_(
                Reservation.reservation_date == window_start.date(),
                Reservation.slot_start > window_start.time(),
            ),
        ),
        or_(
            Reservation.reservation_date < window_end.date(),
            and_(
                Reservation.reservation_date == window_end.date(),
                Reservation.slot_start < window_end.time(),
            ),
        ),
        Reservation.status.in_(
            (ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN)
        ),
    )
