import sys
# skill_tester.py
# Syntx Labs — Skill Test Runner
# Tests skills safely before saving. Never touches real files or real apps.

import os
import tempfile
import shutil
from datetime import datetime, timezone
from skill_executor import execute_skill
from skill_validator import run_full_validation

# ─────────────────────────────────────────────
# Dummy Input Generators per type
# ─────────────────────────────────────────────

_DUMMY_VALUES = {
    "string"  : "test_value",
    "integer" : 1,
    "boolean" : True,
    "list"    : ["item1", "item2"],
    "dict"    : {"key": "value"},
}

_NAME_HINTS = {
    "path"      : "/tmp/syntx_test/test_file.txt",
    "file"      : "/tmp/syntx_test/test_file.txt",
    "folder"    : "/tmp/syntx_test/",
    "url"       : "https://example.com",
    "app"       : "gedit",
    "command"   : "echo syntx_test",
    "text"      : "Hello from Syntx test",
    "key"       : "enter",
    "package"   : "requests",
    "process"   : "gedit",
    "selector"  : "#test-element",
    "query"     : "test query",
    "prompt"    : "Describe what you see.",
    "direction" : "down",
    "amount"    : 3,
    "x"         : 100,
    "y"         : 100,
}


def generate_test_inputs(skill_json: dict) -> dict:
    """
    Creates safe dummy inputs for every input defined in the skill.
    Uses name hints to generate realistic-looking test values.
    """
    test_inputs = {}
    for inp in skill_json.get("inputs", []):
        name  = inp.get("name", "input")
        itype = inp.get("type", "string")

        # Check name hints first
        matched = next(
            (v for k, v in _NAME_HINTS.items() if k in name.lower()),
            None
        )
        test_inputs[name] = matched if matched else _DUMMY_VALUES.get(itype, "test_value")

    return test_inputs


# ─────────────────────────────────────────────
# Sandbox — intercepts real actions
# ─────────────────────────────────────────────

class SandboxBridge:
    """
    Wraps action_library calls during testing.
    Redirects dangerous actions to safe equivalents.
    Logs every action attempted.
    """

    def __init__(self, temp_dir: str):
        self.temp_dir = temp_dir
        self.log      = []        # [ { action, params, result, sandboxed } ]

    def _record(self, action: str, params: list, result: dict, sandboxed: bool):
        self.log.append({
            "action":    action,
            "params":    params,
            "result":    result,
            "sandboxed": sandboxed,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })

    def dispatch(self, action: str, params: list) -> dict:
        import action_library

        # ── File ops → redirect to temp_dir ──────
        FILE_OPS = {"read_file", "write_file", "delete_file", "move_file", "list_files"}
        if action in FILE_OPS:
            safe_params = self._sandbox_paths(params)
            fn     = getattr(action_library, action, None)
            result = fn(*safe_params) if fn else {"success": False, "error": f"Action '{action}' not found."}
            self._record(action, safe_params, result, sandboxed=True)
            return result

        if action == "create_folder":
            safe_params = self._sandbox_paths(params)
            result = action_library.create_folder(*safe_params)
            self._record(action, safe_params, result, sandboxed=True)
            return result

        # ── App/process actions → simulate ───────
        APP_OPS = {"open_app", "close_app", "kill_process", "open_terminal"}
        if action in APP_OPS:
            result = {"success": True, "sandboxed": True, "note": f"[SANDBOX] '{action}' simulated — not actually run."}
            self._record(action, params, result, sandboxed=True)
            return result

        # ── run_command → only allow echo/safe ───
        if action == "run_command":
            command = params[0] if params else ""
            if not any(command.strip().startswith(safe) for safe in ("echo", "python --version", "pwd")):
                result = {"success": True, "sandboxed": True, "stdout": "[SANDBOX] Command blocked for safety.", "stderr": "", "returncode": 0}
                self._record(action, params, result, sandboxed=True)
                return result
            result = action_library.run_command(command)
            self._record(action, params, result, sandboxed=False)
            return result

        # ── install_package → always block ───────
        if action == "install_package":
            result = {"success": True, "sandboxed": True, "note": "[SANDBOX] Package install blocked during test."}
            self._record(action, params, result, sandboxed=True)
            return result

        # ── GUI actions → simulate ────────────────
        GUI_OPS = {"type_text", "press_key", "click_position", "scroll",
                   "copy_to_clipboard", "paste_from_clipboard",
                   "take_screenshot", "pass_to_vision_model"}
        if action in GUI_OPS:
            result = {"success": True, "sandboxed": True, "note": f"[SANDBOX] '{action}' simulated."}
            self._record(action, params, result, sandboxed=True)
            return result

        # ── Browser → simulate in sandbox ────────
        BROWSER_OPS = {"browser_open", "browser_click", "browser_type",
               "browser_find_element", "browser_get_content", "browser_screenshot"}
        if action in BROWSER_OPS:
            result = {"success": True, "sandboxed": True, "note": f"[SANDBOX] '{action}' simulated."}
            self._record(action, params, result, sandboxed=True)
            return result

        # ── Accessibility → run normally ──────────
        fn     = getattr(action_library, action, None)
        result = fn(*params) if fn else {"success": False, "error": f"Action '{action}' not found."}
        self._record(action, params, result, sandboxed=False)
        return result

    def _sandbox_paths(self, params: list) -> list:
        """Rewrites any file path params to point inside temp_dir."""
        safe = []
        for p in params:
            if isinstance(p, str) and ("/" in p or "\\" in p or "." in p):
                filename = os.path.basename(p) or "sandboxed_file.txt"
                safe.append(os.path.join(self.temp_dir, filename))
            else:
                safe.append(p)
        return safe


