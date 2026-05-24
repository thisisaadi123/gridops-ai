from api.celery_app import celery_app
from worker.data_pipeline import EnergyDataPipeline
from worker.chronos_client import get_chronos_client
from agents.graph import gridops_graph
from api.config import get_settings
from loguru import logger
from datetime import datetime, timedelta, timezone


@celery_app.task(bind=True, name='tasks.run_gridops_pipeline', max_retries=2)
def run_gridops_pipeline(self, dataset_path: str, severity_threshold: float = 0.40, forecast_horizon: int = 30) -> dict:
    try:
        self.update_state(
            state='PROGRESS',
            meta={
                'stage': 'DATA_PIPELINE',
                'progress': 10,
                'message': 'Running data preprocessing and SARIMA baseline',
            },
        )
        logger.info('DATA_PIPELINE | Starting')
        pipeline = EnergyDataPipeline(dataset_path)
        pipeline.load_and_preprocess()
        pipeline.validate_data_quality()
        pipeline.split_holdout(holdout_days=forecast_horizon)
        pipeline.detect_seasonality_regime()
        assert pipeline.train is not None
        assert pipeline.holdout is not None
        assert pipeline.data_stats is not None
        assert pipeline.seasonality_regime is not None
        pipeline.fit_sarima()
        sarima_fc = pipeline.forecast_sarima(steps=forecast_horizon)
        backtest = pipeline.rolling_backtest()
        sarima_wape = pipeline.calculate_wape(
            pipeline.holdout.values,  # pyrefly: ignore[bad-argument-type]
            sarima_fc,
        )

        self.update_state(
            state='PROGRESS',
            meta={
                'stage': 'CHRONOS_INFERENCE',
                'progress': 35,
                'message': 'Running Chronos forecast inference',
            },
        )
        logger.info('CHRONOS_INFERENCE | Starting')
        client = get_chronos_client()

        if forecast_horizon <= 14:
            logger.info("Routing to High-Fidelity Hourly Inference Pipeline (horizon <= 14)")
            chronos_result = client.forecast(
                pipeline.train_hourly.values,  # pyrefly: ignore[bad-argument-type]
                prediction_length=forecast_horizon * 24,
                num_samples=20,
            )
            import numpy as np
            
            # Bridge: reshape (horizon*24) -> (horizon, 24) and apply daily median
            chronos_p10 = np.median(np.asarray(chronos_result['p10']).reshape(forecast_horizon, 24), axis=1)
            chronos_p50 = np.median(np.asarray(chronos_result['p50']).reshape(forecast_horizon, 24), axis=1)
            chronos_p90 = np.median(np.asarray(chronos_result['p90']).reshape(forecast_horizon, 24), axis=1)
        else:
            logger.info("Routing to Structural Daily Inference Pipeline (horizon > 14)")
            chronos_result = client.forecast(
                pipeline.train.values,  # pyrefly: ignore[bad-argument-type]
                prediction_length=forecast_horizon,
                num_samples=20,
            )
            chronos_p10 = chronos_result['p10']
            chronos_p50 = chronos_result['p50']
            chronos_p90 = chronos_result['p90']

        import numpy as np
        
        # --- Mean-Matching Ensemble Calibration ---
        # SARIMA (16-yr context) provides the structurally accurate baseline mean
        sarima_mean = np.mean(sarima_fc)
        
        # Chronos provides the high-fidelity shape, but has a recency-biased mean
        chronos_mean = np.mean(chronos_p50)
        
        # Calculate the bias shift required to anchor Chronos to SARIMA
        bias_shift = sarima_mean - chronos_mean
        
        # Apply the shift and mathematically clip to 0 to prevent negative physical loads
        chronos_p10 = np.maximum(chronos_p10 + bias_shift, 0.0)
        chronos_p50 = np.maximum(chronos_p50 + bias_shift, 0.0)
        chronos_p90 = np.maximum(chronos_p90 + bias_shift, 0.0)

        assert not isinstance(chronos_p10, list)
        assert not isinstance(chronos_p50, list)
        assert not isinstance(chronos_p90, list)
        chronos_wape = pipeline.calculate_wape(
            pipeline.holdout.values,  # pyrefly: ignore[bad-argument-type]
            chronos_p50,
        )
        sharpness = pipeline.calculate_interval_sharpness(
            chronos_p10,
            chronos_p90,
        )

        self.update_state(
            state='PROGRESS',
            meta={
                'stage': 'AGENT_REASONING',
                'progress': 60,
                'message': 'Running LangGraph agent reasoning',
            },
        )
        logger.info('AGENT_REASONING | Starting')
        forecast_start = pipeline.train.index[-1] + timedelta(days=1)
        forecast_dates = [
            (forecast_start + timedelta(days=i)).date().isoformat()
            for i in range(forecast_horizon)
        ]
        # Holdout dates for actual vs forecast comparison
        holdout_dates = [
            d.date().isoformat() for d in pipeline.holdout.index
        ]

        initial_state = {
            'dataset_path': dataset_path,
            'seasonality_regime': pipeline.seasonality_regime,
            'data_stats': pipeline.data_stats,
            'sarima_forecast': sarima_fc.tolist(),
            'sarima_wape': sarima_wape,
            'sarima_backtest_wape': backtest['mean_wape'],
            'backtest_wape': backtest['mean_wape'],
            'chronos_p10': chronos_p10.tolist(),
            'chronos_p50': chronos_p50.tolist(),
            'chronos_p90': chronos_p90.tolist(),
            'chronos_wape': chronos_wape,
            'interval_sharpness': sharpness,
            'historical_data': pipeline.train.values[-90:].tolist(),
            'holdout_data': pipeline.holdout.values.tolist(),
            'holdout_dates': holdout_dates,
            'forecast_dates': forecast_dates,
            'severity_threshold': severity_threshold,
            'forecast_horizon': forecast_horizon,
            'analysis_findings': [],
            'graph_execution_trace': [],
            'pipeline_start_ts': datetime.now(timezone.utc).isoformat(),
            'pipeline_end_ts': '',
        }
        result = gridops_graph.invoke(initial_state)

        self.update_state(
            state='PROGRESS',
            meta={
                'stage': 'COMPLETE',
                'progress': 100,
                'message': 'Pipeline complete',
            },
        )
        logger.info('COMPLETE | Starting')
        return {
            'dataset_path': dataset_path,
            'sarima_forecast': result['sarima_forecast'],
            'sarima_wape': result['sarima_wape'],
            'sarima_backtest_wape': result['sarima_backtest_wape'],
            'backtest_wape': result.get(
                'backtest_wape',
                result['sarima_backtest_wape'],
            ),
            'chronos_p10': result['chronos_p10'],
            'chronos_p50': result['chronos_p50'],
            'chronos_p90': result['chronos_p90'],
            'chronos_wape': result['chronos_wape'],
            'interval_sharpness': result['interval_sharpness'],
            'historical_data': result['historical_data'],
            'holdout_data': result.get('holdout_data', []),
            'holdout_dates': result.get('holdout_dates', []),
            'forecast_dates': result['forecast_dates'],
            'data_stats': result['data_stats'],
            'sarima_mean_mw': result.get('sarima_mean_mw', 0.0),
            'chronos_mean_mw': result.get('chronos_mean_mw', 0.0),
            'seasonality_regime': result['seasonality_regime'],
            'variance_report': result['variance_report'],
            'trading_mandate': result['trading_mandate'],
            'mandate_narrative': result['mandate_narrative'],
            'analysis_findings': result['analysis_findings'],
            'graph_execution_trace': result['graph_execution_trace'],
            'pipeline_start_ts': result['pipeline_start_ts'],
            'pipeline_end_ts': datetime.now(timezone.utc).isoformat(),
            'retrieved_events': result.get('retrieved_events', []),
            'anomaly_severity_score': result.get('anomaly_severity_score', 0.0),
            'seasonal_demand_pattern': result.get('seasonal_demand_pattern', ''),
            'max_ramp_up_mw': result.get('max_ramp_up_mw', 0.0),
            'max_ramp_down_mw': result.get('max_ramp_down_mw', 0.0),
            'mean_ramp_mw': result.get('mean_ramp_mw', 0.0),
            'base_load_mw': result.get('base_load_mw', 0.0),
            'weather_sensitive_mw': result.get('weather_sensitive_mw', 0.0),
            'peak_load_mw': result.get('peak_load_mw', 0.0),
            'demand_volatility_pct': result.get('demand_volatility_pct', 0.0),
            'weekend_effect_pct': result.get('weekend_effect_pct', 0.0),
            'forecast_heatmap': result.get('forecast_heatmap', []),
            'variance_magnitude_pct': result.get('variance_magnitude_pct', 0.0),
            'divergence_direction': result.get('divergence_direction', ''),
            'downside_var_mw': result.get('downside_var_mw', 0.0),
            'upside_var_mw': result.get('upside_var_mw', 0.0),
            'risk_reward_ratio': result.get('risk_reward_ratio', 0.0),
            'severity_threshold': severity_threshold,
            'forecast_horizon': forecast_horizon,
        }
    except Exception as e:
        logger.error(f'Pipeline task failed: {e}')
        raise self.retry(exc=e, countdown=10)
