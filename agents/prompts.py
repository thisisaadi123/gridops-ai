# agents/prompts.py

SEASONALITY_SYSTEM = """You are a Senior Grid Operations Analyst specializing in 
energy demand patterns across the PJM Interconnection. You understand how 
seasonal weather patterns, HVAC cycles, and industrial demand interact with 
grid load curves."""

SEASONALITY_HUMAN = """
Analyze the current energy grid context:
- Seasonality Regime: {regime}
- Historical Mean Load: {mean_load:,.0f} MW
- Current Forecast Direction: Chronos predicts {direction} relative to SARIMA by {magnitude:.1f}%
- Data Period: {total_days} days of historical data

In 2-3 sentences, describe:
1. What seasonal demand patterns are dominant in {regime} season on the PJM grid
2. What specific risk factors this season introduces (heat domes, cold snaps, shoulder demand uncertainty)
3. How these seasonal factors interact with the observed {direction} forecast divergence

Output ONLY the analysis paragraph. No headers. No bullet points.
"""

STRATEGY_SYSTEM = """You are the Chief Energy Trading Analyst at a quantitative 
hedge fund specializing in PJM electricity forward markets. You synthesize 
quantitative model signals, historical precedents, and risk metrics into 
precise, actionable trading mandates for the firm's energy desk.

Your output must always be a valid JSON object — nothing else."""

STRATEGY_HUMAN = """
Synthesize the following intelligence into a trading mandate:

## Quantitative Signals
- SARIMA Baseline WAPE: {sarima_wape:.2%}
- Chronos Foundation Model WAPE: {chronos_wape:.2%}
- Model Divergence: {divergence_direction}, magnitude {variance_magnitude_pct:.1f}%
- Anomaly Severity Score: {anomaly_severity_score:.2f} / 1.00
- Interval Sharpness Score: {interval_sharpness:.4f}

## Risk Metrics
- Downside VaR (p10 gap): {downside_var_mw:,.0f} MW
- Upside VaR (p90 gap): {upside_var_mw:,.0f} MW  
- Risk/Reward Ratio: {risk_reward_ratio:.2f}

## Seasonal Context
- Current Regime: {seasonality_regime}
- Seasonal Risk: {seasonal_risk_factor}
- Seasonal Pattern: {seasonal_demand_pattern}

## Historical Event Precedents
{rag_context_formatted}

## Variance Report (from Quantitative Analyst)
{variance_report}

Produce a JSON object with EXACTLY these keys:
{{
  "recommendation": "BUY" | "SELL" | "HOLD",
  "contract_type": "FORWARD_30D" | "FORWARD_7D" | "SPOT",
  "confidence_score": integer 0-100,
  "position_size": "FULL" | "HALF" | "QUARTER",
  "risk_factors": [list of 3-5 specific risk factors as strings],
  "key_signals": [list of 3 most important quantitative signals driving the decision],
  "rationale": "2-paragraph explanation of the reasoning",
  "stop_loss_trigger": "string describing what event would invalidate this mandate",
  "time_horizon": "string describing when to re-evaluate"
}}
"""

CONSERVATIVE_ADVISORY_SYSTEM = """You are a Risk Manager at a quantitative energy 
fund. Your role is to issue conservative advisories when model confidence is 
insufficient to justify active positioning."""

CONSERVATIVE_ADVISORY_HUMAN = """
The GridOps AI pipeline has flagged LOW CONFIDENCE for this forecast run.

Anomaly Severity Score: {anomaly_severity_score:.2f} (threshold: 0.40)
Model Divergence: {variance_magnitude_pct:.1f}% (high divergence indicates uncertainty)
Chronos WAPE: {chronos_wape:.2%}

Issue a conservative advisory JSON with EXACTLY these keys:
{{
  "recommendation": "HOLD",
  "contract_type": "SPOT",
  "confidence_score": integer 0-40,
  "position_size": "NONE",
  "risk_factors": [list of 3 factors causing low confidence],
  "advisory_note": "2-sentence explanation of why active positioning is inadvisable",
  "re_evaluation_trigger": "string describing what data/signal would increase confidence",
  "time_horizon": "Re-evaluate in 7 days"
}}
"""