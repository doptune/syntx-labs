import sys
# skill_validator.py
# Syntx Labs — Skill Validator
# Validates skill JSON before saving. Single source of truth for correctness.

from skill_schema import (
    SKILL_SCHEMA_VERSION,
    VALID_INPUT_TYPES,
    VALID_INPUT_SOURCES,
    VALID_STEP_TYPES,
    VALID_ON_FAILURE,
    VALID_FALLBACK_ACTIONS,
    VALID_OUTPUT_TYPES
)

# Import action_library to cross-check system actions
# Bro — tell me if action_library exposes a different function for this!
try:
    from action_library import get_all_actions
    ACTION_LIBRARY_AVAILABLE = True
except ImportError:
    print("[Validator] Warning: action_library not found. Skipping action existence checks.", file=sys.stderr)
    ACTION_LIBRARY_AVAILABLE = False


# ─────────────────────────────────────────────
# Internal result builder
# ─────────────────────────────────────────────

def _result(errors: list, warnings: list) -> dict:
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings
    }


# ─────────────────────────────────────────────
# 1. Schema — required fields exist
# ─────────────────────────────────────────────

REQUIRED_TOP_LEVEL = [
    "skill_name", "version", "created", "last_modified",
    "description", "trigger_phrases", "requires",
    "inputs", "steps", "output", "fallback"
]

REQUIRED_REQUIRES_FIELDS = [
    "vla", "browser_automation", "accessibility_api", "internet", "knowledge_access"
]

REQUIRED_OUTPUT_FIELDS = ["type", "variable"]

REQUIRED_FALLBACK_KEYS = [
    "no_vla", "no_browser", "no_internet", "general_failure"
]

def validate_skill_schema(skill_json: dict) -> dict:
    """Checks all required top-level and nested fields exist with correct types."""
    errors = []
    warnings = []

    # Top level fields
    for field in REQUIRED_TOP_LEVEL:
        if field not in skill_json:
            errors.append(f"Missing required field: '{field}'")

    if errors:
        return _result(errors, warnings)

    # skill_name
    if not isinstance(skill_json["skill_name"], str) or not skill_json["skill_name"].strip():
        errors.append("'skill_name' must be a non-empty string.")

    # version
    if skill_json["version"] != SKILL_SCHEMA_VERSION:
        warnings.append(f"'version' is '{skill_json['version']}', expected '{SKILL_SCHEMA_VERSION}'. May cause compatibility issues.")

    # description
    if not isinstance(skill_json["description"], str):
        errors.append("'description' must be a string.")
    elif len(skill_json["description"].strip()) == 0:
        warnings.append("'description' is empty. Recommended to describe what the skill does.")

    # trigger_phrases
    if not isinstance(skill_json["trigger_phrases"], list):
        errors.append("'trigger_phrases' must be a list.")
    elif len(skill_json["trigger_phrases"]) == 0:
        warnings.append("'trigger_phrases' is empty. Skill won't be triggered automatically.")
    else:
        for i, phrase in enumerate(skill_json["trigger_phrases"]):
            if not isinstance(phrase, str):
                errors.append(f"'trigger_phrases[{i}]' must be a string, got {type(phrase).__name__}.")

    # requires block
    if not isinstance(skill_json["requires"], dict):
        errors.append("'requires' must be a dict.")
    else:
        for field in REQUIRED_REQUIRES_FIELDS:
            if field not in skill_json["requires"]:
                errors.append(f"'requires' is missing field: '{field}'")

    # inputs
    if not isinstance(skill_json["inputs"], list):
        errors.append("'inputs' must be a list.")

    # steps
    if not isinstance(skill_json["steps"], list):
        errors.append("'steps' must be a list.")
    elif len(skill_json["steps"]) == 0:
        warnings.append("'steps' is empty. Skill does nothing.")

    # output
    if not isinstance(skill_json["output"], dict):
        errors.append("'output' must be a dict.")
    else:
        for field in REQUIRED_OUTPUT_FIELDS:
            if field not in skill_json["output"]:
                errors.append(f"'output' is missing field: '{field}'")

    # fallback
    if not isinstance(skill_json["fallback"], dict):
        errors.append("'fallback' must be a dict.")
    else:
        for key in REQUIRED_FALLBACK_KEYS:
            if key not in skill_json["fallback"]:
                errors.append(f"'fallback' is missing key: '{key}'")

    return _result(errors, warnings)


