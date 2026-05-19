# agents/state.py
from typing import TypedDict, Annotated
import operator


def merge_lists(a: list, b: list) -> list:
    """Reducer that merges two lists — used for parallel node outputs."""
    return a + b


class GridOpsState(TypedDict):
    # === Input ===
    dataset_path: str
    seasonality_regime: str          # WINTER / SUMMER / SHOULDER

    # === Data Quality ===
    data_quality_valid: bool
    data_quality_issues: list[str]
    data_stats: dict                 # mean, std, min, max, total_days

    # === Model Outputs ===
    sarima_forecast: list            # 30-day array as list
    sarima_wape: float
    sarima_backtest_wape: float      # rolling backtest mean WAPE
    backtest_wape: float             # UI alias for SARIMA rolling backtest WAPE
    chronos_p10: list
    chronos_p50: list
    chronos_p90: list
    chronos_wape: float
    interval_sharpness: float        # novel metric: tightness of confidence band
    historical_data: list            # last N days for plotting
    holdout_data: list               # 30-day actual holdout values for comparison
    holdout_dates: list              # ISO date strings for holdout actuals
    forecast_dates: list             # ISO date strings for x-axis

    # === Analysis (populated by parallel nodes) ===
    # Annotated with merge_lists reducer so parallel writes accumulate
    analysis_findings: Annotated[list[str], merge_lists]

    # === Divergence Analysis ===
    variance_magnitude_pct: float    # how much models diverge, in %
    divergence_direction: str        # CHRONOS_HIGHER / CHRONOS_LOWER / ALIGNED
    anomaly_severity_score: float    # 0.0 – 1.0, drives the risk gate

    # === Seasonality Analysis ===
    seasonal_demand_pattern: str     # descriptive summary
    seasonal_risk_factor: str        # e.g. "Heat dome probability elevated"

    # === RAG Context ===
    retrieved_events: list[dict]
    rag_query_used: str

    # === Risk Metrics ===
    downside_var_mw: float           # Value-at-Risk: p10 vs median gap
    upside_var_mw: float             # p90 vs median gap
    risk_reward_ratio: float         # upside_var / downside_var

    # === Final Agent Outputs ===
    variance_report: str             # full text report from divergence node
    trading_mandate: dict            # structured JSON: recommendation, confidence, etc.
    mandate_narrative: str           # human-readable summary

    # === Metadata ===
    graph_execution_trace: Annotated[list[str], merge_lists] # which nodes fired, in order
    pipeline_start_ts: str
    pipeline_end_ts: str
