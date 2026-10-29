from datetime import date, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import ReservationStatus


class AvailabilityQuery(BaseModel):
    restaurant_id: int = Field(gt=0)
    reservation_date: date
    slot_start: time
    guest_count: int = Field(ge=1, le=20)


class ReservationCreate(AvailabilityQuery):
    guest_name: str = Field(min_length=2, max_length=120)
    guest_email: EmailStr
    preferred_table_id: int | None = Field(default=None, gt=0)
    notes: str | None = Field(default=None, max_length=1000)


class ReservationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int | None
    table_id: int
    table_number: str
    guest_name: str
    guest_email: EmailStr
    reservation_date: date
    slot_start: time
    guest_count: int
    status: ReservationStatus
    notes: str | None


class HostReservationPublic(ReservationPublic):
    can_check_in: bool
    can_complete: bool


class ReservationCancellation(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)
