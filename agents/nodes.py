# agents/nodes.py
import json
import numpy as np
from datetime import datetime
from loguru import logger
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

from agents.state import GridOpsState
from agents.prompts import (
    SEASONALITY_SYSTEM, SEASONALITY_HUMAN,
    STRATEGY_SYSTEM, STRATEGY_HUMAN,
    CONSERVATIVE_ADVISORY_SYSTEM, CONSERVATIVE_ADVISORY_HUMAN,
)
from rag.retriever import GridEventRetriever
from api.config import get_settings


def _get_llm() -> ChatOpenAI:
    """Initialize LLM via Groq's OpenAI-compatible interface."""
    settings = get_settings()
    return ChatOpenAI(
        model=settings.groq_model,
        base_url=settings.groq_base_url,
        api_key=settings.groq_api_key,
        openai_api_key=settings.groq_api_key,
        temperature=0.2,
        max_tokens=4096,
    )


# ─────────────────────────────────────────────
# NODE 1: Data Quality Validator
# ─────────────────────────────────────────────
def validate_data_node(state: GridOpsState) -> dict:
    """
    Gate node — validates data quality before wasting API calls.
    Sets data_quality_valid. If False, downstream nodes should short-circuit.
    This pattern (validate before expensive ops) is standard in production ML.
    """
    logger.info("NODE 1 | Data Validator | Starting")

    stats = state.get("data_stats", {})
    issues = []

    # Check minimum data volume
    if stats.get("total_days", 0) < 365:
        issues.append(f"Insufficient history: {stats.get('total_days', 0)} days (need ≥365)")

    # Check data variance (constant series is useless)
    if stats.get("std_load", 0) < 100:
        issues.append("Series has near-zero variance — data may be corrupted")

    # Check for unrealistic values
    if stats.get("min_load", 0) < 0:
        issues.append("Negative load values detected — preprocessing error")

    if stats.get("mean_load", 0) < 1000:
        issues.append(f"Mean load {stats.get('mean_load', 0):.0f} MW is implausibly low")

    if issues:
        logger.warning(f"NODE 1 | Data quality FAILED: {issues}")
    else:
        logger.info(f"NODE 1 | Data quality PASSED | {stats.get('total_days', 0)} days, "
                    f"mean {stats.get('mean_load', 0):,.0f} MW")

    return {
        "data_quality_valid": len(issues) == 0,
        "data_quality_issues": issues,
        "graph_execution_trace": ["validate_data_node"],
    }


