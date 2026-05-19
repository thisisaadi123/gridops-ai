"""Middleware definitions for the FastAPI application."""
import sys
import time
from loguru import logger
from fastapi import Request

# Configure loguru — structured JSON logs in production
logger.remove()
logger.add(
    sys.stdout,
    format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {name}:{function}:{line} | {message}",
    level="INFO",
    colorize=True,
)
logger.add(
    "logs/gridops.log",
    rotation="10 MB",
    retention="7 days",
    compression="zip",
    level="DEBUG",
)

async def log_requests(request: Request, call_next):
    """Log the request method, path, status code, and duration."""
    start = time.perf_counter()
    response = await call_next(request)
    duration = (time.perf_counter() - start) * 1000
    logger.info(
        f"{request.method} {request.url.path} → {response.status_code} ({duration:.1f}ms)"
    )
    return response
