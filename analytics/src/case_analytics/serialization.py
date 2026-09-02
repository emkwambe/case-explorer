"""JSON serialization helpers.

Metrics legitimately produce NaN (recall on a split with no positives, for example).
`json.dumps` writes those as bare `NaN`, which is invalid JSON and cannot be read by the
JavaScript side (`scripts/update_readme_metrics.js`, the API). Every artifact this package
writes goes through `dump_json` so non-finite values become `null`.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


def json_safe(value: Any) -> Any:
    """Recursively replace non-finite floats with None so the result is strict JSON."""
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else value
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    return value


def dumps(value: Any, indent: int | None = 2) -> str:
    return json.dumps(json_safe(value), indent=indent, default=str, allow_nan=False)


def dump_json(path: str | Path, value: Any, indent: int | None = 2) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(dumps(value, indent=indent), encoding="utf-8")
