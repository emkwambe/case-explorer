"""Credit-model data: the books written by scripts/export_credit_features.mjs, checked against their manifest.

Books are split by seed, never by row: the training and calibration books come from seeds 1001 and up,
and the locked seed-42 book is the test set. The oracle files (true PD, the corruption label) are loaded
separately and used only to evaluate; :func:`assert_no_leakage` guards every model input.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from case_analytics.features.policy import DEFAULT_POLICY

ROOT = Path(__file__).resolve().parents[4]
DATA_DIR = ROOT / "data" / "credit-model"
TARGET = "dpd30"
ORACLE_COLUMNS = ("p_dpd30_true", "p_dpd30_dealer_averaged", "pd_chargeoff", "fraud_true", "corruption_type")
# Never model inputs: the oracle, identifiers, the book's own bookkeeping, dealer and geography, and
# the two audit attributes the shared feature policy does not list (zip3, regime; see KNOWN_ISSUES).
FORBIDDEN_INPUTS = (
    *ORACLE_COLUMNS,
    "application_id",
    "seed",
    "index",
    "funded",
    "ead",
    TARGET,
    "dealer_id",
    "zip3",
    "regime",
)


class ManifestMismatch(RuntimeError):
    """A data file is missing or does not match its SHA-256 in the manifest."""


@dataclass(frozen=True)
class Spec:
    features: tuple[str, ...]
    monotone: tuple[int, ...]
    groups: dict[str, dict]
    raw: dict


def load_spec(data_dir: Path = DATA_DIR) -> Spec:
    raw = json.loads((data_dir / "feature-spec.json").read_text(encoding="utf-8"))
    feats = tuple(f["name"] for f in raw["features"])
    return Spec(
        features=feats,
        monotone=tuple(int(f["monotone"]) for f in raw["features"]),
        groups=raw["groups"],
        raw=raw,
    )


def load_manifest(data_dir: Path = DATA_DIR) -> dict:
    return json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))


def verify_manifest(data_dir: Path = DATA_DIR) -> dict:
    """Every file named in the manifest exists and hashes to its recorded SHA-256."""
    manifest = load_manifest(data_dir)
    for name, entry in manifest["files"].items():
        path = data_dir / name
        if not path.exists():
            raise ManifestMismatch(f"{name} is missing; run node scripts/export_credit_features.mjs")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != entry["sha256"]:
            raise ManifestMismatch(f"{name}: sha256 {digest} differs from the manifest's {entry['sha256']}")
    return manifest


def assert_no_leakage(columns: list[str] | tuple[str, ...]) -> None:
    """Model inputs share nothing with the oracle, identifiers, dealer ID or sensitive attributes."""
    bad = [c for c in columns if c in FORBIDDEN_INPUTS or DEFAULT_POLICY.classify(c) != "PERMITTED"]
    if bad:
        raise ValueError(f"forbidden model inputs: {', '.join(bad)}")


def _book_path(data_dir: Path, manifest: dict, kind: str, seed: int) -> Path:
    name = f"{kind}-seed-{seed}.csv"
    return data_dir / (name if f"{name}" in manifest["files"] else f"books/{name}")


@dataclass(frozen=True)
class Book:
    seed: int
    role: str
    apps: pd.DataFrame
    oracle: pd.DataFrame


def load_book(seed: int, role: str, data_dir: Path = DATA_DIR, manifest: dict | None = None) -> Book:
    manifest = manifest or load_manifest(data_dir)
    apps = pd.read_csv(_book_path(data_dir, manifest, "applications", seed))
    oracle = pd.read_csv(_book_path(data_dir, manifest, "oracle", seed))
    if not apps["application_id"].equals(oracle["application_id"]):
        raise ValueError(f"seed {seed}: applications and oracle rows are not aligned")
    return Book(seed=seed, role=role, apps=apps, oracle=oracle)


@dataclass(frozen=True)
class Data:
    spec: Spec
    manifest: dict
    training: list[Book]
    calibration: list[Book]
    test: Book

    def frame(self, books: list[Book], *, funded_only: bool = True) -> pd.DataFrame:
        parts = [b.apps.join(b.oracle.drop(columns="application_id")) for b in books]
        df = pd.concat(parts, ignore_index=True)
        return df[df["funded"] == 1].reset_index(drop=True) if funded_only else df

    def X(self, df: pd.DataFrame) -> pd.DataFrame:
        assert_no_leakage(self.spec.features)
        return df.loc[:, list(self.spec.features)].astype(float)

    @staticmethod
    def y(df: pd.DataFrame) -> np.ndarray:
        return df[TARGET].to_numpy(dtype=int)


def load_data(data_dir: Path = DATA_DIR) -> Data:
    manifest = verify_manifest(data_dir)
    seeds = manifest["seeds"]
    test_seed = int(seeds["test"])
    if test_seed in seeds["training"] or test_seed in seeds["calibration"]:
        raise ValueError("the test seed must not be a training or calibration seed")
    return Data(
        spec=load_spec(data_dir),
        manifest=manifest,
        training=[load_book(int(s), "training", data_dir, manifest) for s in seeds["training"]],
        calibration=[load_book(int(s), "calibration", data_dir, manifest) for s in seeds["calibration"]],
        test=load_book(test_seed, "test", data_dir, manifest),
    )
