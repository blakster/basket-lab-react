"""Benchmark ensure_filings fetch scheduling with a stubbed fixed-latency fetch.

Usage (from apps/api):
    .venv/bin/python bench_ensure.py [--latency 0.25] [--reps 5]

Each rep uses a fresh SQLite database where every scheme is pending, and the
stubbed fetch sleeps a fixed latency to mimic a slow Foliyo call. Times
ensure_filings end to end (fetch + persist + status recording).
"""

from __future__ import annotations

import argparse
import statistics
import tempfile
import time
from pathlib import Path

from app.db import init_db
from app.ingest.ensure import ensure_filings

LATENCY = 0.25
REPS = 5
SIZES = (1, 3, 8)


def _payload() -> dict:
    return {
        "overview": {"fund_house": "Bench AMC"},
        "holdings": {
            "as_of": "2026-09-30",
            "items": [{"name": "HDFC Bank Ltd", "weight_pct": 7.75}],
        },
    }


def _stub_fetch(latency: float):
    def fetch(_code: str) -> dict:
        time.sleep(latency)
        return _payload()

    return fetch


def _codes(count: int) -> list[str]:
    return [f"{100000 + i * 137:06d}" for i in range(count)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latency", type=float, default=LATENCY)
    parser.add_argument("--reps", type=int, default=REPS)
    args = parser.parse_args()

    print(f"stub fetch latency: {args.latency * 1000:.0f} ms, {args.reps} reps per size")
    print(f"{'pending':>7} | {'median s':>9} | {'min s':>9} | {'max s':>9} | all reps (s)")
    for size in SIZES:
        codes = _codes(size)
        times: list[float] = []
        for _ in range(args.reps):
            with tempfile.TemporaryDirectory() as tmp:
                conn = init_db(Path(tmp) / "basket.sqlite")
                start = time.perf_counter()
                ensure_filings(conn, codes, fetch=_stub_fetch(args.latency))
                times.append(time.perf_counter() - start)
                conn.close()
        reps = " ".join(f"{t:.3f}" for t in times)
        print(
            f"{size:>7} | {statistics.median(times):>9.3f} | "
            f"{min(times):>9.3f} | {max(times):>9.3f} | {reps}"
        )


if __name__ == "__main__":
    main()
