# api/celery_app.py
from celery import Celery
from api.config import get_settings

settings = get_settings()

celery_app = Celery(
    "gridops_worker",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=['worker.tasks'],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    result_expires=settings.task_result_expires,  # 3600s = 1 hour
    worker_concurrency=settings.worker_concurrency,  # 2 for 8GB RAM
    worker_prefetch_multiplier=1,
    task_acks_late=True,         # Task acknowledged AFTER completion, not pickup
    worker_max_tasks_per_child=50,  # Restart worker process every 50 tasks — prevents memory leaks
    task_soft_time_limit=300,    # Warn at 5 minutes
    task_time_limit=600,         # Hard kill at 10 minutes
    broker_connection_retry_on_startup=True,
)