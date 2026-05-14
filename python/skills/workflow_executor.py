# workflow_executor.py
# Syntx Labs — Workflow Executor
# Runs workflows step by step, executing skills in sequence with conditions

import sys
import time
import re
from typing import Any, Optional

# ─────────────────────────────────────────────
# Variable Resolver
# ─────────────────────────────────────────────

def _resolve(value: Any, context: dict) -> Any:
    """Recursively replaces {{var}} references in strings, lists, dicts."""
    if isinstance(value, str):
        def replacer(match):
            key = match.group(1)
            val = context.get(key, match.group(0))
            return str(val)
        return re.sub(r"\{\{(\w+)\}\}", replacer, value)
    elif isinstance(value, list):
        return [_resolve(v, context) for v in value]
    elif isinstance(value, dict):
        return {k: _resolve(v, context) for k, v in value.items()}
    return value


# ─────────────────────────────────────────────
# Result Builder
# ─────────────────────────────────────────────

def _make_result(success: bool, message: str,
                 context: dict, steps_run: list) -> dict:
    return {
        "success":   success,
        "message":   message,
        "context":   context,
        "steps_run": steps_run
    }


# ─────────────────────────────────────────────
# Skill Step Runner
# ─────────────────────────────────────────────

def _run_skill_step(step: dict, context: dict,
                    model_bridge=None) -> dict:
    """
    Runs a single skill step inside a workflow.
    Loads the skill and executes it using skill_executor.
    """
    from skill_loader import load_skill
    from skill_executor import execute_skill

    skill_name = _resolve(step.get("skill_name", ""), context)
    raw_inputs = step.get("inputs", {})
    inputs     = _resolve(raw_inputs, context)

    skill = load_skill(skill_name)
    if skill is None:
        return {
            "success": False,
            "error":   f"Skill '{skill_name}' not found."
        }

    result = execute_skill(skill, inputs, model_bridge=model_bridge)

    if result.get("success"):
        out_var = step.get("output_variable", f"step_{step['step_id']}_result")
        context[out_var]                              = result.get("message", "")
        context[f"step_{step['step_id']}_success"]   = True
        context[f"{skill_name}_result"]               = result.get("message", "")
        return {"success": True, "result": result}
    else:
        context[f"step_{step['step_id']}_success"] = False
        return {
            "success": False,
            "error":   result.get("message", "Skill failed")
        }


# ─────────────────────────────────────────────
# Condition Step Runner
# ─────────────────────────────────────────────

def _run_condition_step(step: dict, context: dict) -> dict:
    """
    Evaluates a condition and returns the next step_id to jump to.
    Condition format: "step_1_success", "step_2_success", etc.
    """
    condition = _resolve(step.get("condition", ""), context)

    try:
        # Simple boolean check from context
        if condition in context:
            passed = bool(context[condition])
        else:
            # Try eval for complex conditions
            passed = eval(condition, {"__builtins__": {}}, context)

        next_step = step.get("if_true") if passed else step.get("if_false")
        context[f"step_{step['step_id']}_branch"] = next_step

        return {
            "success":   True,
            "passed":    passed,
            "next_step": next_step
        }

    except Exception as e:
        return {
            "success": False,
            "error":   f"Condition eval failed: {e}"
        }


# ─────────────────────────────────────────────
# AI Step Runner
# ─────────────────────────────────────────────

def _run_ai_step(step: dict, context: dict,
                 model_bridge=None) -> dict:
    """Runs an AI reasoning step inside a workflow."""
    prompt = _resolve(step.get("prompt", ""), context)

    if len(prompt) > 4000:
        prompt = prompt[:4000] + "\n\n[Content truncated]"

    prompt += "\n\nIMPORTANT: Output ONLY the requested content."

    if model_bridge is None:
        return {
            "success":  True,
            "response": f"[MODEL NOT CONNECTED] Prompt: {prompt}"
        }

    try:
        response = model_bridge(prompt)
        import re as _re
        response = _re.sub(r'^```[\w]*\n', '', response.strip())
        response = _re.sub(r'\n```$', '', response.strip())
        return {"success": True, "response": response.strip()}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Wait Step Runner
# ─────────────────────────────────────────────

def _run_wait_step(step: dict) -> dict:
    """Pauses execution for N seconds."""
    seconds = step.get("seconds", 1)
    time.sleep(seconds)
    return {"success": True, "waited": seconds}


# ─────────────────────────────────────────────
# Failure Handler
# ─────────────────────────────────────────────

