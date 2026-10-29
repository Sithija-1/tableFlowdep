from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import QueueStatus


class QueueCreate(BaseModel):
    restaurant_id: int = Field(gt=0)
    customer_name: str = Field(min_length=2, max_length=120)
    customer_phone: str | None = Field(default=None, max_length=32)
    guest_count: int = Field(ge=1, le=20)


class QueuePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    restaurant_id: int
    customer_name: str
    customer_phone: str | None
    guest_count: int
    queue_number: str
    status: QueueStatus
    arrived_at: datetime


class SeatQueueEntry(BaseModel):
    table_id: int = Field(gt=0)