# ─────────────────────────────────────────────
# NODE 2A: Model Divergence Analyst (Parallel Branch A)
# ─────────────────────────────────────────────
def divergence_analyst_node(state: GridOpsState) -> dict:
    """
    Quantifies the divergence between SARIMA and Chronos forecasts.
    Computes anomaly_severity_score — the key signal for the risk gate.
    Runs in PARALLEL with seasonality_detector_node.
    """
    logger.info("NODE 2A | Divergence Analyst | Starting")

    sarima = np.array(state["sarima_forecast"])
    chronos = np.array(state["chronos_p50"])

    # Compute directional variance
    mean_variance_pct = float(np.mean((chronos - sarima) / (sarima + 1e-8)) * 100)
    abs_variance_pct = float(np.mean(np.abs(chronos - sarima) / (sarima + 1e-8)) * 100)
    sarima_mean_mw = float(np.mean(sarima))
    chronos_mean_mw = float(np.mean(chronos))

    direction = (
        "CHRONOS_HIGHER" if mean_variance_pct > 2
        else "CHRONOS_LOWER" if mean_variance_pct < -2
        else "ALIGNED"
    )

    # Anomaly severity score (0.0 to 1.0):
    # Combines three signals — model divergence, WAPE improvement, and band width
    wape_delta = max(0, (state.get("sarima_wape") or 0) - (state.get("chronos_wape") or 0))  # higher = Chronos is better
    wape_signal = min(wape_delta / 0.03, 1.0)                          # 3% delta = max signal

    divergence_signal = min(abs_variance_pct / 6.0, 1.0)               # >6% divergence = max signal

    sharpness = state.get("interval_sharpness") or 0
    sharpness_signal = min(sharpness / 0.001, 1.0)                     # normalize

    anomaly_severity_score = (
        0.4 * divergence_signal +
        0.35 * wape_signal +
        0.25 * sharpness_signal
    )

    # Build a structured text report
    variance_report = (
        f"DIVERGENCE ANALYSIS REPORT\n"
        f"==========================\n"
        f"Direction: {direction} | Magnitude: {abs_variance_pct:.2f}%\n"
        f"SARIMA Avg MW: {sarima_mean_mw:.1f} | Chronos Avg MW: {chronos_mean_mw:.1f}\n"
        f"SARIMA WAPE: {state['sarima_wape']:.4f} | "
        f"Chronos WAPE: {state['chronos_wape']:.4f} | "
        f"Delta: {wape_delta:.4f} ({'Chronos wins' if wape_delta > 0 else 'SARIMA wins'})\n"
        f"SARIMA Rolling Backtest WAPE: {state.get('sarima_backtest_wape', 0):.4f}\n"
        f"Interval Sharpness Score: {state.get('interval_sharpness', 0):.6f}\n"
        f"Anomaly Severity Score: {anomaly_severity_score:.4f} / 1.0\n"
        f"\nInterpretation: {'High divergence signals a structural regime shift ' if anomaly_severity_score > 0.6 else 'Models are in reasonable agreement — '}"
        f"{'suggesting the statistical baseline is missing a key driver.' if anomaly_severity_score > 0.6 else 'standard forecast uncertainty applies.'}"
    )

    logger.info(f"NODE 2A | Divergence: {direction} {abs_variance_pct:.1f}% | "
                f"Severity: {anomaly_severity_score:.3f}")
    return {
        "variance_magnitude_pct": abs_variance_pct,
        "divergence_direction": direction,
        "anomaly_severity_score": anomaly_severity_score,
        "variance_report": variance_report,
        "sarima_mean_mw": sarima_mean_mw,
        "chronos_mean_mw": chronos_mean_mw,
        "analysis_findings": [f"Model divergence: {direction} at {abs_variance_pct:.1f}% | Severity: {anomaly_severity_score:.2f}"],
        "graph_execution_trace": ["divergence_analyst_node"],
    }


# ─────────────────────────────────────────────
# NODE 2B: Seasonality Detector (Parallel Branch B)
# ─────────────────────────────────────────────
def seasonality_detector_node(state: GridOpsState) -> dict:
    """
    Uses Grok to produce a qualitative seasonality risk assessment.
    Runs in PARALLEL with divergence_analyst_node.
    LLM call is lightweight — grok-beta handles this in ~1 second.
    """
    logger.info("NODE 2B | Seasonality Detector | Starting")

    # Guard: skip LLM call if data quality failed (node still fires via
    # unconditional edge, but we don't waste an API call on bad data)
    if not state.get("data_quality_valid", True):
        logger.warning("NODE 2B | Skipping — data quality validation failed")
        return {
            "seasonal_demand_pattern": "Skipped due to data quality failure.",
            "seasonal_risk_factor": "N/A",
            "analysis_findings": ["Seasonality analysis skipped — data quality invalid"],
            "graph_execution_trace": ["seasonality_detector_node (skipped)"],
        }

    llm = _get_llm()
    regime = state.get("seasonality_regime", "SHOULDER")
    direction = state.get("divergence_direction") or "UNKNOWN"
    magnitude = state.get("variance_magnitude_pct") or 0.0
    mean_load = state.get("data_stats", {}).get("mean_load", 100000)
    total_days = state.get("data_stats", {}).get("total_days", 1000)

    messages = [
        SystemMessage(content=SEASONALITY_SYSTEM),
        HumanMessage(content=SEASONALITY_HUMAN.format(
            regime=regime,
            mean_load=float(mean_load),
            direction=direction,
            magnitude=magnitude,
            total_days=int(total_days),
        )),
    ]

    response = llm.invoke(messages)
    content = response.content
    if isinstance(content, list):
        seasonal_analysis = " ".join(
            str(block.get("text", "")) if isinstance(block, dict) else block
            for block in content
        ).strip()
    else:
        seasonal_analysis = content.strip()

    # The prompt requests exactly 2 paragraphs. Split them.
    paragraphs = [p.strip() for p in seasonal_analysis.split("\n\n") if p.strip()]
    if len(paragraphs) >= 2:
        seasonal_demand_pattern = paragraphs[0]
        seasonal_risk = "\n\n".join(paragraphs[1:])
    else:
        seasonal_demand_pattern = seasonal_analysis
        seasonal_risk = "See Regime Pattern Analysis for risk factors."

    logger.info(f"NODE 2B | Regime: {regime} | Risk: {seasonal_risk[:60]}...")
    return {
        "seasonal_demand_pattern": seasonal_demand_pattern,
        "seasonal_risk_factor": seasonal_risk,
        "analysis_findings": [f"Seasonal context: {regime} regime | {seasonal_risk[:80]}..."],
        "graph_execution_trace": ["seasonality_detector_node"],
    }