def _handle_failure(step: dict, error: str, attempt: int) -> str:
    on_failure  = step.get("on_failure", "notify_user")
    retry_limit = step.get("retry_limit", 3)

    if on_failure == "retry" and attempt < retry_limit:
        return "retry"
    elif on_failure == "retry" and attempt >= retry_limit:
        return "notify_user"
    return on_failure


# ─────────────────────────────────────────────
# Main Executor
# ─────────────────────────────────────────────

def execute_workflow(workflow: dict, user_inputs: dict,
                     model_bridge=None) -> dict:
    """
    Runs a full workflow from start to finish.

    Args:
        workflow:     Full workflow dict (from workflow_loader).
        user_inputs:  { "topic": "AI", ... } — user-provided values.
        model_bridge: callable(prompt: str) -> str — local model interface.

    Returns:
        {
            "success":   True/False,
            "message":   "...",
            "context":   { all variables after execution },
            "steps_run": [ { step_id, status, error } ]
        }
    """
    steps_run = []
    context   = {}

    # ── Build initial context from user inputs ────
    for inp in workflow.get("inputs", []):
        name     = inp.get("name")
        required = inp.get("required", False)
        value    = user_inputs.get(name)
        if required and value is None:
            return _make_result(
                False,
                f"Missing required input: '{name}'",
                context,
                steps_run
            )
        if value is not None:
            context[name] = value

    # ── Build step index for condition jumping ────
    steps     = workflow.get("steps", [])
    step_map  = {s["step_id"]: s for s in steps}
    step_ids  = [s["step_id"] for s in steps]

    # ── Run steps ─────────────────────────────────
    current_idx = 0

    while current_idx < len(step_ids):
        step_id = step_ids[current_idx]
        step    = step_map.get(step_id)

        if step is None:
            break

        step_type = step.get("type", "")
        attempt   = 0

        print(f"[WorkflowExecutor] Running step {step_id} — type: {step_type}", file=sys.stderr)

        # ── Condition step ────────────────────────
        if step_type == "condition":
            result = _run_condition_step(step, context)
            steps_run.append({
                "step_id": step_id,
                "status":  "ok" if result["success"] else "error",
                "error":   result.get("error")
            })

            if result["success"]:
                next_id = result.get("next_step")
                if next_id and next_id in step_map:
                    current_idx = step_ids.index(next_id)
                else:
                    current_idx += 1
            else:
                return _make_result(
                    False,
                    f"Condition step {step_id} failed: {result.get('error')}",
                    context,
                    steps_run
                )
            continue

        # ── Wait step ─────────────────────────────
        if step_type == "wait":
            _run_wait_step(step)
            steps_run.append({"step_id": step_id, "status": "ok", "error": None})
            current_idx += 1
            continue

        # ── Skill + AI steps with retry ───────────
        while True:
            attempt += 1
            error   = None
            result  = {}

            if step_type == "skill":
                result = _run_skill_step(step, context, model_bridge)
                if not result.get("success"):
                    error = result.get("error", "Skill step failed")

            elif step_type == "ai":
                result = _run_ai_step(step, context, model_bridge)
                if result.get("success"):
                    out_var = step.get("output_variable",
                                       f"step_{step_id}_result")
                    context[out_var] = result.get("response", "")
                else:
                    error = result.get("error", "AI step failed")

            else:
                error = f"Unknown step type: '{step_type}'"

            # ── Success ───────────────────────────
            if error is None:
                steps_run.append({
                    "step_id": step_id,
                    "status":  "ok",
                    "error":   None
                })
                break

            # ── Failure ───────────────────────────
            decision = _handle_failure(step, error, attempt)

            if decision == "retry":
                print(f"[WorkflowExecutor] Step {step_id} failed (attempt {attempt}). Retrying...", file=sys.stderr)
                time.sleep(0.5 * attempt)
                continue

            steps_run.append({
                "step_id": step_id,
                "status":  decision,
                "error":   error
            })

            if decision == "notify_user":
                return _make_result(
                    False,
                    f"Step {step_id} failed: {error}",
                    context,
                    steps_run
                )

            if decision == "abort":
                return _make_result(
                    False,
                    f"Workflow aborted at step {step_id}: {error}",
                    context,
                    steps_run
                )

            break  # skip

        current_idx += 1

    # ── Collect final output ──────────────────────
    out_var = workflow.get("output", {}).get("variable", "final_result")
    final   = context.get(out_var, "Workflow completed.")

    return _make_result(True, str(final), context, steps_run)
