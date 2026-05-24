import os
import pandas as pd
from autogluon.timeseries import TimeSeriesDataFrame, TimeSeriesPredictor

def main():
    print("Loading PJM dataset...")
    df = pd.read_csv("data_store/pjm_hourly_est.csv")

    # Keep only the target and datetime columns
    df = df[["Datetime", "PJM_Load"]].copy()

    # AutoGluon requires 'item_id' and 'timestamp' columns
    df["item_id"] = "PJM_GRID"
    df.rename(columns={"Datetime": "timestamp", "PJM_Load": "target"}, inplace=True)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    # Convert to AutoGluon TimeSeriesDataFrame
    ts_df = TimeSeriesDataFrame.from_data_frame(
        df,
        id_column="item_id",
        timestamp_column="timestamp",
    )

    # Force regular hourly frequency (PJM data has some DST gaps)
    ts_df = ts_df.convert_frequency(freq="h")

    # Sort chronologically
    ts_df = ts_df.sort_index()

    # We will predict 30 days ahead (720 hours)
    prediction_length = 30 * 24
    train_data, val_data = ts_df.train_test_split(prediction_length)

    print(f"Train data shape:      {train_data.shape}")
    print(f"Validation data shape: {val_data.shape}")

    # Initialize predictor, saving weights to a local folder
    predictor = TimeSeriesPredictor(
        prediction_length=prediction_length,
        target="target",
        eval_metric="WAPE",
        path="models/chronos-pjm-finetuned",
        verbosity=3,  # show training progress and loss
    )

    print("\nStarting fine-tuning of Chronos-T5-Base on MPS GPU...")
    predictor.fit(
        train_data,
        hyperparameters={
            "Chronos": {
                # 200M-parameter model – maximum capacity, requires strict regularization to prevent overfitting
                "model_path": "amazon/chronos-t5-base",
                "fine_tune": True,
                # --- GPU + Memory settings ---
                "device": "mps",              # Apple Silicon GPU acceleration
                "context_length": 512,    
                "batch_size": 2,              # Inference batch size
                "fine_tune_batch_size": 1,    # ABSOLUTE MINIMUM batch to fit 200M model in 8GB RAM
                # --- Anti-Overfitting Training settings ---
                "fine_tune_steps": 5000,      # Train for 5000 steps to properly learn the PJM patterns
                "fine_tune_lr": 1e-5,         # Smaller learning rate for a longer training run
                # Force non-fused optimizer (fused AdamW requires CUDA, not MPS)
                "fine_tune_trainer_kwargs": {
                    "optim": "adamw_torch",
                    "gradient_accumulation_steps": 8,  # Simulates a batch size of 8 while only using RAM for 1
                    "disable_tqdm": False,      # Show progress bar
                    "logging_steps": 50,        # Print loss every 50 steps
                },
            }
        },
        enable_ensemble=False,
    )

    print("\nEvaluating fine-tuned model on the hold-out validation set...")
    results = predictor.evaluate(val_data)
    print(results)

    print("\n✅ Training complete! Fine-tuned weights saved to: models/chronos-pjm-finetuned")

if __name__ == "__main__":
    main()
