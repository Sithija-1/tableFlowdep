from collections.abc import AsyncIterator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.router import api_router
from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models import Role, User
from app.realtime.hub import event_hub

settings = get_settings()


async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield


app = FastAPI(
    title="TableFlow API",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(api_router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "tableflow-api"}


@app.websocket("/api/v1/realtime/restaurants/{restaurant_id}")
async def restaurant_events(websocket: WebSocket, restaurant_id: int, access_token: str | None = None) -> None:
    if access_token is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        payload = decode_access_token(access_token)
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.id == user_id))
        if user is None or user.role not in {Role.HOST, Role.WAITER, Role.MANAGER, Role.ADMIN}:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    await event_hub.connect(restaurant_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await event_hub.disconnect(restaurant_id, websocket)