# ─────────────────────────────────────────────
# 2. Actions — every system action exists in library
# ─────────────────────────────────────────────

def validate_actions_exist(skill_json: dict) -> dict:
    """Checks every system step's action exists in action_library."""
    errors = []
    warnings = []

    steps = skill_json.get("steps", [])
    if not isinstance(steps, list):
        return _result(["'steps' is not a list. Cannot validate actions."], warnings)

    if not ACTION_LIBRARY_AVAILABLE:
        warnings.append("action_library unavailable. System action existence not checked.")
        return _result(errors, warnings)

    available_actions = get_all_actions()  # expects a list or dict of action names

    # normalize to a set of strings
    if isinstance(available_actions, dict):
        action_names = set(available_actions.keys())
    elif isinstance(available_actions, list):
        action_names = set(available_actions)
    else:
        warnings.append("action_library.get_all_actions() returned unexpected type. Skipping check.")
        return _result(errors, warnings)

    for step in steps:
        if not isinstance(step, dict):
            continue
        if step.get("type") == "system":
            action = step.get("action")
            if not action:
                errors.append(f"Step {step.get('step_id', '?')} is type 'system' but missing 'action' field.")
            elif action not in action_names:
                errors.append(f"Step {step.get('step_id', '?')}: action '{action}' not found in action_library.")

    return _result(errors, warnings)


# ─────────────────────────────────────────────
# 3. Params — all params correctly formatted
# ─────────────────────────────────────────────

def validate_params(skill_json: dict) -> dict:
    """
    Checks params in system steps are lists.
    Checks {{variable}} references exist as defined inputs or output_variables
    from prior steps.
    """
    errors = []
    warnings = []

    steps = skill_json.get("steps", [])
    inputs = skill_json.get("inputs", [])

    if not isinstance(steps, list):
        return _result(["'steps' is not a list. Cannot validate params."], warnings)

    # Build set of known variable names from inputs
    known_vars = set()
    if isinstance(inputs, list):
        for inp in inputs:
            if isinstance(inp, dict) and inp.get("name"):
                known_vars.add(inp["name"])

    # Add output variables from all steps as known vars
    for step in steps:
        if isinstance(step, dict):
            out_var = step.get("output_variable")
            if out_var:
                known_vars.add(out_var)
            # Also add auto-generated result vars
            step_id = step.get("step_id")
            if step_id:
                known_vars.add(f"step_{step_id}_result")
                known_vars.add(f"step_{step_id}_response")

    for step in steps:
        if not isinstance(step, dict):
            continue

        step_id = step.get("step_id", "?")

        if step.get("type") == "system":
            params = step.get("params", [])
            if not isinstance(params, list):
                errors.append(f"Step {step_id}: 'params' must be a list.")
            else:
                for param in params:
                    if isinstance(param, str):
                        # check {{var}} references
                        refs = _extract_template_vars(param)
                        for ref in refs:
                            if ref not in known_vars:
                                warnings.append(
                                    f"Step {step_id}: param references '{{{{ {ref} }}}}' "
                                    f"which is not defined in inputs or prior steps."
                                )

        if step.get("type") == "ai":
            prompt = step.get("prompt", "")
            if isinstance(prompt, str):
                refs = _extract_template_vars(prompt)
                for ref in refs:
                    if ref not in known_vars:
                        warnings.append(
                            f"Step {step_id}: prompt references '{{{{ {ref} }}}}' "
                            f"which is not defined in inputs or prior steps."
                        )

            # register output_variable for downstream steps
            out_var = step.get("output_variable")
            if out_var:
                known_vars.add(out_var)

    return _result(errors, warnings)


def _extract_template_vars(text: str) -> list[str]:
    """Extracts variable names from {{var_name}} style templates."""
    import re
    return re.findall(r"\{\{(\w+)\}\}", text)