# ─────────────────────────────────────────────
# NODE 3: RAG Context Retriever (Fan-in after parallel nodes)
# ─────────────────────────────────────────────
def rag_retriever_node(state: GridOpsState) -> dict:
    """
    Synthesizes findings from both parallel nodes into a RAG query.
    Retrieves semantically similar historical grid events.
    This node runs AFTER both parallel nodes complete (fan-in).
    """
    logger.info("NODE 3 | RAG Retriever | Starting")

    retriever = GridEventRetriever()

    # Build a semantically rich query from both parallel node outputs
    direction = state.get("divergence_direction", "ALIGNED")
    magnitude = state.get("variance_magnitude_pct", 0)
    regime = state.get("seasonality_regime", "SHOULDER")
    severity_score = state.get("anomaly_severity_score", 0)

    # Map severity score to severity filter
    severity_filter = None
    if severity_score > 0.7:
        severity_filter = "CRITICAL"
    elif severity_score > 0.5:
        severity_filter = "HIGH"

    query = (
        f"energy demand {direction.lower().replace('_', ' ')} "
        f"magnitude {magnitude:.0f} percent {regime.lower()} season "
        f"grid load anomaly PJM"
    )

    events = retriever.retrieve(query=query, n_results=3, severity_filter=severity_filter)
    stats = retriever.get_stats()

    logger.info(
        f"NODE 3 | Retrieved {len(events)} events | "
        f"Query: '{query[:60]}...' | DB size: {stats['total_docs']}"
    )
    return {
        "retrieved_events": events,
        "rag_query_used": query,
        "graph_execution_trace": ["rag_retriever_node"],
    }


# ─────────────────────────────────────────────
# NODE 4: Risk Quantifier
# ─────────────────────────────────────────────
def risk_quantifier_node(state: GridOpsState) -> dict:
    """
    Computes VaR-style risk metrics from the Chronos confidence bands.
    These are pure math — no LLM needed. Fast and deterministic.
    downside_var = how much demand could fall below median (p10 gap)
    upside_var = how much demand could exceed median (p90 gap)
    risk_reward_ratio = upside / downside (>1 = more upside risk than downside)
    """
    logger.info("NODE 4 | Risk Quantifier | Starting")

    p10 = np.array(state["chronos_p10"])
    p50 = np.array(state["chronos_p50"])
    p90 = np.array(state["chronos_p90"])

    downside_var = float(np.mean(p50 - p10))   # avg MW gap below median
    upside_var = float(np.mean(p90 - p50))     # avg MW gap above median
    risk_reward = upside_var / (downside_var + 1e-8)

    logger.info(
        f"NODE 4 | Downside VaR: {downside_var:,.0f} MW | "
        f"Upside VaR: {upside_var:,.0f} MW | "
        f"R/R Ratio: {risk_reward:.3f}"
    )
    return {
        "downside_var_mw": downside_var,
        "upside_var_mw": upside_var,
        "risk_reward_ratio": risk_reward,
        "graph_execution_trace": ["risk_quantifier_node"],
    }


