from fastapi import APIRouter
from app.api.v1 import workouts, photos

api_router = APIRouter()
api_router.include_router(workouts.router)
api_router.include_router(photos.router)
