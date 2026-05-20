import asyncio
import json
import uuid
from loguru import logger
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from celery.result import AsyncResult
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from slowapi.errors import RateLimitExceeded
import redis as redis_lib
from api.config import get_settings
from api.schemas import OrchestrationRequest, TaskResponse, StatusResponse, EventCreate
from api.middleware import log_requests
from api.celery_app import celery_app
from worker.tasks import run_gridops_pipeline


class NumpyJSONEncoder(json.JSONEncoder):
    def default(self, o):
        module = o.__class__.__module__
        if module.startswith('numpy') and hasattr(o, 'tolist'):
            return o.tolist()
        if module.startswith('numpy') and hasattr(o, 'item'):
            return o.item()
        return super().default(o)


limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title='GridOps AI', version='1.0.0', description='Autonomous Energy Grid Intelligence')
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # pyrefly: ignore[bad-argument-type]
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
app.add_middleware(BaseHTTPMiddleware, dispatch=log_requests)


@app.get('/health')
async def health():
    try:
        redis_lib.from_url(get_settings().redis_url).ping()
        redis_status = 'connected'
    except Exception:
        redis_status = 'disconnected'

    # Check if any Celery workers are alive
    try:
        ping_resp = celery_app.control.ping(timeout=1.0)
        celery_status = 'connected' if ping_resp else 'disconnected'
    except Exception:
        celery_status = 'disconnected'

    return {'status': 'healthy', 'redis': redis_status, 'celery': celery_status, 'version': '1.0.0'}


@app.post('/orchestrate', status_code=202)
@limiter.limit('5/minute')
async def orchestrate(request: Request, body: OrchestrationRequest):
    task = run_gridops_pipeline.delay(
        dataset_path=body.dataset_path,
        severity_threshold=body.severity_threshold,
        forecast_horizon=body.forecast_horizon,
    )
    return TaskResponse(task_id=task.id, status='QUEUED', message='Pipeline started')


@app.get('/status/{task_id}')
async def get_status(task_id: str):
    result = AsyncResult(task_id, app=celery_app)
    state = result.state
    if state == 'PENDING':
        return StatusResponse(status='PENDING')
    if state == 'PROGRESS':
        info = result.info
        return StatusResponse(status='PROGRESS', progress=info.get('progress', 0), stage=info.get('stage', ''), result=None)
    if state == 'SUCCESS':
        return StatusResponse(status='SUCCESS', progress=100, stage='COMPLETE', result=result.result)
    if state == 'FAILURE':
        return StatusResponse(status='FAILURE', error=str(result.info))
    return StatusResponse(status=state)


# ── Event Management ──────────────────────────
@app.post('/events', status_code=201)
async def add_event(body: EventCreate):
    """Add a custom event to the ChromaDB grid_events collection."""
    from rag.retriever import GridEventRetriever
    from sentence_transformers import SentenceTransformer

    retriever = GridEventRetriever()
    event_id = f"user_{uuid.uuid4().hex[:8]}"

    # Build the document text (same format as build_index.py)
    doc_text = (
        f"Event: {body.event_type} | Severity: {body.severity} | "
        f"Region: {body.grid_region} | Impact: {body.demand_impact_pct:+.1f}% | "
        f"Description: {body.description}"
    )

    # Embed and add to collection
    encoded = retriever._model.encode(doc_text, normalize_embeddings=True)
    if hasattr(encoded, 'tolist'):
        embedding = encoded.tolist()
    else:
        embedding = [float(x) for x in encoded]  # pyrefly: ignore[reportUnknownVariableType]

    retriever._collection.add(
        ids=[event_id],
        embeddings=[embedding],  # pyrefly: ignore[reportArgumentType]
        documents=[doc_text],
        metadatas=[{
            "id": event_id,
            "event_type": body.event_type,
            "severity": body.severity.upper(),
            "description": body.description,
            "demand_impact_pct": body.demand_impact_pct,
            "grid_region": body.grid_region,
        }],
    )

    logger.info(f"Added custom event: {event_id} | {body.event_type} ({body.severity})")
    return {"id": event_id, "message": f"Event '{body.event_type}' added to knowledge base"}


@app.get('/events')
async def list_events():
    """List all events in the ChromaDB collection."""
    from rag.retriever import GridEventRetriever
    retriever = GridEventRetriever()
    stats = retriever.get_stats()

    # Get all documents
    raw = retriever._collection.get(include=["metadatas"])
    events = raw.get("metadatas", [])

    return {"total": stats["total_docs"], "events": events}


@app.websocket('/ws/{task_id}')
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()
    while True:
        try:
            result = AsyncResult(task_id, app=celery_app)
            state = result.state
            if state == 'PROGRESS':
                info = result.info
                await websocket.send_text(json.dumps({'status': 'PROGRESS', 'progress': info.get('progress', 0), 'stage': info.get('stage', ''), 'message': info.get('message', '')}, cls=NumpyJSONEncoder))
            elif state == 'SUCCESS':
                try:
                    message = json.dumps({'status': 'SUCCESS', 'progress': 100, 'stage': 'COMPLETE', 'result': result.result}, cls=NumpyJSONEncoder)
                except TypeError as e:
                    logger.error(f'Failed to serialize task result for websocket: {e}')
                    message = json.dumps({'status': 'FAILURE', 'error': 'Task result was not JSON serializable'}, cls=NumpyJSONEncoder)
                await websocket.send_text(message)
                await websocket.close()
                break
            elif state == 'FAILURE':
                await websocket.send_text(json.dumps({'status': 'FAILURE', 'error': str(result.info)}, cls=NumpyJSONEncoder))
                await websocket.close()
                break
            else:
                await websocket.send_text(json.dumps({'status': state, 'progress': 0, 'stage': '', 'message': ''}, cls=NumpyJSONEncoder))
            await asyncio.sleep(1.5)
        except WebSocketDisconnect:
            logger.info(f'WebSocket disconnected for task {task_id}')
            break