# ─────────────────────────────────────────────
# NODE 5 (BRANCH A): High-Confidence Strategy Formulator
# ─────────────────────────────────────────────
def strategy_formulator_node(state: GridOpsState) -> dict:
    """
    Invoked when anomaly_severity_score >= 0.40.
    Uses Grok to synthesize ALL upstream signals into a structured mandate.
    This is the main LLM reasoning node — given the richest context.
    """
    logger.info("NODE 5A | Strategy Formulator (HIGH CONFIDENCE path) | Starting")

    llm = _get_llm()

    # Format RAG context for the prompt
    rag_lines = []
    for i, event in enumerate(state.get("retrieved_events", []), 1):
        rag_lines.append(
            f"{i}. [{event.get('event_type', 'UNKNOWN')}] "
            f"Severity: {event.get('severity', '?')} | "
            f"Impact: {event.get('demand_impact_pct', 0):+.1f}% | "
            f"Region: {event.get('grid_region', '?')}\n"
            f"   {event.get('description', '')[:120]}..."
        )
    rag_context_formatted = "\n".join(rag_lines) if rag_lines else "No similar events retrieved."

    sarima_wape = state.get("sarima_wape") or 0
    chronos_wape = state.get("chronos_wape") or 0
    wape_delta_description = (
        f"outperforming baseline by {abs(sarima_wape - chronos_wape):.2%}"
        if chronos_wape < sarima_wape
        else f"underperforming baseline by {abs(chronos_wape - sarima_wape):.2%}"
    )

    # Build static mathematical rationale paragraphs
    sarima_mw = state.get("sarima_mean_mw", 0)
    chronos_mw = state.get("chronos_mean_mw", 0)
    var_mag = state.get("variance_magnitude_pct", 0)
    
    p1 = f"Model Divergence measures the average relative difference between the two forecast models. It indicates whether the AI and the classical statistics agree on where demand is heading. The divergence is computed as mean(|{chronos_mw:,.0f} − {sarima_mw:,.0f}| / {sarima_mw:,.0f}) × 100, which yields {var_mag:.2f}%. This gap is driven by {'structural grid anomalies' if var_mag >= 5.0 else 'standard seasonal noise and model variance'}."
    
    sarima_wape = state.get("sarima_wape") or 0
    chronos_wape = state.get("chronos_wape") or 0
    sharpness = state.get("interval_sharpness") or 0
    
    div_signal = min(var_mag / 6.0, 1.0)
    wape_signal = min(max(0, sarima_wape - chronos_wape) / 0.03, 1.0)
    sharp_signal = min(sharpness / 0.001, 1.0)
    sev = state.get("anomaly_severity_score", 0)
    thresh = state.get("severity_threshold", 0.40)
    p2 = f"The Anomaly Severity Score combines three independent signals into a single 0-to-1 risk indicator. It serves as the master decision signal for whether to take operational action. The formula is: (0.40 × {div_signal:.2f} Divergence) + (0.35 × {wape_signal:.2f} WAPE Delta) + (0.25 × {sharp_signal:.2f} Sharpness) = {sev:.2f}. Since this score is {'above' if sev >= thresh else 'below'} the {thresh:.2f} action threshold, {'reserve deployment is warranted' if sev >= thresh else 'no reserve deployment is warranted'}."
    
    p3 = f"WAPE (Weighted Absolute Percentage Error) measures how far off each model's predictions are from actual demand. A lower WAPE indicates a more accurate forecast. The SARIMA baseline has a WAPE of {sarima_wape:.2%}, while the Chronos AI has a WAPE of {chronos_wape:.2%}. This confirms the deep learning model is {wape_delta_description}."
    
    rr = state.get("risk_reward_ratio", 0)
    p4 = f"The p10 and p90 scenarios represent tail-risk bounds for potential demand outcomes. They help operators understand the worst-case physical scenarios. The p10 downside risk is {state.get('downside_var_mw', 0):,.0f} MW, while the p90 upside risk is {state.get('upside_var_mw', 0):,.0f} MW. The Risk/Reward ratio of {rr:.2f} indicates {'upside risk exceeds downside' if rr > 1.0 else 'downside risk exceeds upside'}."
    
    quantitative_rationale = "\n\n".join([p1, p2, p3, p4])

    messages = [
        SystemMessage(content=STRATEGY_SYSTEM),
        HumanMessage(content=STRATEGY_HUMAN.format(
            quantitative_rationale=quantitative_rationale,
            seasonality_regime=state.get("seasonality_regime", "SHOULDER"),
            seasonal_risk_factor=state.get("seasonal_risk_factor", ""),
            seasonal_demand_pattern=state.get("seasonal_demand_pattern", ""),
            rag_context_formatted=rag_context_formatted,
        )),
    ]

    response = llm.invoke(messages)
    content = response.content
    if isinstance(content, list):
        raw_json = " ".join(
            str(block.get("text", "")) if isinstance(block, dict) else block
            for block in content
        ).strip()
    else:
        raw_json = content.strip()

    # Clean and parse JSON (Grok sometimes wraps in markdown)
    raw_json = raw_json.replace("```json", "").replace("```", "").strip()
    mandate = json.loads(raw_json, strict=False)


    
    # Get the LLM summary
    summary_rationale = mandate.get('summary_rationale', '')

    static_intro = "The GridOps AI pipeline has analyzed the current 14-day forecast window. Below is the operational assessment of the predictive models."

    mandate_narrative = (
        f"{static_intro}\n\n"
        f"{quantitative_rationale}\n\n"
        f"**Summary**: {summary_rationale}\n\n"
        f"Re-evaluation trigger: {mandate.get('re_evaluation_trigger', 'N/A')}"
    )

    logger.info(
        f"NODE 5A | Mandate: {mandate['recommendation']} "
        f"| Confidence: {mandate['confidence_score']}%"
    )
    return {
        "trading_mandate": mandate,
        "mandate_narrative": mandate_narrative,
        "graph_execution_trace": ["strategy_formulator_node"],
    }


