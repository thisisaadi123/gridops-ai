import time
from locust import HttpUser, task, between, events


@events.init.add_listener
def on_locust_init(environment, **kwargs):
    print("\n" + "=" * 50)
    print("GridOps AI Multi-User Load Test")
    print("Target:          http://localhost:8000")
    print("Flower monitor:  http://localhost:5555")
    print("Watch Celery terminal for concurrent task execution")
    print("=" * 50 + "\n")


class GridOpsStandardUser(HttpUser):
    wait_time = between(10, 20)
    host = "http://localhost:8000"

    @task(1)
    def submit_and_poll(self):
        start_time = time.time()

        # Submit pipeline job
        response = self.client.post(
            "/orchestrate",
            json={"dataset_path": "data_store/pjm_hourly_est.csv"},
        )

        if response.status_code != 202:
            self.environment.events.request.fire(
                request_type="PIPELINE",
                name="full_pipeline_run",
                response_time=0,
                response_length=0,
                exception=Exception(f"Submit failed: {response.status_code}"),
                context={},
            )
            return

        task_id = response.json()["task_id"]

        # Poll until complete or timeout (60 attempts × 3 s = 3 minutes)
        final_status = None
        for attempt in range(60):
            time.sleep(3)
            poll = self.client.get(f"/status/{task_id}")
            data = poll.json()
            status = data.get("status")

            if status == "PROGRESS":
                stage = data.get("stage", "")
                progress = data.get("progress", 0)
                print(f"[{task_id[:8]}] {stage} — {progress}%")

            if status in ("SUCCESS", "FAILURE"):
                final_status = status
                break

        elapsed_ms = (time.time() - start_time) * 1000

        if final_status == "SUCCESS":
            self.environment.events.request.fire(
                request_type="PIPELINE",
                name="full_pipeline_run",
                response_time=elapsed_ms,
                response_length=0,
                exception=None,
                context={},
            )
        else:
            reason = "FAILURE" if final_status == "FAILURE" else "TIMEOUT after 3 minutes"
            self.environment.events.request.fire(
                request_type="PIPELINE",
                name="full_pipeline_run",
                response_time=elapsed_ms,
                response_length=0,
                exception=Exception(f"Pipeline ended with: {reason}"),
                context={},
            )

    @task(4)
    def health_check(self):
        self.client.get("/health")

    @task(2)
    def status_missing_task(self):
        # Confirms the endpoint handles missing task IDs gracefully (must not return 500)
        self.client.get("/status/nonexistent-task-000")


class GridOpsAggressiveUser(GridOpsStandardUser):
    """Submits tasks more frequently to stress-test the Celery queue backlog."""
    wait_time = between(5, 10)


# ─── HOW TO RUN ───────────────────────────────────────────
# Prerequisites: full stack running via scripts/run_dev.sh
#
# Install locust (dev only, not in requirements.txt):
#   pip install locust
#
# Option 1 — Web UI (recommended for screenshots):
#   locust -f locustfile.py
#   Open http://localhost:8089
#   Set users=5, spawn rate=1, host=http://localhost:8000
#
# Option 2 — Headless 3-user test for 3 minutes:
#   locust -f locustfile.py --headless -u 3 -r 1 -t 3m --html load_report.html
#   open load_report.html
#
# What to screenshot for README:
#   1. Locust web UI showing requests/sec chart
#   2. Flower at localhost:5555/tasks showing multiple SUCCESS tasks
#   3. Celery worker terminal showing concurrent task pickup logs
# ──────────────────────────────────────────────────────────
