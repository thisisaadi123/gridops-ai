#!/bin/bash
set -e

echo "=========================================="
echo "  GridOps AI — Container Boot Sequence"
echo "=========================================="

# Step 1: Download model weights if HF_MODEL_REPO is configured
echo "[boot] Checking for model weights..."
python scripts/download_model.py

# Step 2: Rebuild ChromaDB index if needed
if [ ! -d "data_store/chroma_db" ] || [ -z "$(ls -A data_store/chroma_db 2>/dev/null)" ]; then
    echo "[boot] Building ChromaDB vector index..."
    python -m rag.build_index
fi

# Step 3: Launch all services via supervisord
echo "[boot] Starting services (Redis, Celery, FastAPI)..."
exec supervisord -c /app/supervisord.conf
