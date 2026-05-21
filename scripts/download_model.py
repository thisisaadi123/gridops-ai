#!/usr/bin/env python3
"""
Download the finetuned Chronos-PJM model from Hugging Face Hub at container boot.
Run this BEFORE starting the API and Celery worker.

Usage:
    python scripts/download_model.py

Environment variables required:
    HF_MODEL_REPO  — your HF model repo, e.g. "yourusername/chronos-pjm-finetuned"
    HF_TOKEN       — your Hugging Face access token (for private repos)
"""
import os
import sys

def main():
    repo_id = os.environ.get("HF_MODEL_REPO", "")
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_API_TOKEN") or None
    local_dir = "models/chronos-pjm-finetuned"

    if not repo_id:
        print("[download_model] HF_MODEL_REPO not set — skipping model download.")
        print("[download_model] Assuming model already exists at:", local_dir)
        if not os.path.isdir(local_dir):
            print("[download_model] ERROR: Model directory not found. Set HF_MODEL_REPO.", file=sys.stderr)
            sys.exit(1)
        return

    if os.path.isdir(local_dir) and os.listdir(local_dir):
        print(f"[download_model] Model already present at '{local_dir}'. Skipping download.")
        return

    print(f"[download_model] Downloading model from HF Hub: {repo_id} ...")
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=repo_id,
            local_dir=local_dir,
            token=hf_token,
            ignore_patterns=["*.md", "*.txt"],
        )
        print(f"[download_model] Model downloaded to '{local_dir}'.")
    except ImportError:
        print("[download_model] ERROR: huggingface_hub not installed.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[download_model] ERROR downloading model: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
