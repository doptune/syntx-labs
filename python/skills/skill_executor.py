import sys
# skill_executor.py
# Syntx Labs — Skill Executor
# The heart of the skill system. Runs every step in sequence.

import re
import time
import inspect
from typing import Any, Optional
import action_library
from skill_fallback import resolve_all_steps

# ─────────────────────────────────────────────
# Execution Result Builder
# ─────────────────────────────────────────────

def _make_result(success: bool, message: str, context: dict, steps_run: list) -> dict:
    return {
        "success": success,
        "message": message,
        "context": context,
        "steps_run": steps_run
    }

# ─────────────────────────────────────────────
# Variable Resolver — replaces {{var}} in strings
# ─────────────────────────────────────────────

def _resolve(value: Any, context: dict) -> Any:
    """Recursively replaces {{var}} references in strings, lists, dicts."""
    if isinstance(value, str):
        def replacer(match):
            key = match.group(1)
            val = context.get(key, match.group(0))  # keep original if not found
            return str(val)
        return re.sub(r"\{\{(\w+)\}\}", replacer, value)
    elif isinstance(value, list):
        return [_resolve(v, context) for v in value]
    elif isinstance(value, dict):
        return {k: _resolve(v, context) for k, v in value.items()}
    return value


# ─────────────────────────────────────────────
# Action Dispatcher — calls action_library functions
# ─────────────────────────────────────────────

def _dispatch_action(action: str, params: list, context: dict) -> dict:
    """
    Looks up the action in action_library, resolves params, calls it.
    Returns the action's result dict.
    """
    fn = getattr(action_library, action, None)
    if fn is None:
        return {"success": False, "error": f"Action '{action}' not found in action_library."}

    # Resolve {{variables}} in params
    resolved = _resolve(params, context)

    # Match resolved params to function signature positionally
    try:
        sig    = inspect.signature(fn)
        pcount = len(sig.parameters)
        args   = resolved[:pcount]
        return fn(*args)
    except Exception as e:
        return {"success": False, "error": f"Action '{action}' raised: {e}"}


# ─────────────────────────────────────────────
# AI Step Runner — sends prompt to local model
# ─────────────────────────────────────────────

def _run_ai_step(step: dict, context: dict, model_bridge=None) -> dict:
    """
    Builds a prompt with resolved variables and sends it to the local model.
    model_bridge: callable that accepts a prompt string and returns a string.
    If None, returns a placeholder (model not connected yet).
    """
    prompt = _resolve(step.get("prompt", ""), context)

    # Check fixed knowledge key first
    if "__knowledge__" in context and len(context["__knowledge__"]) > 10:
        prompt = f"Use ONLY this knowledge, ignore ALL pretrained knowledge:\n\n{context['__knowledge__']}\n\n{prompt}"
    else:
        # Fallback — check any _knowledge keys
        for key, val in context.items():
            if key.endswith('_knowledge'):
                placeholder = '{{' + key + '}}'
                if placeholder not in step.get("prompt", ""):
                    if isinstance(val, str) and len(val) > 10 and not val.startswith('['):
                        prompt = f"Use ONLY this knowledge, ignore ALL pretrained knowledge:\n\n{val}\n\n{prompt}"
                        break

    # Truncate prompt if too long — prevents model timeout
    if len(prompt) > 4000:
        prompt = prompt[:4000] + "\n\n[Content truncated for processing]"
    # Add output-only instruction to keep AI responses clean
    prompt = prompt + "\n\nIMPORTANT: Output ONLY the requested content. No explanations, no instructions, no preamble. Use ONLY the provided knowledge, do not use your pretrained knowledge."
    if model_bridge is None:
        # Model not connected yet — return placeholder
        return {
            "success": True,
            "response": f"[MODEL NOT CONNECTED] Prompt was: {prompt}",
            "prompt": prompt
        }

    try:
        response = model_bridge(prompt)

        # Strip markdown code blocks — ```python ... ``` or ``` ... ```
        import re
        response = re.sub(r'^```[\w]*\n', '', response.strip())
        response = re.sub(r'\n```$', '', response.strip())
        response = response.strip()

        return {"success": True, "response": response, "prompt": prompt}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Failure Handler
