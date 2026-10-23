"""Compare a freshly built credit-model snapshot with the committed one.

    python -m case_analytics.credit.compare COMMITTED_DIR FRESH_DIR [--exact]

On the same machine a rerun must be byte-identical (`--exact`). Across machines (the committed snapshot
is built on Windows, CI runs Linux) floating-point results can differ in the last digits, so CI
compares numerically: every number must agree within REL_TOL relative or ABS_TOL absolute, every
integer and string exactly, and the structure exactly. Any excess fails.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

REL_TOL = 1e-3
ABS_TOL = 1e-6
FILES = ("credit-model-summary.json", "credit-model-cases.json", "credit-model-properties.json")


def differences(a: Any, b: Any, path: str = "$") -> list[str]:
    if isinstance(a, bool) or isinstance(b, bool):
        return [] if a == b else [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, int) and isinstance(b, int):
        return [] if a == b else [f"{path}: {a} != {b} (integers must match exactly)"]
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return (
            []
            if math.isclose(a, b, rel_tol=REL_TOL, abs_tol=ABS_TOL)
            else [f"{path}: {a} vs {b} (beyond rel {REL_TOL} / abs {ABS_TOL})"]
        )
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return [f"{path}: keys differ {sorted(set(a) ^ set(b))}"]
        return [d for k in sorted(a) for d in differences(a[k], b[k], f"{path}.{k}")]
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in differences(x, y, f"{path}[{i}]")]
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


def compare(committed: Path, fresh: Path, exact: bool = False) -> list[str]:
    problems: list[str] = []
    for name in FILES:
        left, right = (committed / name).read_bytes(), (fresh / name).read_bytes()
        if exact:
            if left != right:
                problems.append(f"{name}: not byte-identical")
            continue
        problems += [f"{name} {d}" for d in differences(json.loads(left), json.loads(right))]
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("committed", type=Path)
    parser.add_argument("fresh", type=Path)
    parser.add_argument("--exact", action="store_true", help="require byte-identical files (same machine)")
    args = parser.parse_args(argv)
    problems = compare(args.committed, args.fresh, args.exact)
    for p in problems[:50]:
        print(p)
    mode = "byte-identical" if args.exact else f"numerically equal within rel {REL_TOL} / abs {ABS_TOL}"
    print(f"{len(problems)} difference(s); snapshot {'is' if not problems else 'is NOT'} {mode}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
