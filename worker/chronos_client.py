"""Chronos forecasting clients."""
from __future__ import annotations

import os
import threading
import time
from abc import ABC, abstractmethod
from datetime import date
from typing import Any, ClassVar, Optional, Union

import httpx
import numpy as np
from loguru import logger
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

# Downstream consumers must only read p10, p50, p90 from ForecastResult.
# quantile_samples shape differs between LocalChronosClient and APIChronosClient.
# Never use quantile_samples in pipeline logic.
_SAFE_FORECAST_KEYS = ("p10", "p50", "p90")

ForecastResult = dict[str, Union[np.ndarray, list[Any]]]


class ChronosModelLoadingError(RuntimeError):
    """Raised when the Hugging Face serverless endpoint is still loading."""


def _log_retry_attempt(retry_state: Any) -> None:
    logger.info("Chronos API forecast attempt {}", retry_state.attempt_number)


def _validate_forecast_request(prediction_length: int, num_samples: int) -> None:
    if prediction_length <= 0:
        msg = "prediction_length must be greater than 0"
        raise ValueError(msg)
    if num_samples <= 0:
        msg = "num_samples must be greater than 0"
        raise ValueError(msg)


def _prepare_context(context_series: np.ndarray, context_limit: int) -> list[float]:
    context = np.asarray(context_series, dtype=np.float32).reshape(-1)
    if context.size == 0:
        msg = "context_series must contain at least one value"
        raise ValueError(msg)

    return context[-context_limit:].tolist()


def _forecast_result_from_samples(samples: np.ndarray) -> ForecastResult:
    return {
        "p10": np.percentile(samples, 10, axis=0),
        "p50": np.percentile(samples, 50, axis=0),
        "p90": np.percentile(samples, 90, axis=0),
        "quantile_samples": samples.tolist(),  # shape: (num_samples, prediction_length)
    }


class BaseChronosClient(ABC):
    """Abstract interface for Chronos forecast providers."""

    @abstractmethod
    def forecast(
        self,
        context_series: np.ndarray,
        prediction_length: int = 30,
        num_samples: int = 20,
    ) -> ForecastResult:
        """Return p10, p50, p90 as np.ndarray of shape (prediction_length,), 
        and quantile_samples as list whose shape differs by implementation.
        LocalChronosClient shape: (prediction_length, 3).
        APIChronosClient shape: (num_samples, prediction_length).
        """


class LocalChronosClient(BaseChronosClient):
    """Local Chronos client used by default."""

    def __init__(self, model_name: str = "amazon/chronos-t5-base") -> None:
        import torch

        self.device = 'cpu'
        self.pipeline = None
        self.model_name = model_name

    def forecast(
        self,
        context_series: np.ndarray,
        prediction_length: int = 30,
        num_samples: int = 20,
    ) -> ForecastResult:
        import torch

        if self.pipeline is None:
            from chronos import BaseChronosPipeline
            logger.info(f'Lazy loading Chronos model ({self.model_name})...')
            
            import os
            resolved_model_path = self.model_name
            # If path is a local directory but missing config.json, it's likely an AutoGluon wrapper.
            # Recursively search for the actual Hugging Face model directory.
            if os.path.isdir(resolved_model_path) and not os.path.exists(os.path.join(resolved_model_path, "config.json")):
                for root, _, files in os.walk(resolved_model_path):
                    if "config.json" in files:
                        resolved_model_path = root
                        logger.info(f"AutoGluon fine-tuned weights discovered at: {resolved_model_path}")
                        break

            try:
                self.pipeline = BaseChronosPipeline.from_pretrained(
                    resolved_model_path,
                    device_map=self.device,
                    torch_dtype=torch.float32,
                )
            except Exception as e:
                fallback = "amazon/chronos-t5-base"
                logger.warning(
                    f"Failed to load model '{resolved_model_path}': {e}. "
                    f"Falling back to '{fallback}'."
                )
                self.model_name = fallback
                self.pipeline = BaseChronosPipeline.from_pretrained(
                    fallback,
                    device_map=self.device,
                    torch_dtype=torch.float32,
                )

        if self.pipeline is None:
            raise RuntimeError("Chronos pipeline failed to load — both primary and fallback models failed.")

        _validate_forecast_request(prediction_length, num_samples)
        context = _prepare_context(context_series, context_limit=512)
        tensor = torch.tensor(context, dtype=torch.float32)

        quantiles, _ = self.pipeline.predict_quantiles(
            tensor,
            prediction_length=prediction_length,
            quantile_levels=[0.1, 0.5, 0.9],
        )
        quantile_array = quantiles.detach().cpu().numpy().squeeze(0)

        # Handle both (prediction_length, 3) and (3, prediction_length) shapes
        if quantile_array.shape == (prediction_length, 3):
            p10 = quantile_array[:, 0]
            p50 = quantile_array[:, 1]
            p90 = quantile_array[:, 2]
        elif quantile_array.shape == (3, prediction_length):
            p10 = quantile_array[0, :]
            p50 = quantile_array[1, :]
            p90 = quantile_array[2, :]
        else:
            msg = (
                "Chronos local response had unexpected quantile shape "
                f"{quantile_array.shape}; expected ({prediction_length}, 3) "
                f"or (3, {prediction_length})"
            )
            raise RuntimeError(msg)

        return {
            "p10": p10,
            "p50": p50,
            "p90": p90,
            "quantile_samples": quantile_array.tolist(),
        }