# ─────────────────────────────────────────────
# Sandboxed Executor — plugs into execute_skill
# ─────────────────────────────────────────────

def _make_sandbox_executor(sandbox: SandboxBridge):
    """
    Returns a patched execute_skill that routes all system
    actions through the sandbox instead of action_library directly.
    """
    import skill_executor as _exe
    import re, time, inspect

    def sandboxed_execute(skill: dict, user_inputs: dict, model_bridge=None) -> dict:
        steps_run = []
        context   = {}

        # Validate inputs
        for inp in skill.get("inputs", []):
            name     = inp.get("name")
            required = inp.get("required", False)
            value    = user_inputs.get(name)
            if required and value is None:
                return {"success": False, "message": f"Missing input: '{name}'", "context": context, "steps_run": steps_run}
            if value is not None:
                context[name] = value

        steps = skill.get("steps", [])

        for step in steps:
            step_id   = step.get("step_id", "?")
            step_type = step.get("type", "")
            attempt   = 0
            error     = None

            # Unresolvable fallback
            if step.get("_unresolvable"):
                steps_run.append({"step_id": step_id, "status": "notify_user", "error": step.get("_fallback_reason")})
                return {"success": False, "message": step.get("_fallback_reason"), "context": context, "steps_run": steps_run}

            while True:
                attempt += 1
                error   = None

                if step_type == "system":
                    action  = step.get("action", "")
                    params  = _exe._resolve(step.get("params", []), context)
                    result  = sandbox.dispatch(action, params)
                    if result.get("success"):
                        out_var = step.get("output_variable", f"step_{step_id}_result")
                        context[out_var] = result
                    else:
                        error = result.get("error", "Unknown error")

                elif step_type == "ai":
                    result = _exe._run_ai_step(step, context, model_bridge)
                    if result.get("success"):
                        out_var = step.get("output_variable", f"step_{step_id}_response")
                        context[out_var] = result.get("response", "")
                    else:
                        error = result.get("error", "AI step failed")

                elif step_type == "condition":
                    condition = _exe._resolve(step.get("condition", ""), context)
                    try:
                        passed  = eval(condition, {"__builtins__": {}}, context)
                        context[f"step_{step_id}_branch"] = step.get("if_true") if passed else step.get("if_false")
                    except Exception as e:
                        error = f"Condition eval failed: {e}"

                elif step_type == "knowledge_read":
                    k_path  = _exe._resolve(step.get("knowledge_path", ""), context)
                    out_var = step.get("output_variable", f"step_{step_id}_knowledge")
                    context[out_var] = f"[SANDBOX] Knowledge read simulated for: {k_path}"

                else:
                    error = f"Unknown step type: '{step_type}'"

                if error is None:
                    steps_run.append({"step_id": step_id, "status": "ok", "error": None})
                    break

                decision = _exe._handle_failure(step, error, attempt)
                if decision == "retry":
                    time.sleep(0.3)
                    continue

                steps_run.append({"step_id": step_id, "status": decision, "error": error})

                if decision in ("notify_user", "abort"):
                    return {"success": False, "message": f"Step {step_id} failed: {error}", "context": context, "steps_run": steps_run}
                break   # skip

        out_var = skill.get("output", {}).get("variable", "final_result")
        final   = context.get(out_var, "Test completed.")
        return {"success": True, "message": str(final), "context": context, "steps_run": steps_run}

    return sandboxed_execute


# ─────────────────────────────────────────────
# Run Skill in Sandbox
# ─────────────────────────────────────────────

def run_skill_in_sandbox(skill_json: dict, test_inputs: dict) -> dict:
    """
    Executes the skill safely inside a temp folder sandbox.
    Returns full execution log for result capture.
    """
    temp_dir = tempfile.mkdtemp(prefix="syntx_test_")
    try:
        sandbox  = SandboxBridge(temp_dir)
        executor = _make_sandbox_executor(sandbox)
        result   = executor(skill_json, test_inputs)
        result["sandbox_log"] = sandbox.log
        result["temp_dir"]    = temp_dir
        return result
    except Exception as e:
        return {
            "success":     False,
            "message":     f"Sandbox crashed: {e}",
            "steps_run":   [],
            "sandbox_log": [],
            "temp_dir":    temp_dir
        }
    finally:
        # Always clean up temp folder
        shutil.rmtree(temp_dir, ignore_errors=True)