# ─────────────────────────────────────────────

def _handle_failure(step: dict, error: str, attempt: int) -> str:
    """
    Returns one of: 'retry', 'skip', 'notify_user', 'abort'
    based on step config and attempt count.
    """
    on_failure  = step.get("on_failure", "notify_user")
    retry_limit = step.get("retry_limit", 3)

    if on_failure == "retry" and attempt < retry_limit:
        return "retry"
    elif on_failure == "retry" and attempt >= retry_limit:
        # Retry limit exhausted — fall to notify
        return "notify_user"
    return on_failure


# ─────────────────────────────────────────────
# Single Step Runner
# ─────────────────────────────────────────────

def _run_step(step: dict, context: dict, model_bridge=None) -> dict:
    """
    Runs a single step with retry logic.
    Returns: { "status": "ok"|"skip"|"notify_user"|"abort", "context": {...}, "error": "..." }
    """
    step_id   = step.get("step_id", "?")
    step_type = step.get("type", "")
    attempt   = 0

    while True:
        attempt += 1
        error   = None
        result  = {}

        # ── System step ──────────────────────────
        if step.get("_unresolvable"):
            return {"status": "notify_user", "context": context, "error": step.get("_fallback_reason")}
        
        if step_type == "system":
            action = step.get("action", "")
            params = step.get("params", [])
            result = _dispatch_action(action, params, context)
            if result.get("success"):
                # Store entire result in context under action name
                out_var = step.get("output_variable", f"step_{step_id}_result")
                context[out_var] = result
            else:
                error = result.get("error", "Unknown error")

        # ── AI step ──────────────────────────────
        elif step_type == "ai":
            result = _run_ai_step(step, context, model_bridge)
            if result.get("success"):
                out_var = step.get("output_variable", f"step_{step_id}_response")
                context[out_var] = result.get("response", "")
            else:
                error = result.get("error", "AI step failed")

        # ── Condition step ────────────────────────
        elif step_type == "condition":
            condition = _resolve(step.get("condition", ""), context)
            # Simple eval — only safe because conditions are user-authored skill logic
            try:
                passed = eval(condition, {"__builtins__": {}}, context)
                branch = step.get("if_true") if passed else step.get("if_false")
                context[f"step_{step_id}_branch"] = branch
            except Exception as e:
                error = f"Condition eval failed: {e}"

        # ── Knowledge read step ───────────────────
        elif step_type == "knowledge_read":
            k_path  = _resolve(step.get("knowledge_path", ""), context)
            out_var = step.get("output_variable", f"step_{step_id}_knowledge")
            try:
                import sqlite3, os
                # k_path format: "folder/subname" e.g. "personal/doptune"
                parts = k_path.strip('/').split('/')
                if len(parts) >= 2:
                    folder = parts[0]
                    subname = parts[1]
                else:
                    folder = parts[0]
                    subname = parts[0]
                db_path = os.path.expanduser(
                    f"~/.syntx-labs/base/{folder}/{subname}.db"
                )
                if os.path.exists(db_path):
                    conn = sqlite3.connect(db_path)
                    # Get facts
                    facts = [row[0] for row in conn.execute(
                        "SELECT content FROM facts ORDER BY created_at ASC"
                    ).fetchall()]
                    # Get summary
                    summary_row = conn.execute(
                        "SELECT content FROM summary WHERE id = 1"
                    ).fetchone()
                    summary = summary_row[0] if summary_row else ""
                    conn.close()
                    knowledge_text = f"Knowledge about {subname}:\n"
                    if summary:
                        knowledge_text += f"Summary: {summary}\n"
                    if facts:
                        knowledge_text += "Facts:\n" + "\n".join(
                            f"  {i+1}. {f}" for i, f in enumerate(facts)
                        )
                    context[out_var] = knowledge_text
                    context["__knowledge__"] = knowledge_text  # fixed key for injection
                else:
                    context[out_var] = f"No knowledge found at path: {k_path}"
            except Exception as e:
                context[out_var] = f"Knowledge read error: {str(e)}"

        # ── Unknown step type ─────────────────────
        else:
            error = f"Unknown step type: '{step_type}'"

        # ── Success → move on ─────────────────────
        if error is None:
            return {"status": "ok", "context": context, "error": None}

        # ── Failure → handle ──────────────────────
        decision = _handle_failure(step, error, attempt)

        if decision == "retry":
            print(f"[Executor] Step {step_id} failed (attempt {attempt}). Retrying... Error: {error}", file=sys.stderr)
            time.sleep(0.5 * attempt)   # back-off: 0.5s, 1s, 1.5s...
            continue

        return {"status": decision, "context": context, "error": error}


