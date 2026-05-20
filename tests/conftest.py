"""Shared pytest fixtures for GridOps test suite."""

from __future__ import annotations

from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from api.config import Settings
from worker.data_pipeline import EnergyDataPipeline


# ------------------------------------------------------------------
# 1. Synthetic hourly CSV  (5 years, sin-wave ≈ 100 000 MW + noise)
# ------------------------------------------------------------------

@pytest.fixture()
def sample_csv_path(tmp_path):
    """Create a temporary CSV with 5 years of synthetic hourly PJM-like data.

    The load profile is a sinusoidal curve centred at 100 000 MW with a
    period of 365.25 days (annual seasonality) plus Gaussian noise.
    Columns written: ``Datetime``, ``PJME``.

    Returns:
        pathlib.Path: Path to the generated CSV file.
    """
    rng = np.random.default_rng(42)

    # 5 years of hourly timestamps
    start = pd.Timestamp("2017-01-01")
    end = pd.Timestamp("2021-12-31 23:00:00")
    datetimes = pd.date_range(start, end, freq="h")

    n = len(datetimes)

    # Annual sin-wave (peak in summer, trough in winter) around 100 000 MW
    hours_in_year = 365.25 * 24
    seasonal = 15_000 * np.sin(2 * np.pi * np.arange(n) / hours_in_year)

    # Gaussian noise (σ ≈ 3 000 MW)
    noise = rng.normal(loc=0, scale=3_000, size=n)

    load = 100_000 + seasonal + noise

    df = pd.DataFrame({"Datetime": datetimes, "PJME": load})
    csv_file = tmp_path / "pjm_hourly_est.csv"
    df.to_csv(csv_file, index=False)

    return csv_file


# ------------------------------------------------------------------
# 2. Mock Settings  (dummy keys for every required field)
# ------------------------------------------------------------------

@pytest.fixture()
def mock_settings():
    """Patch ``api.config.get_settings`` to return a Settings object with
    dummy / placeholder values so tests never depend on a real ``.env`` file.

    Yields:
        Settings: The mock settings instance.
    """
    dummy = Settings(
        grok_api_key="test-grok-key",
        huggingface_api_token="hf-test-token",
        redis_url="redis://localhost:6379/0",
        celery_broker_url="redis://localhost:6379/0",
        celery_result_backend="redis://localhost:6379/1",
        environment="testing",
        log_level="DEBUG",
        chronos_endpoint="https://test.example.com/chronos",
        groq_api_key="test-groq-key",
        groq_base_url="https://test.example.com/groq",
        groq_model="test-model",
        task_result_expires=60,
        worker_concurrency=1,
    )

    with patch("api.config.get_settings", return_value=dummy):
        yield dummy


# ------------------------------------------------------------------
# 3. Pre-processed pipeline instance
# ------------------------------------------------------------------

@pytest.fixture()
def test_pipeline(sample_csv_path):
    """Return an ``EnergyDataPipeline`` that has already been loaded and
    preprocessed against the synthetic CSV.

    The fixture guarantees that ``daily_series`` and ``data_stats`` are
    populated, so downstream tests can immediately call validation,
    splitting, or fitting methods.

    Returns:
        EnergyDataPipeline: Preprocessed pipeline instance.
    """
    pipeline = EnergyDataPipeline(csv_path=str(sample_csv_path))
    pipeline.load_and_preprocess()
    return pipeline
