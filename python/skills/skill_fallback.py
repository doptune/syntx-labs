import sys
# skill_fallback.py
# Syntx Labs — Fallback System
# Silently resolves capability mismatches before any step runs.
# User never sees this. Skill just works.

from capability_checker import get_system_capabilities as get_capabilities

# ─────────────────────────────────────────────
# Web Task Detector
# ─────────────────────────────────────────────

# Actions that are clearly web-based
_WEB_ACTIONS = {
    "browser_open", "browser_click", "browser_type",
    "browser_find_element", "browser_get_content", "browser_screenshot"
}

# Actions that require VLA
_VLA_ACTIONS = {
    "take_screenshot", "pass_to_vision_model"
}

# Actions that require accessibility API
_ACCESSIBILITY_ACTIONS = {
    "get_accessibility_tree", "find_element_by_name", "find_element_by_role"
}

def _is_vla_step(step: dict) -> bool:
    return step.get("action") in _VLA_ACTIONS

def _is_web_task(step: dict) -> bool:
    return step.get("action") in _WEB_ACTIONS

def _is_accessibility_step(step: dict) -> bool:
    return step.get("action") in _ACCESSIBILITY_ACTIONS


# ─────────────────────────────────────────────
# Step Converters
# ─────────────────────────────────────────────

def _convert_to_accessibility_step(step: dict) -> dict:
    """
    Converts a VLA step into an accessibility API equivalent.
    Used when VLA is unavailable but accessibility API is present.
    """
    converted = dict(step)
    original_action = step.get("action", "")

    # take_screenshot → get_accessibility_tree (read UI without vision)
    if original_action == "take_screenshot":
        converted["action"] = "get_accessibility_tree"
        converted["params"] = []
        converted["_fallback_reason"] = "VLA unavailable — using accessibility tree instead"

    # pass_to_vision_model → find_element_by_name (best we can do without vision)
    elif original_action == "pass_to_vision_model":
        prompt = step.get("params", ["", ""])[1] if len(step.get("params", [])) > 1 else ""
        converted["action"] = "find_element_by_name"
        converted["params"] = [prompt]
        converted["_fallback_reason"] = "VLA unavailable — using element name search instead"

    else:
        converted["_fallback_reason"] = f"VLA unavailable — no direct conversion for '{original_action}'"

    print(f"[Fallback] Step {step.get('step_id','?')}: {original_action} → {converted['action']} (accessibility fallback)", file=sys.stderr)
    return converted


def _convert_to_browser_step(step: dict) -> dict:
    """
    Converts a VLA step into a browser automation equivalent.
    Used when VLA is unavailable but browser automation is present and it's a web task.
    """
    converted = dict(step)
    original_action = step.get("action", "")

    if original_action == "take_screenshot":
        converted["action"] = "browser_screenshot"
        converted["params"] = []
        converted["_fallback_reason"] = "VLA unavailable — using browser screenshot instead"

    elif original_action == "pass_to_vision_model":
        converted["action"] = "browser_get_content"
        converted["params"] = []
        converted["_fallback_reason"] = "VLA unavailable — reading browser content as text instead"

    else:
        converted["_fallback_reason"] = f"VLA unavailable — no browser conversion for '{original_action}'"

    print(f"[Fallback] Step {step.get('step_id','?')}: {original_action} → {converted['action']} (browser fallback)", file=sys.stderr)
    return converted


def _notify_user_step(step: dict, message: str) -> dict:
    """
    Wraps the step as a notify_user failure.
    Executor will catch this and surface the message to the user.
    """
    return {
        "step_id":    step.get("step_id", "?"),
        "type":       "system",
        "action":     "__notify_user__",
        "params":     [message],
        "on_failure": "notify_user",
        "_fallback_reason": message,
        "_unresolvable": True   # signals executor to stop and notify
    }


# ─────────────────────────────────────────────
# Skill-level Requirement Check
# ─────────────────────────────────────────────

