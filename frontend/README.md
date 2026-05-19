# GridOps AI Frontend

React/Vite frontend for the GridOps AI FastAPI + Celery backend.

## Run

```bash
cd frontend
npm install
npm run dev
```

The app expects the API at `http://localhost:8000` by default. Override with:

```bash
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

## UX Notes

- The landing screen explains GridOps AI in plain language.
- The pipeline screen explains each backend stage while polling `/status/{task_id}`.
- The dashboard includes actual-vs-forecast charts, a recommendation card, and plain-English explanations.
- Demo mode works without Redis/Celery/FastAPI running.
