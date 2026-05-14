# workflow_schema.py
# Syntx Labs — Workflow Schema
# LOCKED SCHEMA - DO NOT MODIFY
# Version: 1.0

from datetime import datetime, timezone

WORKFLOW_SCHEMA_VERSION = "1.0"

VALID_STEP_TYPES = ["skill", "condition", "ai", "wait"]
VALID_ON_FAILURE = ["retry", "notify_user", "skip", "abort"]


def get_empty_workflow_template(workflow_name: str, description: str = "") -> dict:
    """
    Returns a fresh workflow dict following the locked Syntx schema.
    """
    now = datetime.now(timezone.utc).isoformat()
    return {
        "workflow_name":    workflow_name,
        "version":          WORKFLOW_SCHEMA_VERSION,
        "created":          now,
        "last_modified":    now,
        "description":      description,
        "trigger_phrases":  [],
        "inputs":           [],
        "steps":            [],
        "output": {
            "type":     "string",
            "variable": "final_result"
        }
    }


def build_skill_step(step_id: int, skill_name: str, inputs: dict,
                     output_variable: str, on_failure: str = "notify_user") -> dict:
    """Builds a workflow step that runs a skill."""
    assert on_failure in VALID_ON_FAILURE, f"Invalid on_failure: {on_failure}"
    return {
        "step_id":         step_id,
        "type":            "skill",
        "skill_name":      skill_name,
        "inputs":          inputs,
        "output_variable": output_variable,
        "on_failure":      on_failure
    }


def build_condition_step(step_id: int, condition: str,
                         if_true: int, if_false: int) -> dict:
    """Builds a condition step that branches based on a previous step result."""
    return {
        "step_id":   step_id,
        "type":      "condition",
        "condition": condition,
        "if_true":   if_true,
        "if_false":  if_false
    }


def build_ai_step(step_id: int, prompt: str,
                  output_variable: str, on_failure: str = "notify_user") -> dict:
    """Builds an AI reasoning step inside a workflow."""
    assert on_failure in VALID_ON_FAILURE, f"Invalid on_failure: {on_failure}"
    return {
        "step_id":         step_id,
        "type":            "ai",
        "prompt":          prompt,
        "output_variable": output_variable,
        "on_failure":      on_failure
    }


def build_wait_step(step_id: int, seconds: int) -> dict:
    """Builds a wait step — pauses execution for N seconds."""
    return {
        "step_id": step_id,
        "type":    "wait",
        "seconds": seconds
    }


def build_input(name: str, type: str, required: bool,
                source: str = "user_message") -> dict:
    """Builds a workflow input definition."""
    return {
        "name":     name,
        "type":     type,
        "required": required,
        "source":   source
    }
