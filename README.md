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

### Autonomous Energy Grid Intelligence

**A production-grade forecasting system that combines a finetuned deep learning model (Amazon Chronos-T5) with a 7-node LangGraph reasoning agent to analyse PJM electricity demand and generate grid operating mandates.**

[Live Demo](https://gridopsai.vercel.app) | [Backend API](https://huggingface.co/spaces/thisisaadi123/gridops-ai) | [GitHub Source](https://github.com/thisisaadi123/gridops-ai)

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Pipeline Walkthrough](#pipeline-walkthrough)
- [LangGraph Agent Workflow](#langgraph-agent-workflow)
- [Key Concepts and Formulas](#key-concepts-and-formulas)
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

**The Problem:** The electricity grid must constantly balance supply and demand. If demand spikes unexpectedly (for example, during a sudden heatwave), grid operators must buy emergency power at exorbitant prices or risk blackouts. Conversely, overestimating demand results in wasted resources. 

**The Solution:** GridOps AI acts as an autonomous grid analyst. It predicts future electricity demand using modern AI and historical data, quantifies the financial risks of those predictions, and advises operators on how to manage the grid safely and profitably.

GridOps AI ingests 6 years of historical hourly electricity demand data from the PJM East region (a major US power grid), processes it into daily averages, and runs a three-phase analytical pipeline:

1. **Statistical Baseline:** Fits a traditional statistical model (SARIMA) to establish a safe, conservative forecast based on historical weekly cycles.
2. **Deep Learning Forecast:** Runs a finetuned Amazon Chronos-T5 AI model to generate highly accurate, probabilistic forecasts.
3. **Agentic Reasoning:** An AI workflow (LangGraph) acts like a team of analysts. It compares the two models, searches a database of historical grid events for context, and generates a structured, plain-English grid operating mandate.

All computations are executed asynchronously in the background, with real-time progress streamed to a React dashboard.

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vercel)                           │
│              React + Vite — gridopsai.vercel.app                    │
│                                                                     │
│   Landing Page  ->  Progress Screen  ->  Dashboard  ->  Event Database │
└────────────────────────────┬────────────────────────────────────────┘
                             │ REST API + Polling
                             V
┌─────────────────────────────────────────────────────────────────────┐
│               BACKEND (Hugging Face Spaces — Docker)                │
│                                                                     │
│  ┌──────────┐    ┌───────────────┐    ┌─────────────────────────┐  │
│  │  Redis    │<--│  FastAPI       │    │  Celery Worker          │  │
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
│  │  (Semantic Search)   │    └──────────────────────────────────┘   │
│  └─────────────────────┘                                            │
│                                                                     │
│            Managed by supervisord (Redis -> Celery -> FastAPI)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline Walkthrough

### Phase 1: Data Pipeline & Statistical Baseline

**File:** `worker/data_pipeline.py`

- **Data Ingestion:** Reads over 52,000 hours of historical electricity load data.
- **Preprocessing:** Cleans the data, fills in missing gaps, and converts hourly data into a single daily average to reduce noise.
- **Quality Validation:** Ensures the data is healthy (e.g., no negative electricity usage, enough historical data to make accurate predictions).
- **SARIMA Fitting:** Fits a traditional statistical model called `SARIMAX(1,1,1)(1,1,1,7)`. The "7" means the model specifically looks for weekly patterns (like demand dropping on weekends).
- **Rolling Back-test:** The system tests its own accuracy by hiding recent data, making a prediction, and comparing its prediction to what actually happened.

### Phase 2: Deep Learning Inference

**File:** `worker/chronos_client.py`

- **Chronos AI:** Uses an advanced AI model developed by Amazon (Chronos-T5-Base) that has been specifically retrained (finetuned) on our grid data. 
- **Probabilistic Forecasting:** Instead of guessing a single number, this model gives a range of possibilities (confidence intervals) to help operators plan for worst-case scenarios. 
- **CPU Optimization:** Runs purely on standard processors (CPUs) without requiring expensive graphics cards (GPUs).

### Phase 3: LangGraph Agent Reasoning

**File:** `agents/graph.py`, `agents/nodes.py`

The pipeline hands all data to an autonomous AI agent workflow that mimics human analysts. See the detailed topology below.

---

## LangGraph Agent Workflow

```text
                    START
                      │
               ┌──────V──────┐
               │  Node 1:    │
               │  Validate   │──── quality_fail ──> END
               │  Data       │
               └──────┬──────┘
                      │ quality_pass
              ┌───────┴───────┐
              V               V
     ┌────────────┐   ┌────────────┐
     │  Node 2A:  │   │  Node 2B:  │     <- Parallel Execution
     │ Divergence │   │ Seasonality│
     │  Analyst   │   │  Detector  │
     └─────┬──────┘   └──────┬─────┘
           │                 │
           └────────┬────────┘
                    V (fan-in)
           ┌────────────────┐
           │   Node 3:      │
           │  RAG Retriever │
           └───────┬────────┘
                   V
           ┌────────────────┐
           │   Node 4:      │
           │ Risk Quantifier│
           └───────┬────────┘
                   │
            ┌──────V──────┐
            │  RISK GATE  │  (conditional edge)
            │  score ≥ T? │
            └──┬───────┬──┘
               │       │
          ≥ 0.40    < 0.40
               V       V
     ┌──────────┐ ┌──────────────┐
     │ Node 5A: │ │   Node 5B:   │
     │ Strategy │ │ Conservative │
     │Formulator│ │   Advisory   │
     └────┬─────┘ └──────┬───────┘
          │              │
          └──────┬───────┘
                 V
                END
```

### Node Descriptions

1. **Data Validator:** Checks the data. If the data is corrupted, it stops the pipeline early to save computing resources.
2. **Divergence Analyst (Node 2A):** Compares the traditional statistical model against the modern AI model. If they disagree wildly, it assigns a high "Anomaly Severity Score".
3. **Seasonality Detector (Node 2B):** Uses a Large Language Model to write a qualitative report about seasonal risks (e.g., "It is currently summer; watch out for heatwaves").
4. **RAG Retriever (Node 3):** Searches a database of historical grid events (like past winter storms or equipment failures) to find situations similar to the current forecast. 
5. **Risk Quantifier (Node 4):** Uses pure math to calculate financial risk metrics based on the AI's confidence intervals.
6. **Strategy Formulator (Node 5A):** If the risk score is high, it uses an LLM to read all the data and formulate a comprehensive, aggressive grid operating strategy.
7. **Conservative Advisory (Node 5B):** If the risk score is low (business as usual), it skips the heavy analysis and simply issues a standard "Hold" advisory.

---

## Key Concepts and Formulas

### WAPE (Weighted Absolute Percentage Error)
**What it is in plain English:** A metric used to grade the model's accuracy. It represents how far off the forecast was, on average, as a percentage. Lower is better (e.g., a 4% WAPE means the model is 96% accurate).
**Formula:** `WAPE = Sum(|Actual - Forecast|) / Sum(|Actual|)`

### Confidence Intervals (p10, p50, p90)
**What it is in plain English:** Instead of predicting exactly one number, the AI predicts a range to account for uncertainty.
- **p50 (Median):** The most likely outcome. Half the time demand will be higher, half the time lower.
- **p10 (Optimistic Bound):** There is only a 10% chance demand will drop this low.
- **p90 (Pessimistic Bound):** There is only a 10% chance demand will spike this high. Grid operators plan for the p90 to prevent blackouts.

### Interval Sharpness
**What it is in plain English:** Measures how "tight" or "narrow" the confidence intervals are. A high sharpness score means the AI is very confident and giving a narrow range. A low score means the AI is uncertain and giving a very wide range.
**Formula:** `Sharpness = 1 / average(p90 - p10)`

### Value-at-Risk (VaR)
**What it is in plain English:** A financial metric used to quantify risk in Megawatts (MW).
- **Downside VaR:** How much lower the demand could go compared to the median forecast.
- **Upside VaR:** How much higher the demand could spike compared to the median forecast.
- **Risk/Reward Ratio:** Compares the upside risk to the downside risk. A ratio > 1.0 means sudden spikes (upside risk) are more likely than sudden drops.

### Anomaly Severity Score
**What it is in plain English:** A custom score from 0.0 to 1.0. It increases when the traditional model and the AI model strongly disagree. A high score flags a highly unusual situation (an anomaly) that requires immediate human attention.

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Deep Learning** | Amazon Chronos-T5-Base | Highly accurate probabilistic forecasting. |
| **Statistical Baseline** | SARIMA (statsmodels) | A traditional, reliable mathematical benchmark. |
| **Agent Framework** | LangGraph | Orchestrates the multi-step reasoning workflow. |
| **Language Model (LLM)** | Groq (LLaMA-3.3-70B) | Extremely fast AI for generating text and strategies. |
| **Vector Database** | ChromaDB + sentence-transformers | Semantically searches for similar historical grid events. |
| **Task Queue** | Celery + Redis | Runs heavy computations asynchronously in the background. |
| **Backend API** | FastAPI + uvicorn | Serves data to the frontend website. |
| **Frontend UI** | React 19 + Vite | An interactive user dashboard with rich charts. |
| **Hosting** | Hugging Face Spaces (Backend) / Vercel (Frontend) | 100% free cloud deployment architecture. |

---

## Project Structure

```text
gridops-ai/
├── api/                          # FastAPI application and routes
├── agents/                       # LangGraph agent definitions and prompts
├── worker/                       # Background task logic (AI inference, SARIMA)
├── rag/                          # Search engine for historical grid events
├── data_store/                   # CSV datasets and vector databases
├── frontend/                     # React web application
├── scripts/                      # Utility scripts for local development
├── Dockerfile                    # Container configuration for backend deployment
├── supervisord.conf              # Process manager (starts Redis, Celery, FastAPI)
└── requirements.txt              # Python library dependencies
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
# Edit .env to set GROQ_API_KEY (required)

# Build the historical event search index
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
# Application opens at http://localhost:5173
```

---

## Deployment

GridOps AI is built to run entirely on free-tier cloud services using a split deployment architecture:

| Component | Platform | URL |
|---|---|---|
| **Backend API** | Hugging Face Spaces (Docker) | `https://thisisaadi123-gridops-ai.hf.space` |
| **Frontend UI** | Vercel | `https://gridopsai.vercel.app` |
| **Finetuned Model** | Hugging Face Hub | `thisisaadi123/chronos-pjm-finetuned` |

### Backend Lifecycle (Hugging Face Spaces)

The backend runs as a single Docker container managed by `supervisord`. When the container boots, it downloads the custom AI model weights. It then sequentially starts Redis, the Celery worker, and finally the FastAPI server. 

Note: Free Hugging Face Spaces sleep after 48 hours of inactivity. The frontend includes a smart cold-start screen that automatically detects sleeping Spaces and displays boot progress while it wakes up (which takes roughly 90 to 120 seconds).

---

## Environment Variables

### Backend (set as Hugging Face Space Secrets)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | Yes | — | API key for the Large Language Model. |
| `HF_MODEL_REPO` | No | — | Repository ID to download finetuned AI weights. |
| `CHRONOS_MODEL_NAME` | No | `amazon/chronos-t5-base` | Name of the Chronos model to use for inference. |
| `CHRONOS_MODE` | No | `local` | Set to `local` to run via PyTorch on the CPU. |

### Frontend (set in Vercel Environment Settings)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | Yes | Full URL of the backend API (e.g., `https://thisisaadi123-gridops-ai.hf.space`) |

---

## Frontend Navigation

1. **Landing Page:** Configure your risk sensitivity and forecast timeline. Click "Execute Pipeline" to begin.
2. **Progress Screen:** Watch real-time logs as the pipeline progresses through Data Prep, Deep Learning Inference, and Agent Reasoning.
3. **Dashboard:** Analyze the final results. View interactive charts, risk metrics, and the AI-generated operating mandate.
4. **Events Database:** View and manage the catalog of historical grid events used for context retrieval.
5. **System Health:** Check the live connection status of the API, Redis, and Celery Worker at any time using the status dots in the navigation bar.

---

## API Reference

### `GET /health`
Returns system health status for API, Redis, and the background worker.

### `POST /orchestrate`
Starts the forecasting pipeline asynchronously and returns a tracking Task ID.

### `GET /status/{task_id}`
Poll this endpoint to track pipeline progress in real time.

### `GET /events` and `POST /events`
Manage the historical grid event knowledge base.

---

## License

This project is developed for educational and research purposes. The historical PJM hourly energy data used for training is publicly available. The Amazon Chronos-T5 model is released under the Apache 2.0 license.
