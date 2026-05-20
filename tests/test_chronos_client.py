"""Unit tests for the APIChronosClient (HF inference endpoint)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from worker.chronos_client import APIChronosClient


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _make_client() -> APIChronosClient:
    """Return an APIChronosClient with guardrails relaxed for testing."""
    return APIChronosClient(
        api_token="test-token",
        endpoint_url="https://test.example.com/chronos",
        daily_limit=100,
        min_interval_seconds=0,  # no throttling in tests
    )


def _mock_response(status_code: int = 200, json_data=None) -> MagicMock:
    """Build a fake httpx.Response with the given status code and JSON body."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    resp.raise_for_status = MagicMock()
    return resp


def _valid_samples(num_samples: int = 20, prediction_length: int = 30) -> list:
    """Generate a nested list mimicking the HF API response shape.

    Shape: (1, num_samples, prediction_length)  — squeezed to
    (num_samples, prediction_length) inside _parse_response.
    """
    rng = np.random.default_rng(0)
    return rng.normal(100_000, 3_000, (1, num_samples, prediction_length)).tolist()


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

def test_successful_forecast_returns_three_arrays(mocker):
    """A valid 200 response should yield p10, p50, p90 as numpy arrays of
    length ``prediction_length``."""
    client = _make_client()

    mock_post = mocker.patch(
        "worker.chronos_client.httpx.post",
        return_value=_mock_response(200, _valid_samples(20, 30)),
    )

    result = client.forecast(
        context_series=np.ones(300),
        prediction_length=30,
        num_samples=20,
    )

    for key in ("p10", "p50", "p90"):
        assert key in result, f"Missing key: {key}"
        arr = result[key]
        assert isinstance(arr, np.ndarray)
        assert arr.shape == (30,)

    mock_post.assert_called_once()


def test_context_truncated_to_200(mocker):
    """Regardless of input length, the payload should send at most 200
    context values (the APIChronosClient context_limit)."""
    client = _make_client()

    mock_post = mocker.patch(
        "worker.chronos_client.httpx.post",
        return_value=_mock_response(200, _valid_samples(20, 30)),
    )

    # Feed 500 values — only the last 200 should reach the API
    client.forecast(
        context_series=np.arange(500, dtype=np.float32),
        prediction_length=30,
        num_samples=20,
    )

    # Extract the JSON payload sent to httpx.post
    _, kwargs = mock_post.call_args
    payload_inputs = kwargs["json"]["inputs"][0]
    assert len(payload_inputs) <= 200


def test_503_triggers_retry(mocker):
    """A 503 on the first call should trigger a retry; the second 200
    response should succeed."""
    client = _make_client()

    resp_503 = _mock_response(503)
    resp_200 = _mock_response(200, _valid_samples(20, 30))

    mock_post = mocker.patch(
        "worker.chronos_client.httpx.post",
        side_effect=[resp_503, resp_200],
    )

    # Patch tenacity wait so tests don't actually sleep
    mocker.patch(
        "worker.chronos_client.time.sleep",
    )

    result = client.forecast(
        context_series=np.ones(300),
        prediction_length=30,
        num_samples=20,
    )

    # Two calls: first 503, second 200
    assert mock_post.call_count == 2

    # Final result should still be valid
    for key in ("p10", "p50", "p90"):
        assert key in result, f"Missing key: {key}"
        arr = result[key]
        assert isinstance(arr, np.ndarray)
        assert arr.shape == (30,)
