# ============================================================
# GridOps AI — Single-container deployment for Hugging Face Spaces
# Runs: Redis + Celery Worker + FastAPI (via supervisord)
# ============================================================

FROM python:3.11-slim

# --- System dependencies ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    redis-server \
    supervisor \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Python dependencies (cached layer) ---
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir supervisor huggingface_hub

# --- Copy application code ---
COPY api/ api/
COPY agents/ agents/
COPY worker/ worker/
COPY rag/ rag/
COPY data_store/ data_store/
COPY scripts/ scripts/
COPY supervisord.conf .
COPY .env.example .env

# --- Build ChromaDB vector index at image build time ---
RUN python -m rag.build_index

# --- Download model at boot (or use bundled weights) ---
# The entrypoint script handles this:
#   1. Runs scripts/download_model.py (downloads from HF Hub if HF_MODEL_REPO is set)
#   2. Launches supervisord (Redis + Celery + FastAPI)

COPY <<'EOF' /app/entrypoint.sh
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
EOF

RUN chmod +x /app/entrypoint.sh

# --- HF Spaces expects port 7860 ---
EXPOSE 7860

# --- Health check ---
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:7860/health || exit 1

CMD ["/app/entrypoint.sh"]
