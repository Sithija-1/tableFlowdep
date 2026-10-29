from fastapi import APIRouter

from app.api import auth, menu, orders, queue, reservations, tables

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(tables.router)
api_router.include_router(reservations.router)
api_router.include_router(queue.router)
api_router.include_router(orders.router)
api_router.include_router(menu.router)