class APIChronosClient(BaseChronosClient):
    """HF API Chronos client with conservative quota guardrails."""

    _usage_lock: ClassVar[threading.Lock] = threading.Lock()
    _usage_day: ClassVar[Optional[date]] = None
    _requests_today: ClassVar[int] = 0
    _last_request_at: ClassVar[float] = 0.0

    def __init__(
        self,
        api_token: str,
        endpoint_url: str,
        daily_limit: int = 50,
        min_interval_seconds: float = 2.0,
    ) -> None:
        if daily_limit <= 0:
            msg = "daily_limit must be greater than 0 for API mode"
            raise ValueError(msg)
        if min_interval_seconds < 0:
            msg = "min_interval_seconds must be non-negative"
            raise ValueError(msg)

        self.api_token = api_token
        self.endpoint_url = endpoint_url
        self.daily_limit = daily_limit
        self.min_interval_seconds = min_interval_seconds
        logger.warning(
            "Chronos API mode enabled with daily request cap {} and minimum "
            "interval {}s",
            daily_limit,
            min_interval_seconds,
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=5, max=30),
        retry=retry_if_exception_type(
            (
                ChronosModelLoadingError,
                httpx.TimeoutException,
                httpx.TransportError,
            )
        ),
        reraise=True,
        before=_log_retry_attempt,
    )
    def forecast(
        self,
        context_series: np.ndarray,
        prediction_length: int = 30,
        num_samples: int = 20,
    ) -> ForecastResult:
        _validate_forecast_request(prediction_length, num_samples)
        context_list = _prepare_context(context_series, context_limit=200)
        payload = {
            "inputs": [context_list],
            "parameters": {
                "prediction_length": prediction_length,
                "num_samples": num_samples,
            },
        }
        headers = {"Authorization": f"Bearer {self.api_token}"}

        self._enforce_usage_limits()
        response = httpx.post(
            self.endpoint_url,
            headers=headers,
            json=payload,
            timeout=120,
        )

        if response.status_code == 503:
            logger.warning(
                "Chronos model is loading on Hugging Face serverless; retrying"
            )
            raise ChronosModelLoadingError(
                "Chronos model is loading on Hugging Face serverless"
            )

        response.raise_for_status()
        samples = self._parse_response(
            response.json(),
            prediction_length=prediction_length,
            num_samples=num_samples,
        )
        return _forecast_result_from_samples(samples)

    def _enforce_usage_limits(self) -> None:
        with self._usage_lock:
            today = date.today()
            if self._usage_day != today:
                self.__class__._usage_day = today
                self.__class__._requests_today = 0

            if self._requests_today >= self.daily_limit:
                msg = (
                    "Chronos API daily request cap reached "
                    f"({self.daily_limit}). Use local mode or raise "
                    "CHRONOS_API_DAILY_LIMIT intentionally."
                )
                raise RuntimeError(msg)

            elapsed = time.monotonic() - self._last_request_at
            wait_seconds = self.min_interval_seconds - elapsed
            if wait_seconds > 0:
                logger.info(
                    "Waiting {:.2f}s before Chronos API request to respect "
                    "local rate guardrail",
                    wait_seconds,
                )
                time.sleep(wait_seconds)

            self.__class__._requests_today += 1
            self.__class__._last_request_at = time.monotonic()
            logger.info(
                "Chronos API request {}/{} for {}",
                self._requests_today,
                self.daily_limit,
                today.isoformat(),
            )

    def _parse_response(
        self,
        data: Any,
        prediction_length: int,
        num_samples: int,
    ) -> np.ndarray:
        try:
            samples = np.asarray(data, dtype=np.float32)
            if samples.ndim == 3 and samples.shape[0] == 1:
                samples = samples.squeeze(0)
            samples = samples.reshape(num_samples, prediction_length)
        except (TypeError, ValueError) as exc:
            msg = (
                "Failed to parse Chronos response as nested forecast samples "
                f"with shape ({num_samples}, {prediction_length})"
            )
            raise RuntimeError(msg) from exc

        return samples


class ChronosClient(APIChronosClient):
    """Backward-compatible name for the guarded HF API client."""


def get_chronos_client() -> BaseChronosClient:
    """Create the configured Chronos client. Local mode is the default."""
    # Do NOT call load_dotenv() here — in production, HF Spaces injects secrets
    # as env vars. The .env file may contain stale local-dev paths that break
    # model loading inside Docker.
    
    mode = os.getenv("CHRONOS_MODE", "local").strip().lower()
    logger.info("Chronos mode active: {}", mode)

    if mode == "local":
        model_name = os.getenv("CHRONOS_MODEL_NAME", "amazon/chronos-t5-base")
        logger.info("Chronos model name resolved to: {}", model_name)
        return LocalChronosClient(model_name=model_name)

    if mode == "api":
        api_token = os.getenv("HUGGINGFACE_API_TOKEN")
        endpoint_url = os.getenv("CHRONOS_ENDPOINT_URL")
        if not api_token or not endpoint_url:
            msg = (
                "HUGGINGFACE_API_TOKEN and CHRONOS_ENDPOINT_URL are required "
                "when CHRONOS_MODE=api"
            )
            raise ValueError(msg)

        daily_limit = int(os.getenv("CHRONOS_API_DAILY_LIMIT", "50"))
        min_interval_seconds = float(
            os.getenv("CHRONOS_API_MIN_INTERVAL_SECONDS", "2")
        )
        return APIChronosClient(
            api_token=api_token,
            endpoint_url=endpoint_url,
            daily_limit=daily_limit,
            min_interval_seconds=min_interval_seconds,
        )

    msg = f"Unsupported CHRONOS_MODE: {mode}"
    raise ValueError(msg)
