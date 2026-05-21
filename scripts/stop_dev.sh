#!/bin/bash
# To make this script executable, run: chmod +x scripts/stop_dev.sh

echo "🛑 Stopping GridOps AI services..."

# 1. Stop Docker containers (Redis & Flower)
echo "Stopping Docker containers..."
docker compose down

# 2. Kill Celery workers
echo "Killing Celery workers..."
pkill -f "celery -A api.celery_app worker"

# 3. Kill FastAPI backend (uvicorn)
echo "Killing FastAPI (uvicorn)..."
pkill -f "uvicorn api.main:app"

# 4. Kill Vite frontend
echo "Killing React frontend (vite)..."
pkill -f "vite"

echo "✅ All GridOps AI background services have been stopped."