# ─────────────────────────────────────────────
# NODE 5 (BRANCH B): Low-Confidence Conservative Advisory
# ─────────────────────────────────────────────
def conservative_advisory_node(state: GridOpsState) -> dict:
    """
    Invoked when anomaly_severity_score < 0.40.
    Produces a conservative HOLD advisory with minimal position sizing.
    This conditional routing is the key architectural differentiator vs. a simple chain.
    """
    logger.info("NODE 5B | Conservative Advisory (LOW CONFIDENCE path) | Starting")

    llm = _get_llm()

    # Format RAG context for the prompt
    rag_lines = []
    for i, event in enumerate(state.get("retrieved_events", []), 1):
        rag_lines.append(
            f"{i}. [{event.get('event_type', 'UNKNOWN')}] "
            f"Severity: {event.get('severity', '?')} | "
            f"Impact: {event.get('demand_impact_pct', 0):+.1f}% | "
            f"Region: {event.get('grid_region', '?')}\n"
            f"   {event.get('description', '')[:120]}..."
        )
    rag_context_formatted = "\n".join(rag_lines) if rag_lines else "No similar events retrieved."

    # Build static mathematical rationale paragraphs
    sarima_mw = state.get("sarima_mean_mw", 0)
    chronos_mw = state.get("chronos_mean_mw", 0)
    var_mag = state.get("variance_magnitude_pct", 0)
    sarima_wape = state.get("sarima_wape", 0)
    chronos_wape = state.get("chronos_wape", 0)
    wape_delta = abs(sarima_wape - chronos_wape)
    wape_desc = f"outperforming baseline by {wape_delta:.2%}" if chronos_wape < sarima_wape else f"underperforming baseline by {wape_delta:.2%}"
    
    p1 = f"Model Divergence measures the average relative difference between the two forecast models. It indicates whether the AI and the classical statistics agree on where demand is heading. The divergence is computed as mean(|{chronos_mw:,.0f} − {sarima_mw:,.0f}| / {sarima_mw:,.0f}) × 100, which yields {var_mag:.2f}%. This gap is driven by {'structural grid anomalies' if var_mag >= 5.0 else 'standard seasonal noise and model variance'}."
    
    sharpness = state.get("interval_sharpness", 0)
    div_signal = min(var_mag / 6.0, 1.0)
    wape_signal = min(max(0, sarima_wape - chronos_wape) / 0.03, 1.0)
    sharp_signal = min(sharpness / 0.001, 1.0)
    sev = state.get("anomaly_severity_score", 0)
    thresh = state.get("severity_threshold", 0.40)
    p2 = f"The Anomaly Severity Score combines three independent signals into a single 0-to-1 risk indicator. It serves as the master decision signal for whether to take operational action. The formula is: (0.40 × {div_signal:.2f} Divergence) + (0.35 × {wape_signal:.2f} WAPE Delta) + (0.25 × {sharp_signal:.2f} Sharpness) = {sev:.2f}. Since this score is {'above' if sev >= thresh else 'below'} the {thresh:.2f} action threshold, {'reserve deployment is warranted' if sev >= thresh else 'no reserve deployment is warranted'}."
    
    p3 = f"WAPE (Weighted Absolute Percentage Error) measures how far off each model's predictions are from actual demand. A lower WAPE indicates a more accurate forecast. The SARIMA baseline has a WAPE of {sarima_wape:.2%}, while the Chronos AI has a WAPE of {chronos_wape:.2%}. This confirms the deep learning model is {wape_desc}."
    
    rr = state.get("risk_reward_ratio", 0)
    p4 = f"The p10 and p90 scenarios represent tail-risk bounds for potential demand outcomes. They help operators understand the worst-case physical scenarios. The p10 downside risk is {state.get('downside_var_mw', 0):,.0f} MW, while the p90 upside risk is {state.get('upside_var_mw', 0):,.0f} MW. The Risk/Reward ratio of {rr:.2f} indicates {'upside risk exceeds downside' if rr > 1.0 else 'downside risk exceeds upside'}."
    
    quantitative_rationale = "\n\n".join([p1, p2, p3, p4])

    messages = [
        SystemMessage(content=CONSERVATIVE_ADVISORY_SYSTEM),
        HumanMessage(content=CONSERVATIVE_ADVISORY_HUMAN.format(
            quantitative_rationale=quantitative_rationale,
            seasonality_regime=state.get("seasonality_regime", "SHOULDER"),
            seasonal_risk_factor=state.get("seasonal_risk_factor", ""),
            rag_context_formatted=rag_context_formatted,
        )),
    ]

    response = llm.invoke(messages)
    content = response.content
    if isinstance(content, list):
        raw_json = " ".join(
            str(block.get("text", "")) if isinstance(block, dict) else block
            for block in content
        ).strip()
    else:
        raw_json = content.strip()
        
    raw_json = raw_json.replace("```json", "").replace("```", "").strip()
    mandate = json.loads(raw_json, strict=False)


    
    summary_rationale = mandate.get('summary_rationale', '')

    static_intro = "The GridOps AI pipeline has analyzed the current 14-day forecast window. Below is the operational assessment of the predictive models."

    mandate_narrative = (
        f"{static_intro}\n\n"
        f"{quantitative_rationale}\n\n"
        f"**Summary**: {summary_rationale}\n\n"
        f"Re-evaluation trigger: {mandate.get('re_evaluation_trigger', 'N/A')}"
    )

    logger.info(
        f"NODE 5B | Conservative HOLD issued | "
        f"Confidence: {mandate['confidence_score']}% | "
        f"Severity was: {state.get('anomaly_severity_score', 0):.3f}"
    )
    return {
        "trading_mandate": mandate,
        "mandate_narrative": mandate_narrative,
        "graph_execution_trace": ["conservative_advisory_node"],
    }