# ─────────────────────────────────────────────
# Main Executor
# ─────────────────────────────────────────────

def execute_skill(skill: dict, user_inputs: dict, model_bridge=None) -> dict:
    """
    Runs a full skill from start to finish.

    Args:
        skill:        Full skill dict (from skill_loader).
        user_inputs:  { "app_name": "Spotify", ... } — user-provided values.
        model_bridge: callable(prompt: str) -> str — local model interface.
                      Pass None if model isn't connected yet.

    Returns:
        {
            "success":   True/False,
            "message":   "...",
            "context":   { all variables after execution },
            "steps_run": [ { step_id, status, error } ]
        }
    """
    steps_run = []

    # ── Build initial context from user inputs ────
    context: dict = {}

    # Validate required inputs are present
    for inp in skill.get("inputs", []):
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

    # ── Run steps in sequence ─────────────────────
    steps, fallback_warnings = resolve_all_steps(skill)
    if fallback_warnings:
        print(f"[Executor] Fallback warnings: {fallback_warnings}", file=sys.stderr)

    for step in steps:
        step_id = step.get("step_id", "?")
        print(f"[Executor] Running step {step_id} — type: {step.get('type')}", file=sys.stderr)

        result = _run_step(step, context, model_bridge)
        steps_run.append({
            "step_id": step_id,
            "status":  result["status"],
            "error":   result.get("error")
        })
        context = result["context"]

        # ── Handle step outcome ───────────────────
        if result["status"] == "ok":
            continue

        elif result["status"] == "skip":
            print(f"[Executor] Step {step_id} skipped. Continuing.", file=sys.stderr)
            continue

        elif result["status"] == "notify_user":
            return _make_result(
                False,
                f"Step {step_id} failed — user notified. Error: {result['error']}",
                context,
                steps_run
            )

        elif result["status"] == "abort":
            print(f"[Executor] Step {step_id} aborted skill.", file=sys.stderr)
            _rollback(steps_run, context)
            return _make_result(
                False,
                f"Skill aborted at step {step_id}. Error: {result['error']}",
                context,
                steps_run
            )

    # ── Collect final output ──────────────────────
    out_var = skill.get("output", {}).get("variable", "final_result")
    final   = context.get(out_var, "Skill completed. No output variable set.")

    return _make_result(True, str(final), context, steps_run)


# ─────────────────────────────────────────────
# Rollback — best effort cleanup on abort
# ─────────────────────────────────────────────

def _rollback(steps_run: list, context: dict) -> None:
    """
    Best-effort rollback on abort.
    Currently logs what ran — file/process rollback can be added per action later.
    """
    print("[Executor] Rolling back...", file=sys.stderr)
    for s in reversed(steps_run):
        print(f"  ← Step {s['step_id']} | status: {s['status']}", file=sys.stderr)
    print("[Executor] Rollback complete.", file=sys.stderr)
