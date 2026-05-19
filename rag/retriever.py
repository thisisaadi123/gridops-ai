"""
rag/retriever.py
----------------
Semantic retrieval over the ChromaDB grid_events collection.

Usage:
    from rag.retriever import GridEventRetriever

    retriever = GridEventRetriever()
    results = retriever.retrieve("polar vortex heating demand spike", n_results=3)
    results = retriever.retrieve("hurricane", severity_filter="CRITICAL")
"""

from pathlib import Path

import chromadb
import torch
from loguru import logger
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# Shared constants (mirror build_index.py — single source of truth in practice
# you'd import these from a shared config module)
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent          # gridops-ai/
CHROMA_PATH = ROOT / "data_store" / "chroma_db"
COLLECTION_NAME = "grid_events"
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


class GridEventRetriever:
    """Semantic retriever for PJM grid event logs stored in ChromaDB."""

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------
    def __init__(self) -> None:
        # Device selection
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        logger.info(f"GridEventRetriever — using device: '{device}'")

        # Embedding model
        logger.info(f"Loading embedding model '{MODEL_NAME}' …")
        self._model = SentenceTransformer(MODEL_NAME, device=device)
        logger.info("Embedding model ready.")

        # ChromaDB
        logger.info(f"Connecting to ChromaDB at: {CHROMA_PATH}")
        self._client = chromadb.PersistentClient(path=str(CHROMA_PATH))
        self._collection = self._client.get_collection(name=COLLECTION_NAME)
        logger.info(
            f"Connected to collection '{COLLECTION_NAME}' "
            f"({self._collection.count()} documents)."
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def retrieve(
        self,
        query: str,
        n_results: int = 3,
        severity_filter: str | None = None,
    ) -> list[dict]:
        """
        Embed *query* and return the *n_results* most similar grid events.

        Parameters
        ----------
        query:
            Natural-language search string.
        n_results:
            Number of results to return (default 3).
        severity_filter:
            Optional exact-match filter on the ``severity`` field.
            Accepted values: ``'LOW'``, ``'MEDIUM'``, ``'HIGH'``, ``'CRITICAL'``.

        Returns
        -------
        list[dict]
            Each dict is the event's metadata enriched with a
            ``similarity_score`` key (float, 0–1; higher = more similar).
            Sorted by ``similarity_score`` descending.
        """
        # 1. Embed the query
        query_embedding: list[float] = (
            self._model.encode(
                query,
                normalize_embeddings=True,
                convert_to_numpy=True,
            )
            .tolist()
        )
        logger.debug(f"Query embedded: '{query[:80]}{'…' if len(query) > 80 else ''}'")

        # 2. Build optional where clause
        where: dict | None = None
        if severity_filter is not None:
            severity_upper = severity_filter.upper()
            where = {"severity": {"$eq": severity_upper}}
            logger.debug(f"Applying severity filter: severity == '{severity_upper}'")

        # 3. Query ChromaDB
        query_kwargs: dict = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
            "include": ["metadatas", "distances", "documents"],
        }
        if where is not None:
            query_kwargs["where"] = where

        raw = self._collection.query(**query_kwargs)

        # 4. Unpack and enrich results
        # ChromaDB returns lists-of-lists (one sub-list per query embedding).
        metadatas: list[dict] = raw["metadatas"][0]
        distances: list[float] = raw["distances"][0]

        results: list[dict] = []
        for meta, dist in zip(metadatas, distances):
            record = dict(meta)                        # shallow copy
            record["similarity_score"] = round(1.0 - dist, 6)
            results.append(record)

        # 5. Sort descending by similarity_score
        results.sort(key=lambda r: r["similarity_score"], reverse=True)

        logger.info(
            f"retrieve('{query[:50]}…', n={n_results}, severity={severity_filter}) "
            f"→ {len(results)} result(s)."
        )
        return results

    # ------------------------------------------------------------------
    def get_stats(self) -> dict:
        """
        Return basic statistics about the connected collection.

        Returns
        -------
        dict
            ``{'total_docs': int, 'collection_name': str}``
        """
        return {
            "total_docs": self._collection.count(),
            "collection_name": COLLECTION_NAME,
        }


# ---------------------------------------------------------------------------
# Quick smoke-test
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import json

    retriever = GridEventRetriever()

    print("\n=== Stats ===")
    print(json.dumps(retriever.get_stats(), indent=2))

    print("\n=== Top-3: 'polar vortex heating demand' ===")
    for r in retriever.retrieve("polar vortex heating demand", n_results=3):
        print(
            f"  [{r['similarity_score']:.4f}] {r['id']} | "
            f"{r['event_type']} | {r['severity']} | {r['grid_region']}"
        )

    print("\n=== Top-3 CRITICAL events: 'hurricane storm surge flooding' ===")
    for r in retriever.retrieve(
        "hurricane storm surge flooding", n_results=3, severity_filter="CRITICAL"
    ):
        print(
            f"  [{r['similarity_score']:.4f}] {r['id']} | "
            f"{r['event_type']} | {r['severity']} | {r['grid_region']}"
        )
