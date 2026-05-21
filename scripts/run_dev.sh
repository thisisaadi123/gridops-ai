#!/bin/bash
# To make this script executable, run: chmod +x scripts/run_dev.sh

PROJECT_ROOT="/Users/apple/aadi_project/gridops-ai"
cd "$PROJECT_ROOT"

# Check if chroma_db exists, if not build it
if [ ! -d "data_store/chroma_db" ]; then
    echo "data_store/chroma_db not found. Building index first..."
    source venv/bin/activate
    python -m rag.build_index
    deactivate
fi

echo "🚀 GridOps AI starting..."
echo ""
echo "Dashboard:  http://localhost:5173"
echo "API:        http://localhost:8000/docs"
echo "Flower:     http://localhost:5555"
echo "Redis:      localhost:6379"
echo ""

# Tab 1: Docker Compose
osascript -e "tell application \"Terminal\" to do script \"cd $PROJECT_ROOT && docker compose up\""

# Tab 2: Celery Worker
osascript -e "tell application \"Terminal\" to do script \"cd $PROJECT_ROOT && source venv/bin/activate && celery -A api.celery_app worker --loglevel=info --concurrency=2\""

# Tab 3: FastAPI
osascript -e "tell application \"Terminal\" to do script \"cd $PROJECT_ROOT && source venv/bin/activate && uvicorn api.main:app --reload --host 0.0.0.0 --port 8000\""

# Tab 4: React Frontend
osascript -e "tell application \"Terminal\" to do script \"cd $PROJECT_ROOT/frontend && npm run dev\""

echo "✅ All services launched. Check the Terminal tabs."
