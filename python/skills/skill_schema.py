# skill_schema.py
# LOCKED SCHEMA - DO NOT MODIFY
# Version: 1.0 | Syntx Labs

from datetime import datetime, timezone

SKILL_SCHEMA_VERSION = "1.0"

def get_empty_skill_template(skill_name: str, description: str = "") -> dict:
    """
    Returns a fresh skill dict following the locked Syntx schema.
    Use this as the single source of truth when creating any new skill.
    """
    now = datetime.now(timezone.utc).isoformat()

    return {
        "skill_name": skill_name,
        "version": SKILL_SCHEMA_VERSION,
        "created": now,
        "last_modified": now,
        "description": description,
        "trigger_phrases": [],
        "requires": {
            "vla": False,
            "browser_automation": False,
            "accessibility_api": False,
            "internet": False,
            "knowledge_access": []
        },
        "inputs": [],
        "steps": [],
        "output": {
            "type": "string",
            "variable": "final_result"
        },
        "fallback": {
            "no_vla": "use_accessibility_api",
            "no_browser": "use_accessibility_api",
            "no_internet": "notify_user",
            "general_failure": "notify_user"
        }
    }


# --- Field reference docs (for validation use) ---

VALID_INPUT_TYPES = ["string", "integer", "boolean", "list", "dict"]

VALID_INPUT_SOURCES = ["user_message", "system", "previous_step", "knowledge_base"]

VALID_STEP_TYPES = ["system", "ai", "condition", "loop", "knowledge_read", "knowledge_write"]

VALID_ON_FAILURE = ["retry", "notify_user", "skip", "abort", "fallback"]

VALID_FALLBACK_ACTIONS = ["use_accessibility_api", "notify_user", "skip", "abort"]

VALID_OUTPUT_TYPES = ["string", "integer", "boolean", "list", "dict", "none"]


# --- Input block builder ---

def build_input(name: str, type: str, required: bool, source: str) -> dict:
    """Helper to build a valid input block."""
    assert type in VALID_INPUT_TYPES, f"Invalid input type: {type}"
    assert source in VALID_INPUT_SOURCES, f"Invalid source: {source}"
    return {
        "name": name,
        "type": type,
        "required": required,
        "source": source
    }


# --- Step block builders ---

def build_system_step(step_id: int, action: str, params: list,
                      on_failure: str = "notify_user", retry_limit: int = 3) -> dict:
    """Helper to build a system action step."""
    assert on_failure in VALID_ON_FAILURE, f"Invalid on_failure: {on_failure}"
    return {
        "step_id": step_id,
        "type": "system",
        "action": action,
        "params": params,
        "on_failure": on_failure,
        "retry_limit": retry_limit
    }


def build_ai_step(step_id: int, prompt: str, output_variable: str,
                  on_failure: str = "notify_user") -> dict:
    """Helper to build a local AI reasoning step."""
    assert on_failure in VALID_ON_FAILURE, f"Invalid on_failure: {on_failure}"
    return {
        "step_id": step_id,
        "type": "ai",
        "prompt": prompt,
        "output_variable": output_variable,
        "on_failure": on_failure
    }


def build_condition_step(step_id: int, condition: str,
                         if_true: str, if_false: str) -> dict:
    """Helper to build a conditional branching step."""
    return {
        "step_id": step_id,
        "type": "condition",
        "condition": condition,
        "if_true": if_true,
        "if_false": if_false
    }


def build_knowledge_read_step(step_id: int, knowledge_path: str,
                               output_variable: str, on_failure: str = "notify_user") -> dict:
    """Helper to build a knowledge base read step."""
    assert on_failure in VALID_ON_FAILURE, f"Invalid on_failure: {on_failure}"
    return {
        "step_id": step_id,
        "type": "knowledge_read",
        "knowledge_path": knowledge_path,
        "output_variable": output_variable,
        "on_failure": on_failure
    }
