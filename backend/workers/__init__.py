"""backend/workers — resident worker processes for the Redis job store.

Run with:
    python -m workers.worker_main --role gpu --slots 1 --worker-id gpu-1
    python -m workers.worker_main --role cpu --slots 4 --worker-id cpu-1
    python -m workers.worker_main --role choras --slots 1 --worker-id choras-1
"""
