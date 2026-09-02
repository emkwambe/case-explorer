"""JSON-file model registry with lifecycle states, lineage, separation of duties and immutable audit events."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from case_analytics.serialization import dumps

LIFECYCLE_STATES = (
    "DRAFT",
    "DEVELOPMENT",
    "VALIDATION_PENDING",
    "VALIDATION_FAILED",
    "VALIDATED",
    "APPROVED",
    "CHALLENGER",
    "PRODUCTION",
    "RETIRED",
)

TRANSITIONS: dict[str, tuple[str, ...]] = {
    "DRAFT": ("DEVELOPMENT", "RETIRED"),
    "DEVELOPMENT": ("VALIDATION_PENDING", "RETIRED"),
    "VALIDATION_PENDING": ("VALIDATED", "VALIDATION_FAILED"),
    "VALIDATION_FAILED": ("DEVELOPMENT", "RETIRED"),
    "VALIDATED": ("APPROVED", "DEVELOPMENT", "RETIRED"),
    "APPROVED": ("CHALLENGER", "PRODUCTION", "RETIRED"),
    "CHALLENGER": ("PRODUCTION", "RETIRED"),
    "PRODUCTION": ("RETIRED",),
    "RETIRED": (),
}


class InvalidTransition(ValueError):
    pass


class SeparationOfDutiesViolation(PermissionError):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat()


class ModelRegistry:
    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else None
        self.data: dict[str, Any] = {
            "registry_version": "1.0.0",
            "models": {},
            "model_versions": {},
            "evaluations": [],
            "validation_findings": [],
            "approvals": [],
            "audit_events": [],
        }
        if self.path and self.path.exists():
            self.data = json.loads(self.path.read_text(encoding="utf-8"))

    # ── persistence ──────────────────────────────────────────────────────────
    def save(self) -> None:
        if self.path:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(dumps(self.data), encoding="utf-8")

    def _audit(
        self,
        event_type: str,
        actor: str,
        model_version: str | None,
        previous: str | None,
        new: str | None,
        reason: str,
        **extra: Any,
    ) -> None:
        self.data["audit_events"].append(
            {
                "event_id": len(self.data["audit_events"]) + 1,
                "event_type": event_type,
                "actor": actor,
                "timestamp": _now(),
                "model_version": model_version,
                "previous_state": previous,
                "new_state": new,
                "reason": reason,
                **extra,
            }
        )

    # ── models & versions ───────────────────────────────────────────────────
    def register_model(self, name: str, purpose: str, owner: str, actor: str) -> dict[str, Any]:
        if name not in self.data["models"]:
            self.data["models"][name] = {
                "name": name,
                "purpose": purpose,
                "owner": owner,
                "created_at": _now(),
            }
            self._audit("MODEL_REGISTERED", actor, None, None, None, f"Registered model {name}")
        return self.data["models"][name]

    def register_version(
        self,
        name: str,
        version: str,
        developer: str,
        lineage: dict[str, Any],
        params: dict[str, Any],
        backend: str = "",
        feature_schema_version: str | None = None,
        threshold: float | None = None,
    ) -> str:
        key = f"{name}@{version}"
        if key in self.data["model_versions"]:
            return key
        self.data["model_versions"][key] = {
            "key": key,
            "model": name,
            "version": version,
            "developer": developer,
            "backend": backend,
            "state": "DRAFT",
            "created_at": _now(),
            "lineage": lineage,
            "feature_schema_version": feature_schema_version,
            "params": params,
            "threshold": threshold,
            "threshold_version": "1.0.0" if threshold is not None else None,
            "history": [{"state": "DRAFT", "at": _now(), "actor": developer}],
        }
        self._audit("MODEL_VERSION_CREATED", developer, key, None, "DRAFT", "Version registered")
        return key

    def next_free_version(self, name: str, base_version: str) -> str:
        """Return base_version if unused for this model, else bump the patch number until free.

        A re-run of the pipeline is a new model version; existing versions keep their lifecycle state.
        """
        if f"{name}@{base_version}" not in self.data["model_versions"]:
            return base_version
        parts = base_version.split(".")
        major, minor = parts[0], parts[1] if len(parts) > 1 else "0"
        patch = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
        while f"{name}@{major}.{minor}.{patch}" in self.data["model_versions"]:
            patch += 1
        return f"{major}.{minor}.{patch}"

    def get_version(self, key: str) -> dict[str, Any]:
        try:
            return self.data["model_versions"][key]
        except KeyError as e:
            raise KeyError(f"Unknown model version {key}") from e

    # ── lifecycle ───────────────────────────────────────────────────────────
    def transition(
        self, key: str, new_state: str, actor: str, reason: str, *, override: bool = False
    ) -> dict[str, Any]:
        mv = self.get_version(key)
        current = mv["state"]
        if new_state not in LIFECYCLE_STATES:
            raise InvalidTransition(f"Unknown state {new_state}")
        if new_state not in TRANSITIONS[current]:
            raise InvalidTransition(f"{key}: cannot move {current} -> {new_state}")
        if new_state == "VALIDATED" and actor == mv["developer"]:
            if not override:
                raise SeparationOfDutiesViolation(
                    f"{actor} developed {key} and cannot mark it independently validated without an explicit override"
                )
            if not reason.strip():
                raise SeparationOfDutiesViolation("An override requires a documented reason")
            self._audit("SEGREGATION_OVERRIDE", actor, key, current, new_state, reason)
        mv["state"] = new_state
        mv["history"].append({"state": new_state, "at": _now(), "actor": actor, "reason": reason})
        self._audit("STATE_TRANSITION", actor, key, current, new_state, reason)
        if new_state == "APPROVED":
            self.data["approvals"].append(
                {"model_version": key, "approver": actor, "at": _now(), "reason": reason}
            )
        return mv

    # ── evaluations & findings ──────────────────────────────────────────────
    def record_evaluation(
        self, key: str, split: str, metrics: dict[str, Any], actor: str, report_path: str | None = None
    ) -> None:
        self.get_version(key)
        self.data["evaluations"].append(
            {
                "model_version": key,
                "split": split,
                "metrics": metrics,
                "recorded_at": _now(),
                "report": report_path,
            }
        )
        self._audit("EVALUATION_RECORDED", actor, key, None, None, f"Evaluation on {split}")

    def record_finding(
        self, key: str, severity: str, title: str, detail: str, actor: str, remediation: str = "OPEN"
    ) -> None:
        self.get_version(key)
        self.data["validation_findings"].append(
            {
                "finding_id": len(self.data["validation_findings"]) + 1,
                "model_version": key,
                "severity": severity,
                "title": title,
                "detail": detail,
                "remediation_status": remediation,
                "raised_by": actor,
                "raised_at": _now(),
            }
        )
        self._audit("VALIDATION_FINDING", actor, key, None, None, f"{severity}: {title}")

    def findings_for(self, key: str) -> list[dict[str, Any]]:
        return [f for f in self.data["validation_findings"] if f["model_version"] == key]

    def evaluations_for(self, key: str) -> list[dict[str, Any]]:
        return [e for e in self.data["evaluations"] if e["model_version"] == key]

    def audit_for(self, key: str) -> list[dict[str, Any]]:
        return [e for e in self.data["audit_events"] if e.get("model_version") == key]