# ─────────────────────────────────────────────
# 4. Requirements — requires fields are valid
# ─────────────────────────────────────────────

def validate_requirements(skill_json: dict) -> dict:
    """Checks requires block fields have correct types and values."""
    errors = []
    warnings = []

    requires = skill_json.get("requires", {})
    if not isinstance(requires, dict):
        return _result(["'requires' must be a dict."], warnings)

    # Boolean fields
    bool_fields = ["vla", "browser_automation", "accessibility_api", "internet"]
    for field in bool_fields:
        val = requires.get(field)
        if val is None:
            errors.append(f"'requires.{field}' is missing.")
        elif not isinstance(val, bool):
            errors.append(f"'requires.{field}' must be a boolean, got {type(val).__name__}.")

    # knowledge_access — must be a list of strings
    ka = requires.get("knowledge_access")
    if ka is None:
        errors.append("'requires.knowledge_access' is missing.")
    elif not isinstance(ka, list):
        errors.append("'requires.knowledge_access' must be a list.")
    else:
        for i, path in enumerate(ka):
            if not isinstance(path, str):
                errors.append(f"'requires.knowledge_access[{i}]' must be a string, got {type(path).__name__}.")

    # Warn if vla + accessibility_api both false but steps use system actions
    steps = skill_json.get("steps", [])
    has_system_steps = any(
        isinstance(s, dict) and s.get("type") == "system"
        for s in steps
    )
    if has_system_steps and not requires.get("vla") and not requires.get("accessibility_api") and not requires.get("browser_automation"):
        warnings.append(
            "Skill has system steps but both 'vla' and 'accessibility_api' are False. "
            "System actions may fail at runtime."
        )
    return _result(errors, warnings)


# ─────────────────────────────────────────────
# 5. Fallbacks — fallback actions exist
# ─────────────────────────────────────────────

def validate_fallbacks(skill_json: dict) -> dict:
    """Checks fallback values are valid known actions."""
    errors = []
    warnings = []

    fallback = skill_json.get("fallback", {})
    if not isinstance(fallback, dict):
        return _result(["'fallback' must be a dict."], warnings)

    for key, value in fallback.items():
        if not isinstance(value, str):
            errors.append(f"'fallback.{key}' must be a string, got {type(value).__name__}.")
        elif value not in VALID_FALLBACK_ACTIONS:
            errors.append(
                f"'fallback.{key}' has invalid action '{value}'. "
                f"Valid options: {VALID_FALLBACK_ACTIONS}"
            )

    # Also validate on_failure fields inside every step
    steps = skill_json.get("steps", [])
    for step in steps:
        if not isinstance(step, dict):
            continue
        step_id = step.get("step_id", "?")
        on_failure = step.get("on_failure")
        if on_failure and on_failure not in VALID_ON_FAILURE:
            errors.append(
                f"Step {step_id}: 'on_failure' value '{on_failure}' is invalid. "
                f"Valid options: {VALID_ON_FAILURE}"
            )

    return _result(errors, warnings)


# ─────────────────────────────────────────────
# 6. Full validation runner
# ─────────────────────────────────────────────

def run_full_validation(skill_json: dict) -> dict:
    """
    Runs all validators in order.
    Returns a single combined result with all errors and warnings.
    Stops early if schema is broken (nothing else can run cleanly).
    """
    all_errors = []
    all_warnings = []

    validators = [
        ("Schema",       validate_skill_schema),
        ("Requirements", validate_requirements),
        ("Actions",      validate_actions_exist),
        ("Params",       validate_params),
        ("Fallbacks",    validate_fallbacks),
    ]

    for name, validator_fn in validators:
        result = validator_fn(skill_json)
        all_errors.extend(result["errors"])
        all_warnings.extend(result["warnings"])

        # If schema itself is broken, stop here
        # Other validators will crash or give nonsense results
        if name == "Schema" and not result["valid"]:
            all_warnings.append(
                "Validation stopped early — fix schema errors before other checks can run."
            )
            break

    return {
        "valid": len(all_errors) == 0,
        "errors": all_errors,
        "warnings": all_warnings
    }
    