# api/schemas.py
from pydantic import BaseModel, Field


class OrchestrationRequest(BaseModel):
    dataset_path: str = Field(
        default="data_store/pjm_hourly_est.csv",
        description="Path to the PJM CSV dataset"
    )
    severity_threshold: float = Field(
        default=0.40,
        ge=0.0, le=1.0,
        description="Anomaly severity threshold for the risk gate (0.0-1.0)"
    )
    forecast_horizon: int = Field(
        default=30,
        ge=7, le=90,
        description="Number of days to forecast ahead"
    )

    model_config = {"json_schema_extra": {"example": {
        "dataset_path": "data_store/pjm_hourly_est.csv",
        "severity_threshold": 0.40,
        "forecast_horizon": 30,
    }}}


class EventCreate(BaseModel):
    event_type: str = Field(description="Type of grid event (e.g., 'Heat wave', 'Equipment failure')")
    severity: str = Field(description="LOW, MEDIUM, HIGH, or CRITICAL")
    description: str = Field(description="Detailed description of the event")
    demand_impact_pct: float = Field(default=0.0, description="Percentage impact on demand")
    grid_region: str = Field(default="PJM", description="Grid region affected")


class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str


class StatusResponse(BaseModel):
    status: str
    progress: int = 0
    stage: str = ""
    result: dict | None = None
    error: str | None = None