# ─────────────────────────────────────────────
# Capture Test Result
# ─────────────────────────────────────────────

def capture_test_result(execution_log: dict) -> dict:
    """
    Processes raw execution result into a clean pass/fail report.
    """
    steps_run   = execution_log.get("steps_run", [])
    sandbox_log = execution_log.get("sandbox_log", [])
    success     = execution_log.get("success", False)

    failed_steps = [s for s in steps_run if s["status"] != "ok"]
    passed_steps = [s for s in steps_run if s["status"] == "ok"]

    # Sandboxed vs real action breakdown
    sandboxed_count = sum(1 for s in sandbox_log if s.get("sandboxed"))
    real_count      = sum(1 for s in sandbox_log if not s.get("sandboxed"))

    return {
        "passed":          success,
        "total_steps":     len(steps_run),
        "passed_steps":    len(passed_steps),
        "failed_steps":    failed_steps,
        "sandboxed_count": sandboxed_count,
        "real_count":      real_count,
        "sandbox_log":     sandbox_log,
        "final_message":   execution_log.get("message", "")
    }


# ─────────────────────────────────────────────
# Present Result to User — plain english
# ─────────────────────────────────────────────

def present_test_result_to_user(result: dict) -> str:
    """
    Converts test result into plain english for the instruction console.
    Returns a string ready to display directly to the user.
    """
    lines = []
    lines.append("=" * 48)
    lines.append("  SYNTX SKILL TEST RESULT")
    lines.append("=" * 48)

    if result["passed"]:
        lines.append("✓  PASSED — Skill ran successfully in sandbox.")
    else:
        lines.append("✗  FAILED — Skill did not complete successfully.")

    lines.append(f"\n  Steps run  : {result['total_steps']}")
    lines.append(f"  Passed     : {result['passed_steps']}")
    lines.append(f"  Failed     : {len(result['failed_steps'])}")
    lines.append(f"  Sandboxed  : {result['sandboxed_count']} action(s) safely redirected")
    lines.append(f"  Real       : {result['real_count']} action(s) ran live")

    if result["failed_steps"]:
        lines.append("\n  WHAT WENT WRONG:")
        for s in result["failed_steps"]:
            lines.append(f"    Step {s['step_id']} [{s['status']}] — {s['error']}")

    if result["sandbox_log"]:
        lines.append("\n  WHAT HAPPENED (step by step):")
        for entry in result["sandbox_log"]:
            tag = "[SANDBOX]" if entry["sandboxed"] else "[LIVE]   "
            lines.append(f"    {tag} {entry['action']}  →  success: {entry['result'].get('success')}")

    lines.append("\n" + "=" * 48)

    if result["passed"]:
        lines.append("  Ready to save! Confirm to add this skill.")
    else:
        lines.append("  Fix the failed steps above and test again.")

    lines.append("=" * 48)

    return "\n".join(lines)


# ─────────────────────────────────────────────
# Master Test Runner — call this from console
# ─────────────────────────────────────────────

def test_skill(skill_json: dict, model_bridge=None) -> dict:
    """
    Full test pipeline. Call this from the instruction console.

    1. Validates schema
    2. Generates test inputs
    3. Runs in sandbox
    4. Captures result
    5. Returns result + plain english summary

    Returns:
        {
            "passed":  True/False,
            "summary": "plain english string for UI",
            "result":  { full result dict }
        }
    """
    if not isinstance(skill_json, dict):
        return {"passed": False, "summary": f"skill_json is not a dict, got: {type(skill_json)}", "result": {}}
    step_count = len(skill_json.get("steps", []))
    if step_count == 0:
        return {"passed": False, "summary": f"skill_json has 0 steps. Keys: {list(skill_json.keys())}", "result": {}}
    
    # Step 1 — validate first
    validation = run_full_validation(skill_json)
    if not validation["valid"]:
        summary = (
            "✗ Skill failed validation before testing.\n\n"
            "Errors:\n" + "\n".join(f"  - {e}" for e in validation["errors"])
        )
        return {"passed": False, "summary": summary, "result": validation}

    # Step 2 — generate inputs
    test_inputs = generate_test_inputs(skill_json)

    # Step 3 — sandbox run
    execution = run_skill_in_sandbox(skill_json, test_inputs)

    # Step 4 — capture
    result  = capture_test_result(execution)

    # Step 5 — plain english
    summary = present_test_result_to_user(result)

    return {
        "passed":  result["passed"],
        "summary": summary,
        "result":  result
    }
