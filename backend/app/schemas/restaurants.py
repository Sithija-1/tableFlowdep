from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import TableStatus


class TablePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    restaurant_id: int
    number: str
    capacity: int = Field(ge=1)
    status: TableStatus
    location: str | None
    unavailable_until: datetime | None


class TableStatusUpdate(BaseModel):
    status: TableStatus
    unavailable_for_minutes: int | None = Field(default=None, ge=5, le=10080)

    @model_validator(mode="after")
    def validate_unavailable_duration(self) -> "TableStatusUpdate":
        if self.status == TableStatus.UNAVAILABLE and self.unavailable_for_minutes is None:
            raise ValueError("Choose how long the table should be unavailable")
        if self.status != TableStatus.UNAVAILABLE and self.unavailable_for_minutes is not None:
            raise ValueError("Unavailable duration only applies to unavailable tables")
        return self


class TableFloorInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: str
    capacity: int
    location: str | None
    shape: str
    status: str
    available: bool
    fits_party: bool