def _check_skill_requirements(skill: dict, capabilities: dict) -> list[str]:
    """
    Checks top-level skill requirements against current capabilities.
    Returns a list of warnings (not blockers — steps handle their own fallbacks).
    """
    warnings = []
    requires = skill.get("requires", {})

    if requires.get("internet") and not capabilities.get("internet"):
        warnings.append("Skill requires internet but none detected.")

    if requires.get("browser_automation") and not capabilities.get("browser_automation"):
        warnings.append("Skill requires browser automation but Playwright is unavailable.")

    if requires.get("vla") and not capabilities.get("vla"):
        warnings.append("Skill requires VLA but no vision model is loaded. Fallbacks will be attempted.")

    return warnings


# ─────────────────────────────────────────────
# Core — resolve_fallback
# ─────────────────────────────────────────────

def resolve_fallback(step: dict, capabilities: dict) -> dict:
    """
    Checks if a step can run with current capabilities.
    Silently converts it to the best available alternative if not.
    Returns the original step unchanged if no fallback needed.

    Priority:
      VLA missing → try accessibility API → try browser → notify user
      Browser missing → try accessibility API → notify user
      Accessibility missing → try browser → notify user
    """
    step_type  = step.get("type", "")

    # Only system steps need capability checks
    if step_type != "system":
        return step

    action = step.get("action", "")

    # ── VLA step ─────────────────────────────
    if _is_vla_step(step):
        if capabilities.get("vla"):
            return step  # all good

        if capabilities.get("accessibility_api"):
            return _convert_to_accessibility_step(step)

        if capabilities.get("browser_automation") and _is_web_task(step):
            return _convert_to_browser_step(step)

        return _notify_user_step(
            step,
            f"Step {step.get('step_id','?')} requires a VLA (vision) model. "
            "Please load a vision-capable local model to continue."
        )

    # ── Browser step ─────────────────────────
    if _is_web_task(step):
        if capabilities.get("browser_automation"):
            return step  # all good

        if capabilities.get("accessibility_api"):
            converted = dict(step)
            converted["action"] = "get_accessibility_tree"
            converted["params"] = []
            converted["_fallback_reason"] = "Browser unavailable — using accessibility tree"
            print(f"[Fallback] Step {step.get('step_id','?')}: {action} → get_accessibility_tree (no browser)", file=sys.stderr)
            return converted

        return _notify_user_step(
            step,
            f"Step {step.get('step_id','?')} requires browser automation but Playwright is unavailable. "
            "Install Playwright to continue."
        )

    # ── Accessibility step ────────────────────
    if _is_accessibility_step(step):
        if capabilities.get("accessibility_api"):
            return step  # all good

        if capabilities.get("browser_automation"):
            converted = dict(step)
            converted["action"] = "browser_get_content"
            converted["params"] = []
            converted["_fallback_reason"] = "Accessibility API unavailable — using browser content"
            print(f"[Fallback] Step {step.get('step_id','?')}: {action} → browser_get_content (no AT-SPI)", file=sys.stderr)
            return converted

        return _notify_user_step(
            step,
            f"Step {step.get('step_id','?')} requires the accessibility API (AT-SPI). "
            "Install AT-SPI or enable browser automation as a fallback."
        )

    # ── No fallback needed ────────────────────
    return step


# ─────────────────────────────────────────────
# Pre-execution — resolve all steps upfront
# ─────────────────────────────────────────────

def resolve_all_steps(skill: dict) -> tuple[list[dict], list[str]]:
    """
    Runs resolve_fallback on every step before execution starts.
    Returns (resolved_steps, warnings).
    Call this from execute_skill() before the step loop.
    """
    capabilities = get_capabilities().get("profile", {})
    warnings     = _check_skill_requirements(skill, capabilities)
    resolved     = []

    for step in skill.get("steps", []):
        resolved.append(resolve_fallback(step, capabilities))

    return resolved, warnings
