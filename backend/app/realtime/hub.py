import asyncio
from collections import defaultdict

from fastapi import WebSocket


class EventHub:
    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, restaurant_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._rooms[restaurant_id].add(websocket)

    async def disconnect(self, restaurant_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(restaurant_id)
            if room is not None:
                room.discard(websocket)
                if not room:
                    self._rooms.pop(restaurant_id, None)

    async def broadcast(self, restaurant_id: int, event: dict[str, object]) -> None:
        async with self._lock:
            recipients = tuple(self._rooms.get(restaurant_id, set()))
        failed: list[WebSocket] = []
        for websocket in recipients:
            try:
                await websocket.send_json(event)
            except RuntimeError:
                failed.append(websocket)
        for websocket in failed:
            await self.disconnect(restaurant_id, websocket)


event_hub = EventHub()
