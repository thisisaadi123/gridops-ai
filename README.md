---
title: GridOps AI
emoji: ⚡
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Energy grid intelligence via Chronos & LangGraph
---

# GridOps AI

**Autonomous Energy Grid Intelligence** — a production-grade forecasting system that combines a finetuned Amazon Chronos-T5-Base deep learning model with a 7-node LangGraph reasoning agent to analyse PJM electricity demand and generate grid operating mandates.

## Architecture

| Layer | Technology |
|---|---|
| Forecasting | Amazon Chronos-T5-Base (finetuned, 200M params) |
| Classical Baseline | SARIMA via statsmodels |
| Agent Reasoning | LangGraph 7-node pipeline |
| LLM | Groq (LLaMA-3.3-70B) |
| Vector RAG | ChromaDB + sentence-transformers |
| Task Queue | Celery + Redis |
| API | FastAPI + uvicorn |
| Frontend | React + Vite (deployed on Vercel) |

## Running Locally

```bash
# 1. Clone and set up environment
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Launch all services
bash scripts/run_dev.sh
```

## Environment Variables

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq API key for LLM reasoning nodes |
| `HF_MODEL_REPO` | HuggingFace model repo for finetuned weights |
| `HF_TOKEN` | HuggingFace access token (for private repos) |
| `REDIS_URL` | Redis broker URL (default: redis://localhost:6379/0) |
| `CHRONOS_MODE` | `local` to use finetuned model, `api` for HF Inference API |
