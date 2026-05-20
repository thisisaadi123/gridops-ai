"""Unit tests for the EnergyDataPipeline."""

import numpy as np
import pandas as pd
import pytest

from worker.data_pipeline import EnergyDataPipeline


# ------------------------------------------------------------------
# Data loading
# ------------------------------------------------------------------

def test_load_produces_series(test_pipeline: EnergyDataPipeline):
    """daily_series should be a pd.Series with well over 100 daily rows."""
    assert isinstance(test_pipeline.daily_series, pd.Series)
    assert len(test_pipeline.daily_series) > 100


# ------------------------------------------------------------------
# Train / holdout split
# ------------------------------------------------------------------

def test_holdout_split_exact_length(test_pipeline: EnergyDataPipeline):
    """Default 30-day holdout must contain exactly 30 rows."""
    test_pipeline.split_holdout(n_days=30)
    assert test_pipeline.holdout is not None
    assert len(test_pipeline.holdout) == 30


def test_no_overlap_in_split(test_pipeline: EnergyDataPipeline):
    """Last training date must be strictly before the first holdout date."""
    test_pipeline.split_holdout(n_days=30)
    assert test_pipeline.train is not None
    assert test_pipeline.holdout is not None
    assert test_pipeline.train.index[-1] < test_pipeline.holdout.index[0]


# ------------------------------------------------------------------
# Data-quality validation
# ------------------------------------------------------------------

def test_validate_passes_on_good_data(test_pipeline: EnergyDataPipeline):
    """Synthetic data is clean — validation should pass with no issues."""
    result = test_pipeline.validate_data_quality()
    assert result["is_valid"] is True
    assert result["issues"] == []


# ------------------------------------------------------------------
# WAPE metric
# ------------------------------------------------------------------

def test_wape_perfect():
    """Identical arrays should produce a WAPE of exactly 0.0."""
    arr = np.array([100.0, 200.0, 300.0])
    assert EnergyDataPipeline.calculate_wape(arr, arr) == 0.0


def test_wape_known():
    """Hand-computed WAPE for a simple two-element example.

    actual   = [100, 200]
    forecast = [110, 190]
    Σ|a − f| = |−10| + |10| = 20
    Σ|a|     = 100 + 200     = 300
    WAPE     = 20 / 300      ≈ 0.0667
    """
    actual = np.array([100.0, 200.0])
    forecast = np.array([110.0, 190.0])
    expected_wape = round(20.0 / 300.0, 4)  # 0.0667
    assert EnergyDataPipeline.calculate_wape(actual, forecast) == expected_wape


# ------------------------------------------------------------------
# Seasonality detection
# ------------------------------------------------------------------

def test_seasonality_regime_returns_valid(test_pipeline: EnergyDataPipeline):
    """Regime must be one of the three recognised labels."""
    test_pipeline.split_holdout(n_days=30)
    regime = test_pipeline.detect_seasonality_regime()
    assert regime in {"WINTER", "SUMMER", "SHOULDER"}


# ------------------------------------------------------------------
# SARIMA forecasting
# ------------------------------------------------------------------

def test_sarima_forecast_shape(test_pipeline: EnergyDataPipeline):
    """A 30-step SARIMA forecast should return an ndarray of shape (30,)."""
    test_pipeline.split_holdout(n_days=30)
    test_pipeline.fit_sarima()
    forecast = test_pipeline.forecast_sarima(steps=30)
    assert isinstance(forecast, np.ndarray)
    assert forecast.shape == (30,)


# ------------------------------------------------------------------
# Rolling back-test
# ------------------------------------------------------------------

def test_rolling_backtest_structure(test_pipeline: EnergyDataPipeline):
    """Back-test result must contain a list of 3 float WAPEs and a mean."""
    test_pipeline.split_holdout(n_days=30)
    result = test_pipeline.rolling_backtest(window=30, n_windows=3)

    assert isinstance(result, dict)
    assert "window_wapes" in result
    assert "mean_wape" in result

    assert isinstance(result["window_wapes"], list)
    assert len(result["window_wapes"]) == 3
    assert all(isinstance(w, float) for w in result["window_wapes"])
