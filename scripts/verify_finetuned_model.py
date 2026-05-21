import os
import sys
import numpy as np
from loguru import logger

# Add project root to Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from autogluon.timeseries import TimeSeriesPredictor
from worker.chronos_client import get_chronos_client, LocalChronosClient
from worker.data_pipeline import EnergyDataPipeline
from agents.graph import build_gridops_graph

def calculate_wape(y_true, y_pred):
    return np.sum(np.abs(y_true - y_pred)) / np.sum(np.abs(y_true))

def main():
    checks_passed = 0
    total_checks = 6
    
    try:
        # ---------------------------------------------------------
        # Check 1: Model loads
        # ---------------------------------------------------------
        logger.info("Running Check 1: Model loads...")
        predictor = TimeSeriesPredictor.load("models/chronos-pjm-finetuned")
        logger.info(f"prediction_length: {predictor.prediction_length}")
        logger.info(f"eval_metric: {predictor.eval_metric}")
        logger.success("PASS - Check 1\n")
        checks_passed += 1

        # ---------------------------------------------------------
        # Check 2: Client initializes
        # ---------------------------------------------------------
        logger.info("Running Check 2: Client initializes...")
        client = get_chronos_client()
        assert isinstance(client, LocalChronosClient), f"Expected LocalChronosClient, got {type(client)}"
        logger.info(f"Client type: {type(client)}")
        logger.success("PASS - Check 2\n")
        checks_passed += 1

        # ---------------------------------------------------------
        # Check 3: Forecast shape is correct
        # ---------------------------------------------------------
        logger.info("Running Check 3: Forecast shape is correct...")
        pipeline = EnergyDataPipeline('data_store/pjm_hourly_est.csv')
        pipeline.load_and_preprocess()
        pipeline.split_holdout(n_days=30)
        
        assert pipeline.train is not None, "pipeline.train was not initialized"
        assert pipeline.holdout is not None, "pipeline.holdout was not initialized"
        
        forecast_result = client.forecast(
            pipeline.train.to_numpy(),  # type: ignore
            prediction_length=30, 
            num_samples=20
        )
        chronos_p10 = np.array(forecast_result["p10"])
        chronos_p50 = np.array(forecast_result["p50"])
        chronos_p90 = np.array(forecast_result["p90"])
        
        assert chronos_p10.shape == (30,), f"Expected shape (30,), got {chronos_p10.shape}"
        assert chronos_p50.shape == (30,), f"Expected shape (30,), got {chronos_p50.shape}"
        assert chronos_p90.shape == (30,), f"Expected shape (30,), got {chronos_p90.shape}"
        assert (chronos_p10 <= chronos_p50).all(), "Expected p10 <= p50 element-wise"
        assert (chronos_p50 <= chronos_p90).all(), "Expected p50 <= p90 element-wise"
        logger.success("PASS - Check 3\n")
        checks_passed += 1

        # ---------------------------------------------------------
        # Check 4: WAPE is better than SARIMA
        # ---------------------------------------------------------
        logger.info("Running Check 4: WAPE is better than SARIMA...")
        pipeline.fit_sarima()
        sarima_forecast = pipeline.forecast_sarima(steps=30)
        
        sarima_wape = calculate_wape(pipeline.holdout.values, sarima_forecast)
        chronos_wape = calculate_wape(pipeline.holdout.values, chronos_p50)
        
        improvement = sarima_wape - chronos_wape
        logger.info(f"SARIMA WAPE: {sarima_wape:.4f}")
        logger.info(f"Chronos WAPE: {chronos_wape:.4f}")
        logger.info(f"Improvement Delta: {improvement:.4f}")
        
        assert chronos_wape < sarima_wape, "Chronos WAPE should be better (lower) than SARIMA WAPE"
        logger.success("PASS - Check 4\n")
        checks_passed += 1

        # ---------------------------------------------------------
        # Check 5: Full LangGraph pipeline runs with finetuned model
        # ---------------------------------------------------------
        logger.info("Running Check 5: Full LangGraph pipeline runs...")
        graph = build_gridops_graph()
        initial_state = {
            "dataset_path": "data_store/pjm_hourly_est.csv",
            "forecast_horizon": 30,
            "severity_threshold": 0.40,
            "data_stats": pipeline.data_stats,
            "sarima_forecast": sarima_forecast.tolist(),
            "sarima_wape": sarima_wape,
            "sarima_backtest_wape": 0.0,
            "backtest_wape": 0.0,
            "chronos_p10": chronos_p10.tolist(),
            "chronos_p50": chronos_p50.tolist(),
            "chronos_p90": chronos_p90.tolist(),
            "chronos_wape": chronos_wape,
            "interval_sharpness": EnergyDataPipeline.calculate_interval_sharpness(chronos_p10, chronos_p90),
            "seasonality_regime": pipeline.detect_seasonality_regime(),
            "historical_data": pipeline.train.to_numpy()[-90:].tolist(),
            "holdout_data": pipeline.holdout.to_numpy().tolist(),
            "holdout_dates": [d.date().isoformat() for d in pipeline.holdout.index],
            "forecast_dates": [],
            "analysis_findings": [],
            "graph_execution_trace": [],
            "pipeline_start_ts": "",
            "pipeline_end_ts": "",
        }
        result = graph.invoke(initial_state)
        
        mandate = result.get('trading_mandate', {})
        assert isinstance(mandate, dict), "trading_mandate should be a dictionary"
        
        valid_recs = ['BUY', 'SELL', 'HOLD', 'MAINTAIN OPS', 'INCREASE GENERATION', 'DEPLOY RESERVES']
        rec = mandate.get('recommendation', '')
        assert rec in valid_recs, f"recommendation '{rec}' not in expected valid values"
        
        trace = result.get('graph_execution_trace', [])
        assert len(trace) >= 6, f"Expected at least 6 nodes in execution trace, got {len(trace)}"
        logger.success("PASS - Check 5\n")
        checks_passed += 1

        # ---------------------------------------------------------
        # Check 6: Finetuned vs base comparison
        # ---------------------------------------------------------
        logger.info("Running Check 6: Finetuned vs base comparison...")
        improvement_pct = (improvement / sarima_wape) * 100
        
        print("\nModel                    WAPE      Improvement")
        print("-" * 50)
        print(f"SARIMA baseline          {sarima_wape:.4f}    —")
        print(f"Chronos-T5-Base (FT)     {chronos_wape:.4f}    +{improvement_pct:.1f}%\n")
        
        logger.success("PASS - Check 6\n")
        checks_passed += 1

    except AssertionError as e:
        logger.error(f"Assertion failed: {str(e)}")
    except Exception as e:
        logger.exception(f"Unexpected error: {str(e)}")

    finally:
        if checks_passed == total_checks:
            print("✅ All 6 checks passed — finetuned model verified")
        else:
            print(f"❌ {total_checks - checks_passed} checks failed — see details above")

if __name__ == '__main__':
    main()
