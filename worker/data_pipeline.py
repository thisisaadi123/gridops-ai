"""
Energy Data Pipeline
====================
Handles loading, preprocessing, validation, and SARIMA-based forecasting
for PJM hourly energy load data.
"""

import warnings
from typing import Optional

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX


class EnergyDataPipeline:
    """End-to-end pipeline for energy load time-series analysis and forecasting.

    Loads PJM hourly energy data, resamples to daily median MW,
    validates quality, fits a SARIMA model, and produces forecasts
    with rolling back-test evaluation.

    Attributes:
        csv_path:            Path to the source CSV file.
        daily_series:        Daily median MW load (pd.Series, DatetimeIndex).
        data_stats:          Descriptive statistics computed during preprocessing.
        train:               Training portion of the daily series.
        holdout:             Holdout portion of the daily series.
        seasonality_regime:  One of 'WINTER', 'SUMMER', or 'SHOULDER'.
        sarima_model:        Fitted SARIMAX results object.
    """

    def __init__(self, csv_path: str) -> None:
        """Initialise the pipeline with a path to the PJM CSV.

        Args:
            csv_path: Absolute or relative path to the CSV file containing
                      at least 'Datetime' and 'PJM_Load' columns.
        """
        self.csv_path: str = csv_path

        # Populated by load_and_preprocess()
        self.daily_series: Optional[pd.Series] = None
        self.data_stats: Optional[dict] = None

        # Populated by split_holdout()
        self.train: Optional[pd.Series] = None
        self.holdout: Optional[pd.Series] = None

        # Populated by detect_seasonality_regime()
        self.seasonality_regime: Optional[str] = None

        # Populated by fit_sarima()
        self.sarima_model = None

    # ------------------------------------------------------------------
    # Data ingestion & preprocessing
    # ------------------------------------------------------------------

    def load_and_preprocess(self) -> None:
        """Load the CSV, clean, resample to daily median MW, and compute stats.

        Steps:
            1. Parse 'Datetime' column as DatetimeIndex.
            2. Sort ascending by datetime.
            3. Record the percentage of originally missing values.
            4. Forward-fill any NaN values.
            5. Resample to daily frequency using the **median** of MW load.
            6. Store the result as ``self.daily_series``.
            7. Compute and store ``self.data_stats``.
        """
        df = pd.read_csv(self.csv_path, parse_dates=["Datetime"])
        df = df.set_index("Datetime").sort_index()

        # Use PJME as the target MW column
        load_series: pd.Series = df["PJME"]

        # Drop structural missing data (1998-2001) before forward-fill
        # so we don't fabricate fake data
        load_series = load_series.dropna()

        # Forward-fill any sporadic single gaps within the real range
        load_series = load_series.ffill()

        # Resample to daily median MW
        self.daily_series = load_series.resample("D").median()
        self.daily_series.name = "PJME"

        # Missing percentage at the daily level (what the model actually trains on)
        missing_pct = float(self.daily_series.isnull().mean() * 100)

        # Compute descriptive statistics
        self.data_stats = {
            "total_days": len(self.daily_series),
            "mean_load": round(float(self.daily_series.mean()), 4),
            "std_load": round(float(self.daily_series.std()), 4),
            "min_load": round(float(self.daily_series.min()), 4),
            "max_load": round(float(self.daily_series.max()), 4),
            "missing_pct": missing_pct,
        }

    # ------------------------------------------------------------------
    # Quality checks
    # ------------------------------------------------------------------

    def validate_data_quality(self) -> dict:
        """Run a suite of quality checks on the daily series.

        Checks performed:
            * At least 365 days of data.
            * No more than 5 % missing (from original hourly data).
            * No negative load values.
            * Series is not constant (std > 0).

        Returns:
            dict with keys ``is_valid`` (bool) and ``issues`` (list[str]).
        """
        issues: list[str] = []

        if self.daily_series is None or self.data_stats is None:
            return {"is_valid": False, "issues": ["Pipeline not initialised – call load_and_preprocess() first."]}

        if self.data_stats["total_days"] < 365:
            issues.append(
                f"Insufficient data: only {self.data_stats['total_days']} days available (minimum 365 required)."
            )

        missing_pct = float(self.daily_series.isnull().mean() * 100)
        if missing_pct > 5:
            issues.append(f"Too many gaps: {missing_pct}% missing (max 5%)")

        if (self.daily_series < 0).any():
            neg_count = int((self.daily_series < 0).sum())
            issues.append(
                f"Negative load values detected: {neg_count} days with negative MW readings."
            )

        if self.daily_series.std() == 0:
            issues.append("Constant series detected: load values show zero variance.")

        return {"is_valid": len(issues) == 0, "issues": issues}

    # ------------------------------------------------------------------
    # Train / holdout split
    # ------------------------------------------------------------------

    def split_holdout(self, n_days: int = 30) -> None:
        """Split the daily series into training and holdout sets chronologically.

        Args:
            n_days: Number of trailing days to reserve for the holdout set.
        """
        if self.daily_series is None:
            raise ValueError("Daily series not available – call load_and_preprocess() first.")

        self.train = self.daily_series.iloc[:-n_days]
        self.holdout = self.daily_series.iloc[-n_days:]

    # ------------------------------------------------------------------
    # Seasonality detection
    # ------------------------------------------------------------------

    def detect_seasonality_regime(self) -> str:
        """Determine the seasonal regime based on the last date in the training set.

        Returns:
            'WINTER' if the month is Dec–Feb,
            'SUMMER' if the month is Jun–Aug,
            'SHOULDER' for all other months.
        """
        if self.train is None:
            raise ValueError("Training set not available – call split_holdout() first.")

        last_month: int = self.train.index[-1].month

        if last_month in (12, 1, 2):
            self.seasonality_regime = "WINTER"
        elif last_month in (6, 7, 8):
            self.seasonality_regime = "SUMMER"
        else:
            self.seasonality_regime = "SHOULDER"

        return self.seasonality_regime

    # ------------------------------------------------------------------
    # SARIMA modelling
    # ------------------------------------------------------------------

    def fit_sarima(self) -> None:
        """Fit a SARIMA(1,1,1)(1,1,1,7) model on the training series.

        Convergence warnings from statsmodels are suppressed to keep
        pipeline output clean.
        """
        if self.train is None:
            raise ValueError("Training set not available – call split_holdout() first.")

        warnings.filterwarnings("ignore")

        model = SARIMAX(
            self.train,
            order=(1, 1, 1),
            seasonal_order=(1, 1, 1, 7),
            enforce_stationarity=False,
            enforce_invertibility=False,
        )
        self.sarima_model = model.fit(disp=False)

        warnings.filterwarnings("default")

    def forecast_sarima(self) -> np.ndarray:
        """Produce a 30-step ahead forecast from the fitted SARIMA model.

        Returns:
            np.ndarray of length 30 with forecasted daily MW values.
        """
        if self.sarima_model is None:
            raise ValueError("SARIMA model not fitted – call fit_sarima() first.")

        forecast = self.sarima_model.forecast(steps=30)
        return np.array(forecast)

    # ------------------------------------------------------------------
    # Rolling back-test
    # ------------------------------------------------------------------

    def rolling_backtest(self, window: int = 30, n_windows: int = 3) -> dict:
        """Evaluate SARIMA accuracy across multiple holdout windows.

        Runs SARIMA(1,1,1)(1,1,1,7) on ``n_windows`` different 30-day
        holdout periods, spaced 90 days apart from the end of training data.
        This provides a more robust accuracy estimate than a single holdout.

        Args:
            window:    Number of days in each holdout window.
            n_windows: Number of evaluation windows.

        Returns:
            dict with ``window_wapes`` (list[float]) and ``mean_wape`` (float).
        """
        if self.train is None:
            raise ValueError("Training set not available – call split_holdout() first.")

        window_wapes: list[float] = []

        for i in range(n_windows):
            # Offset from the end of training data: 0, 90, 180, …
            offset = i * 90

            # Define the holdout slice boundaries
            holdout_end = len(self.train) - offset
            holdout_start = holdout_end - window

            if holdout_start < 0 or holdout_end <= 0:
                break

            bt_holdout = self.train.iloc[holdout_start:holdout_end]
            bt_train = self.train.iloc[:holdout_start]

            if len(bt_train) < window:
                break

            warnings.filterwarnings("ignore")
            try:
                model = SARIMAX(
                    bt_train,
                    order=(1, 1, 1),
                    seasonal_order=(1, 1, 1, 7),
                    enforce_stationarity=False,
                    enforce_invertibility=False,
                )
                fitted = model.fit(disp=False)
                fc = fitted.forecast(steps=window)
                wape = self.calculate_wape(np.array(bt_holdout), np.array(fc))
                window_wapes.append(wape)
            finally:
                warnings.filterwarnings("default")

        mean_wape = round(float(np.mean(window_wapes)), 4) if window_wapes else 0.0

        return {"window_wapes": window_wapes, "mean_wape": mean_wape}

    # ------------------------------------------------------------------
    # Evaluation metrics
    # ------------------------------------------------------------------

    @staticmethod
    def calculate_wape(actual: np.ndarray, forecast: np.ndarray) -> float:
        """Compute the Weighted Absolute Percentage Error (WAPE).

        WAPE = Σ|actual − forecast| / Σ|actual|

        Args:
            actual:   Array of observed values.
            forecast: Array of predicted values (same length as *actual*).

        Returns:
            WAPE as a float rounded to 4 decimal places.
        """
        return round(float(np.sum(np.abs(actual - forecast)) / np.sum(np.abs(actual))), 4)

    @staticmethod
    def calculate_interval_sharpness(p10: np.ndarray, p90: np.ndarray) -> float:
        """Compute prediction interval sharpness.

        Sharpness = 1 / mean(p90 − p10).
        Higher values indicate tighter (better-calibrated) intervals.

        Args:
            p10: Array of 10th-percentile forecasts.
            p90: Array of 90th-percentile forecasts.

        Returns:
            Sharpness as a float rounded to 4 decimal places.
        """
        return round(float(1.0 / np.mean(p90 - p10)), 4)

    # ------------------------------------------------------------------
    # Dunder helpers
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        days = self.data_stats["total_days"] if self.data_stats else "N/A"
        regime = self.seasonality_regime or "not detected"
        fitted = self.sarima_model is not None
        return (
            f"EnergyDataPipeline(csv='{self.csv_path}', "
            f"days={days}, regime='{regime}', sarima_fitted={fitted})"
        )
