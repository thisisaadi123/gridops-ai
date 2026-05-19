"""
rag/build_index.py
------------------
Build (or rebuild) the ChromaDB vector index from data_store/event_logs.json.
Safe to re-run: the collection is deleted and recreated on every execution.
"""

import json

import numpy as np
from pathlib import Path
from typing import Mapping

import chromadb
import torch
from loguru import logger
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent          # gridops-ai/
DATA_PATH = ROOT / "data_store" / "event_logs.json"
CHROMA_PATH = ROOT / "data_store" / "chroma_db"
COLLECTION_NAME = "grid_events"


def build_index() -> None:
    # ------------------------------------------------------------------
    # 1. Load event logs
    # ------------------------------------------------------------------
    logger.info(f"Loading event logs from: {DATA_PATH}")
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        logs: list[dict] = json.load(f)
    logger.info(f"Loaded {len(logs)} event log records.")

    # ------------------------------------------------------------------
    # 2. Initialise persistent ChromaDB client
    # ------------------------------------------------------------------
    logger.info(f"Initialising persistent ChromaDB client at: {CHROMA_PATH}")
    CHROMA_PATH.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(CHROMA_PATH))

    # ------------------------------------------------------------------
    # 3. Delete & recreate collection (idempotent re-runs)
    # ------------------------------------------------------------------
    existing = [c.name for c in client.list_collections()]
    if COLLECTION_NAME in existing:
        client.delete_collection(COLLECTION_NAME)
        logger.info(f"Deleted existing collection '{COLLECTION_NAME}'.")

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    logger.info(f"Created fresh collection '{COLLECTION_NAME}'.")

    # ------------------------------------------------------------------
    # 4. Device detection
    # ------------------------------------------------------------------
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    logger.info(f"Using device: '{device}' for sentence-transformer inference.")

    # ------------------------------------------------------------------
    # 5. Load embedding model
    # ------------------------------------------------------------------
    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    logger.info(f"Loading model '{model_name}' …")
    model = SentenceTransformer(model_name, device=device)
    logger.info("Model loaded successfully.")

    # ------------------------------------------------------------------
    # 6. Build rich embedding texts
    # ------------------------------------------------------------------
    texts: list[str] = [
        (
            f"{log['event_type']} "
            f"severity:{log['severity']} "
            f"{log['description']} "
            f"impact:{log['demand_impact_pct']}% "
            f"region:{log['grid_region']}"
        )
        for log in logs
    ]
    logger.info(f"Built {len(texts)} embedding texts.")

    # ------------------------------------------------------------------
    # 7. Batch-embed all texts at once
    # ------------------------------------------------------------------
    logger.info("Embedding all texts in a single batch …")
    embeddings: np.ndarray = np.asarray(
        model.encode(
            texts,
            batch_size=len(texts),   # single pass — 50 records is trivially small
            show_progress_bar=True,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )
    )
    logger.info(f"Embeddings shape: {embeddings.shape}")  # (50, 384)

    # ------------------------------------------------------------------
    # 8. Prepare ChromaDB payload
    # ------------------------------------------------------------------
    ids: list[str] = [log["id"] for log in logs]

    metadatas: list[Mapping[str, bool | float | int | str]] = [
        {
            "id": log["id"],
            "date": log["date"],
            "event_type": log["event_type"],
            "severity": log["severity"],
            "description": log["description"],
            "demand_impact_pct": log["demand_impact_pct"],
            "grid_region": log["grid_region"],
            "resolution_hours": log["resolution_hours"],
        }
        for log in logs
    ]

    # ------------------------------------------------------------------
    # 9. Single upsert call
    # ------------------------------------------------------------------
    logger.info("Upserting all records into ChromaDB …")
    collection.add(
        ids=ids,
        embeddings=embeddings.tolist(),
        documents=texts,       # rich embedding text stored as the document
        metadatas=metadatas,
    )

    # ------------------------------------------------------------------
    # 10. Verify
    # ------------------------------------------------------------------
    final_count = collection.count()
    logger.success(
        f"Index build complete. Collection '{COLLECTION_NAME}' contains "
        f"{final_count} documents."
    )


if __name__ == "__main__":
    build_index()
