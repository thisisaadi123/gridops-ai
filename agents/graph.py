# agents/graph.py
from langgraph.graph import StateGraph, END
from agents.state import GridOpsState
from agents.nodes import (
    validate_data_node,
    divergence_analyst_node,
    seasonality_detector_node,
    rag_retriever_node,
    risk_quantifier_node,
    strategy_formulator_node,
    conservative_advisory_node,
)
from loguru import logger


def should_run_full_strategy(state: GridOpsState) -> str:
    """
    Conditional edge function — the risk gate.
    Returns node name to route to based on anomaly severity.

    HIGH confidence (score >= 0.40): full strategy formulation
    LOW confidence (score < 0.40): conservative advisory

    The 0.40 threshold is tunable — lower it to be more aggressive,
    raise it to be more conservative.
    """
    score = state.get("anomaly_severity_score", 0.0)
    route = "strategy_formulator" if score >= 0.40 else "conservative_advisory"
    logger.info(f"RISK GATE | Score: {score:.3f} → Routing to: {route}")
    return route


def should_continue_after_validation(state: GridOpsState) -> str:
    """
    If data quality fails, skip everything and route to END.
    No point calling expensive APIs on bad data.
    """
    if not state.get("data_quality_valid", False):
        logger.warning("VALIDATION GATE | Data quality failed — terminating graph early")
        return "end"
    return "continue"


def build_gridops_graph():
    """
    Build and compile the 7-node LangGraph.

    Graph topology:
    START
      ↓
    validate_data ──(quality_fail)──→ END
      ↓ (quality_pass)
    divergence_analyst ←──────────┐
                                   │ (both run in parallel from validate_data)
    seasonality_detector ←─────────┘
      ↓ (both feed into)
    rag_retriever
      ↓
    risk_quantifier
      ↓
    [RISK GATE — conditional]
    ├── score >= 0.40 → strategy_formulator
    └── score < 0.40  → conservative_advisory
      ↓
    END
    """
    builder = StateGraph(GridOpsState)

    # Register all nodes
    builder.add_node("validate_data", validate_data_node)
    builder.add_node("divergence_analyst", divergence_analyst_node)
    builder.add_node("seasonality_detector", seasonality_detector_node)
    builder.add_node("rag_retriever", rag_retriever_node)
    builder.add_node("risk_quantifier", risk_quantifier_node)
    builder.add_node("strategy_formulator", strategy_formulator_node)
    builder.add_node("conservative_advisory", conservative_advisory_node)

    # Entry point
    builder.set_entry_point("validate_data")

    # Conditional edge after validation
    builder.add_conditional_edges(
        "validate_data",
        should_continue_after_validation,
        {
            "continue": "divergence_analyst",   # will also trigger seasonality in parallel
            "end": END,
        }
    )

    # Fan-out: both analyst nodes start after validation passes
    # LangGraph runs nodes with no dependency on each other in parallel
    builder.add_edge("validate_data", "seasonality_detector")  # parallel with divergence_analyst
    # NOTE: LangGraph automatically runs both edges in parallel

    # Fan-in: rag_retriever waits for BOTH parallel nodes
    builder.add_edge("divergence_analyst", "rag_retriever")
    builder.add_edge("seasonality_detector", "rag_retriever")

    # Linear chain after fan-in
    builder.add_edge("rag_retriever", "risk_quantifier")

    # Conditional risk gate
    builder.add_conditional_edges(
        "risk_quantifier",
        should_run_full_strategy,
        {
            "strategy_formulator": "strategy_formulator",
            "conservative_advisory": "conservative_advisory",
        }
    )

    # Both terminal nodes route to END
    builder.add_edge("strategy_formulator", END)
    builder.add_edge("conservative_advisory", END)

    compiled = builder.compile()
    logger.info("LangGraph compiled successfully | Nodes: 7 | Conditional edges: 2")
    return compiled


# Module-level instance — imported by worker/tasks.py
gridops_graph = build_gridops_graph()