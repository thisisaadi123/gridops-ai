# ⚡ GridOps AI

### Autonomous Energy Grid Intelligence

**A production-grade forecasting system that combines a finetuned Amazon Chronos-T5 deep learning model with a 7-node LangGraph reasoning agent to analyse PJM electricity demand and generate grid operating mandates.**

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-gridopsai.vercel.app-00d4aa?style=for-the-badge)](https://gridopsai.vercel.app)
[![Backend API](https://img.shields.io/badge/🔧_Backend_API-HuggingFace_Spaces-yellow?style=for-the-badge)](https://huggingface.co/spaces/thisisaadi123/gridops-ai)
[![GitHub](https://img.shields.io/badge/📦_Source-GitHub-181717?style=for-the-badge)](https://github.com/thisisaadi123/gridops-ai)


---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Pipeline Walkthrough](#pipeline-walkthrough)
  - [Phase 1 — Data Pipeline & SARIMA Baseline](#phase-1--data-pipeline--sarima-baseline)
  - [Phase 2 — Chronos Deep Learning Inference](#phase-2--chronos-deep-learning-inference)
  - [Phase 3 — LangGraph Agent Reasoning](#phase-3--langgraph-agent-reasoning)
- [LangGraph Agent — 7-Node Topology](#langgraph-agent--7-node-topology)
- [Mathematical Formulas](#mathematical-formulas)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Getting Started (Local Development)](#getting-started-local-development)
- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Frontend Navigation](#frontend-navigation)
- [API Reference](#api-reference)
- [License](#license)

---

## Overview

GridOps AI ingests **6 years of hourly PJM East electricity demand data** (~52,000 rows), preprocesses it into daily median load, and runs a three-phase pipeline:

1. **Classical baseline** — fits a SARIMA(1,1,1)(1,1,1,7) model and runs a rolling back-test.
2. **Deep learning forecast** — runs the finetuned Amazon Chronos-T5-Base model (200M parameters) to generate probabilistic forecasts with p10/p50/p90 confidence intervals.
3. **Agentic reasoning** — a 7-node LangGraph agent analyses the divergence between the two models, retrieves similar historical grid events via RAG (ChromaDB + sentence-transformers), quantifies risk using VaR-style metrics, and generates a structured grid operating mandate using Groq's LLaMA-3.3-70B.

The entire pipeline executes asynchronously via Celery + Redis, with real-time progress updates streamed to the React frontend.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vercel)                           │
│              React + Vite — gridopsai.vercel.app                    │
│                                                                     │
│   Landing Page  →  Progress Screen  →  Dashboard  →  Event Database │
└────────────────────────────┬────────────────────────────────────────┘
                             │ REST API + Polling
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│               BACKEND (Hugging Face Spaces — Docker)                │
│                                                                     │
│  ┌──────────┐    ┌───────────────┐    ┌─────────────────────────┐  │
│  │  Redis    │◄──►│  FastAPI       │    │  Celery Worker          │  │
│  │  Broker   │    │  (uvicorn)    │    │  (solo pool)            │  │
│  │  Port 6379│    │  Port 7860    │    │                         │  │
│  └──────────┘    └───────────────┘    │  ┌───────────────────┐  │  │
│                                        │  │ Data Pipeline     │  │  │
│                                        │  │ (SARIMA)          │  │  │
│                                        │  ├───────────────────┤  │  │
│                                        │  │ Chronos Client    │  │  │
│                                        │  │ (PyTorch)         │  │  │
│                                        │  ├───────────────────┤  │  │
│                                        │  │ LangGraph Agent   │  │  │
│                                        │  │ (7 nodes)         │  │  │
│                                        │  └───────────────────┘  │  │
│                                        └─────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────┐    ┌──────────────────────────────────┐   │
│  │  ChromaDB            │    │  Groq API (LLaMA-3.3-70B)       │   │
│  │  Vector Store        │    │  External LLM for reasoning     │   │
│  │  (sentence-transformers) │    └──────────────────────────────────┘   │
│  └─────────────────────┘                                            │
│                                                                     │
│            Managed by supervisord (Redis → Celery → FastAPI)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline Walkthrough

### Phase 1 — Data Pipeline & SARIMA Baseline

**File:** `worker/data_pipeline.py`

1. **Data Ingestion** — Reads `data_store/pjm_hourly_est.csv` (~52,000 hourly rows from 2002–2018).
2. **Preprocessing** — Drops structural NaN gaps, forward-fills sporadic gaps, resamples to daily median MW load.
3. **Quality Validation** — Checks for minimum 365 days of data, <5% missing, no negative values, non-zero variance.
4. **Train/Holdout Split** — Chronologically splits the last N days (default: 30) as holdout for evaluation.
5. **Seasonality Detection** — Classifies the regime as `WINTER` (Dec–Feb), `SUMMER` (Jun–Aug), or `SHOULDER` (Mar–May, Sep–Nov) based on the last training date.
6. **SARIMA Fitting** — Fits a `SARIMAX(1,1,1)(1,1,1,7)` model on the training series. The seasonal period of 7 captures weekly demand cycles.
7. **Forecasting** — Produces a 30-day ahead point forecast.
8. **Rolling Back-test** — Evaluates SARIMA accuracy across 3 non-overlapping 30-day windows (spaced 90 days apart) to produce a robust WAPE estimate.

### Phase 2 — Chronos Deep Learning Inference

**File:** `worker/chronos_client.py`

1. **Context Preparation** — Extracts the last 512 daily values from the training series as model context.
2. **Model Loading** — Lazy-loads the Chronos-T5-Base model via PyTorch. Falls back to `amazon/chronos-t5-base` from HuggingFace Hub if the finetuned model path is unavailable.
3. **Quantile Prediction** — Calls `predict_quantiles()` with quantile levels `[0.1, 0.5, 0.9]` to generate:
   - **p10** — 10th percentile (optimistic lower bound)
   - **p50** — Median forecast (point estimate)
   - **p90** — 90th percentile (pessimistic upper bound)
4. **Evaluation** — Computes WAPE against holdout actuals and interval sharpness.

### Phase 3 — LangGraph Agent Reasoning

**File:** `agents/graph.py`, `agents/nodes.py`

The 7-node LangGraph agent processes all upstream model outputs and generates a structured operating mandate. See the [detailed topology below](#langgraph-agent--7-node-topology).

---

## LangGraph Agent — 7-Node Topology

```
                    START
                      │
               ┌──────▼──────┐
               │  Node 1:    │
               │  Validate   │──── quality_fail ──→ END
               │  Data       │
               └──────┬──────┘
                      │ quality_pass
              ┌───────┴───────┐
              ▼               ▼
     ┌────────────┐   ┌────────────┐
     │  Node 2A:  │   │  Node 2B:  │     ← Parallel Execution
     │ Divergence │   │ Seasonality│
     │  Analyst   │   │  Detector  │
     └─────┬──────┘   └──────┬─────┘
           │                 │
           └────────┬────────┘
                    ▼ (fan-in)
           ┌────────────────┐
           │   Node 3:      │
           │  RAG Retriever │
           └───────┬────────┘
                   ▼
           ┌────────────────┐
           │   Node 4:      │
           │ Risk Quantifier│
           └───────┬────────┘
                   │
            ┌──────▼──────┐
            │  RISK GATE  │  (conditional edge)
            │  score ≥ T? │
            └──┬───────┬──┘
               │       │
          ≥ 0.40    < 0.40
               ▼       ▼
     ┌──────────┐ ┌──────────────┐
     │ Node 5A: │ │   Node 5B:   │
     │ Strategy │ │ Conservative │
     │Formulator│ │   Advisory   │
     └────┬─────┘ └──────┬───────┘
          │              │
          └──────┬───────┘
                 ▼
                END
```

### Node Descriptions

| Node | Name | Type | Purpose |
|---|---|---|---|
| 1 | **Data Validator** | Gate | Validates data quality metrics. If quality fails, graph terminates early to avoid wasting API calls. |
| 2A | **Divergence Analyst** | Parallel | Computes the divergence between SARIMA and Chronos forecasts. Outputs the `anomaly_severity_score` (0.0–1.0) which drives the risk gate. |
| 2B | **Seasonality Detector** | Parallel | Uses LLM (Groq/LLaMA-3.3-70B) to produce qualitative seasonality risk assessment based on the current regime. Runs simultaneously with Node 2A. |
| 3 | **RAG Retriever** | Fan-in | Synthesizes findings from both parallel nodes into a semantic query. Retrieves the top-3 most similar historical grid events from ChromaDB using cosine similarity. |
| 4 | **Risk Quantifier** | Sequential | Computes VaR-style risk metrics (downside VaR, upside VaR, risk/reward ratio) from the Chronos confidence bands. Pure math — no LLM. |
| 5A | **Strategy Formulator** | Conditional | Invoked when `anomaly_severity_score ≥ threshold`. Uses LLM to synthesize ALL upstream signals into a structured JSON trading mandate with contract type, stop-loss triggers, and risk factors. |
| 5B | **Conservative Advisory** | Conditional | Invoked when `anomaly_severity_score < threshold`. Produces a conservative HOLD advisory with minimal position sizing. |

---

## Mathematical Formulas

### WAPE (Weighted Absolute Percentage Error)

Used to evaluate forecast accuracy. Unlike MAPE, WAPE is robust to near-zero actual values.

```
WAPE = Σ|actualᵢ − forecastᵢ| / Σ|actualᵢ|
```

**Implementation:** `worker/data_pipeline.py` → `calculate_wape()`

### Interval Sharpness

Measures how tight the Chronos prediction interval is. Higher = tighter = more confident forecasts.

```
Sharpness = 1 / mean(p90 − p10)
```

**Implementation:** `worker/data_pipeline.py` → `calculate_interval_sharpness()`

### Anomaly Severity Score

A composite score (0.0–1.0) that drives the risk gate. Combines three weighted signals:

```
anomaly_severity = 0.40 × divergence_signal
                 + 0.35 × wape_signal
                 + 0.25 × sharpness_signal
```

Where:
- **divergence_signal** = `min(|mean_variance_%| / 20, 1.0)` — how much the two models disagree
- **wape_signal** = `min(ΔWAPE / 0.1, 1.0)` — how much better Chronos is vs SARIMA
- **sharpness_signal** = `min(sharpness / 0.001, 1.0)` — confidence band tightness

**Implementation:** `agents/nodes.py` → `divergence_analyst_node()`

### Value-at-Risk (VaR) Metrics

Quantifies downside and upside risk from the Chronos confidence bands:

```
Downside VaR = mean(p50 − p10)   // avg MW shortfall below median
Upside VaR   = mean(p90 − p50)   // avg MW surplus above median
Risk/Reward  = Upside VaR / Downside VaR   // >1 = more upside risk
```

**Implementation:** `agents/nodes.py` → `risk_quantifier_node()`

### SARIMA Model Specification

```
SARIMAX(p=1, d=1, q=1)(P=1, D=1, Q=1, s=7)
```

- **(1,1,1)**: One autoregressive term, first-order differencing, one moving average term
- **(1,1,1,7)**: Seasonal component with period 7 (weekly cycle in electricity demand)
- Stationarity and invertibility constraints relaxed for robustness

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Forecasting** | Amazon Chronos-T5-Base (200M params, finetuned) | Probabilistic deep learning forecasts |
| **Classical Baseline** | SARIMA via statsmodels | Statistical benchmark for comparison |
| **Agent Framework** | LangGraph (7 nodes, 2 conditional edges) | Multi-step reasoning with parallel execution |
| **LLM** | Groq (LLaMA-3.3-70B-Versatile) | Fast inference for seasonality + strategy nodes |
| **Vector Database** | ChromaDB + sentence-transformers (all-MiniLM-L6-v2) | RAG: semantic retrieval of historical grid events |
| **Task Queue** | Celery + Redis | Async pipeline execution with progress tracking |
| **API** | FastAPI + uvicorn | REST endpoints + WebSocket support |
| **Frontend** | React 19 + Vite | Interactive dashboard with SVG charts |
| **Process Manager** | supervisord | Orchestrates Redis, Celery, FastAPI in Docker |
| **Backend Hosting** | Hugging Face Spaces (Docker SDK, Free Tier) | GPU-free CPU container |
| **Frontend Hosting** | Vercel (Free Tier) | Static site deployment with CDN |

---

## Project Structure

```
gridops-ai/
├── api/                          # FastAPI application
│   ├── main.py                   # REST endpoints: /health, /orchestrate, /status, /events
│   ├── celery_app.py             # Celery broker configuration
│   ├── config.py                 # Pydantic settings (env vars)
│   ├── schemas.py                # Request/response models
│   └── middleware.py             # Request logging middleware
│
├── agents/                       # LangGraph agent system
│   ├── graph.py                  # 7-node graph definition + conditional edges
│   ├── nodes.py                  # All 7 node implementations
│   ├── state.py                  # GridOpsState TypedDict (shared graph state)
│   └── prompts.py                # LLM prompt templates
│
├── worker/                       # Pipeline execution
│   ├── tasks.py                  # Celery task: run_gridops_pipeline
│   ├── data_pipeline.py          # EnergyDataPipeline (SARIMA + preprocessing)
│   └── chronos_client.py         # Chronos model client (local + API modes)
│
├── rag/                          # Retrieval-Augmented Generation
│   ├── build_index.py            # Builds ChromaDB vector index from event_logs.json
│   └── retriever.py              # GridEventRetriever (semantic search)
│
├── data_store/                   # Data assets
│   ├── pjm_hourly_est.csv        # 6 years of PJM East hourly demand (~52K rows)
│   ├── event_logs.json           # 50 synthetic historical grid events
│   └── chroma_db/                # ChromaDB persistent vector index
│
├── frontend/                     # React application
│   ├── src/
│   │   ├── main.jsx              # App shell, routing, cold-start detection
│   │   ├── LandingPage.jsx       # Configuration form + architecture diagram
│   │   ├── ProgressScreen.jsx    # Real-time pipeline progress tracker
│   │   ├── Dashboard.jsx         # Results dashboard with SVG charts
│   │   ├── EventsDatabase.jsx    # CRUD interface for grid events
│   │   ├── demoData.js           # Pre-computed demo results
│   │   └── styles.css            # Complete design system
│   ├── .env.production           # Points Vite at the HF Space API
│   └── package.json
│
├── scripts/                      # Utility scripts
│   ├── download_model.py         # Downloads finetuned model from HF Hub at boot
│   ├── run_dev.sh                # Start all services locally
│   ├── stop_dev.sh               # Stop all local services
│   └── generate_events.py        # Generate synthetic event_logs.json
│
├── Dockerfile                    # Single-container deployment (Redis + Celery + FastAPI)
├── supervisord.conf              # Process manager for the 3 backend services
├── .dockerignore                 # Excludes frontend, venv, tests from Docker build
├── requirements.txt              # Python dependencies
├── .env.example                  # Template environment variables
└── README.md                     # This file
```

---

## Getting Started (Local Development)

### Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- Redis server (or use the bundled Docker setup)

### 1. Clone the Repository

```bash
git clone https://github.com/thisisaadi123/gridops-ai.git
cd gridops-ai
```

### 2. Backend Setup

```bash
# Create and activate virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Copy environment template and fill in your API keys
cp .env.example .env
# Edit .env → set GROQ_API_KEY (required)

# Build the ChromaDB vector index
python -m rag.build_index
```

### 3. Start Backend Services

```bash
# Option A: Use the convenience script (starts Redis, Celery, FastAPI)
bash scripts/run_dev.sh

# Option B: Start each service manually in separate terminals
redis-server                                                    # Terminal 1
celery -A api.celery_app worker --loglevel=info --pool=solo     # Terminal 2
uvicorn api.main:app --reload --port 8000                       # Terminal 3
```

### 4. Frontend Setup

```bash
cd frontend
npm install
npm run dev
# → Opens at http://localhost:5173
```

### 5. Stop All Services

```bash
bash scripts/stop_dev.sh
```

---

## Deployment

GridOps AI uses a split deployment architecture:

| Component | Platform | URL |
|---|---|---|
| **Backend** (FastAPI + Celery + Redis) | Hugging Face Spaces (Docker) | `https://thisisaadi123-gridops-ai.hf.space` |
| **Frontend** (React + Vite) | Vercel | `https://gridopsai.vercel.app` |
| **Finetuned Model** | Hugging Face Hub | `thisisaadi123/chronos-pjm-finetuned` |

### Backend (Hugging Face Spaces)

The backend runs as a single Docker container managed by `supervisord`:

1. **Redis** starts first (priority 1) as the message broker.
2. **Celery worker** starts next (priority 20) and connects to Redis.
3. **FastAPI** starts last (priority 30) and begins serving requests on port 7860.

The `entrypoint.sh` script runs at container boot to download model weights from HF Hub (if `HF_MODEL_REPO` is configured) before starting services.

> **Note:** Free HF Spaces sleep after 48 hours of inactivity. The frontend includes a cold-start screen that automatically detects when the Space is sleeping and shows boot progress while it wakes up (~90–120 seconds).

### Frontend (Vercel)

The React app is deployed as a static build on Vercel. The `VITE_API_BASE_URL` environment variable points all API calls to the Hugging Face Space backend.

---

## Environment Variables

### Backend (set as HF Space Secrets)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ | — | Groq API key for LLM reasoning (Nodes 2B, 5A, 5B) |
| `HF_MODEL_REPO` | ❌ | — | HuggingFace model repo ID for finetuned weights download |
| `CHRONOS_MODEL_NAME` | ❌ | `amazon/chronos-t5-base` | Model name or local path for Chronos inference |
| `CHRONOS_MODE` | ❌ | `local` | `local` (PyTorch) or `api` (HF Inference API) |
| `REDIS_URL` | ❌ | `redis://localhost:6379/0` | Redis connection string |
| `ENVIRONMENT` | ❌ | `development` | Runtime environment tag |

### Frontend (set in Vercel)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | ✅ | Full URL of the backend API (e.g., `https://thisisaadi123-gridops-ai.hf.space`) |

---

## Frontend Navigation

### 1. Landing Page
- Configure the **severity threshold** (0.01–1.00) — controls the risk gate sensitivity.
- Configure the **forecast horizon** (7–90 days).
- View the system architecture diagram.
- Click **"Execute Pipeline"** to start, or **"Demo Mode"** to view pre-computed results.

### 2. Progress Screen
Shows real-time pipeline execution with three stages:
- **Data Pipeline** — Loading CSV, quality checks, SARIMA fitting.
- **Chronos Inference** — Loading model weights, generating probabilistic forecasts.
- **LangGraph Agent** — Running the 7-node reasoning graph.

### 3. Dashboard
Displays the full pipeline results:
- **Forecast Chart** — Interactive SVG chart with SARIMA, Chronos p50, confidence bands (p10–p90), and actual holdout data. Hover for tooltips.
- **Accuracy Metrics** — SARIMA WAPE, Chronos WAPE, interval sharpness, rolling backtest WAPE.
- **Risk Analysis** — Anomaly severity score, divergence direction, VaR metrics.
- **Operating Mandate** — The AI-generated grid operating recommendation with confidence score, contract type, and risk factors.
- **Agent Trace** — Which graph nodes fired and in what order.
- **Export** — Download forecast data as CSV.

### 4. Event Database
- View all 50+ grid events stored in ChromaDB.
- Add custom events to the knowledge base (they become available for RAG retrieval in future pipeline runs).

### 5. System Status
- Click the health indicator dots (API / Redis / Worker) to open a detailed status modal.
- Status auto-refreshes every 15 seconds.

---

## API Reference

### `GET /health`
Returns system health status for API, Redis, and Celery worker.

```json
{
  "status": "healthy",
  "redis": "connected",
  "celery": "connected",
  "version": "1.0.0"
}
```

### `POST /orchestrate`
Starts the forecasting pipeline asynchronously.

**Request Body:**
```json
{
  "dataset_path": "data_store/pjm_hourly_est.csv",
  "severity_threshold": 0.10,
  "forecast_horizon": 30
}
```

**Response (202 Accepted):**
```json
{
  "task_id": "abc123-...",
  "status": "QUEUED",
  "message": "Pipeline started"
}
```

### `GET /status/{task_id}`
Poll for pipeline progress and results.

**Response (in progress):**
```json
{
  "status": "PROGRESS",
  "progress": 35,
  "stage": "CHRONOS_INFERENCE"
}
```

**Response (complete):**
```json
{
  "status": "SUCCESS",
  "progress": 100,
  "stage": "COMPLETE",
  "result": { /* full pipeline output */ }
}
```

### `GET /events`
List all events in the ChromaDB collection.

### `POST /events`
Add a custom event to the knowledge base.

**Request Body:**
```json
{
  "event_type": "EQUIPMENT_FAILURE",
  "severity": "HIGH",
  "description": "Transformer overheated at substation 42",
  "demand_impact_pct": -3.5,
  "grid_region": "PJM_EAST"
}
```

---

## License

This project is developed for educational and research purposes. The PJM hourly energy data is publicly available. Amazon Chronos-T5 is released under the Apache 2.0 license.
