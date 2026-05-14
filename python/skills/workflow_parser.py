# workflow_parser.py
# Syntx Labs — Workflow Parser
# Parses natural language conversation into valid workflow JSON.

import re
import sys
from datetime import datetime, timezone
from workflow_schema import (
    get_empty_workflow_template,
    build_skill_step,
    build_condition_step,
    build_ai_step,
    build_wait_step,
    build_input,
    WORKFLOW_SCHEMA_VERSION
)
from workflow_loader import workflow_exists
from skill_loader import skill_exists, load_skill


# ─────────────────────────────────────────────
# 1. Extract Workflow Name
# ─────────────────────────────────────────────

def extract_workflow_name(text: str) -> str | None:
    patterns = [
        r'workflow name[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
        r'call it[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
        r'name it[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
        r'workflow called[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(2).strip()

    quoted = re.search(r'["\']([a-zA-Z0-9 _\-]+)["\']', text)
    if quoted:
        return quoted.group(1).strip()

    return None


# ─────────────────────────────────────────────
# 2. Extract Trigger Phrases
# ─────────────────────────────────────────────

def extract_trigger_phrases(text: str) -> list[str]:
    triggers = []

    block = re.search(r'trigger[s]?[:\s]+(.+)', text, re.IGNORECASE)
    if block:
        raw   = block.group(1)
        found = re.findall(r'["\']([^"\']+)["\']', raw)
        if found:
            triggers.extend(found)
        else:
            triggers.extend([t.strip() for t in raw.split(",") if t.strip()])

    seen  = set()
    clean = []
    for t in triggers:
        t = t.strip().lower()
        if t and t not in seen:
            seen.add(t)
            clean.append(t)

    return clean


# ─────────────────────────────────────────────
# 3. Parse Steps from Text
# ─────────────────────────────────────────────

def parse_workflow_steps(steps_text: str) -> list[dict]:
    """
    Parses workflow steps from natural language.
    Supports:
      - "1. run quick_facts with topic={{topic}}"
      - "2. if step_1_success then go to 3 else go to 4"
      - "3. wait 5 seconds"
      - "4. run code_writer with task={{topic}}"
    """
    steps   = []
    lines   = steps_text.strip().split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Match numbered steps
        num_match = re.match(r'^(\d+)[.):\s]+(.+)$', line)
        if not num_match:
            continue

        step_id = int(num_match.group(1))
        desc    = num_match.group(2).strip()

        # ── Condition step ────────────────────────
        cond_match = re.match(
            r'if\s+(\w+)\s+(?:then\s+)?go\s+to\s+(\d+)\s+else\s+(?:go\s+to\s+)?(\d+)',
            desc, re.IGNORECASE
        )
        if cond_match:
            steps.append({
                "step_id":   step_id,
                "type":      "condition",
                "condition": cond_match.group(1),
                "if_true":   int(cond_match.group(2)),
                "if_false":  int(cond_match.group(3)),
                "raw":       desc
            })
            continue

        # ── Wait step ─────────────────────────────
        wait_match = re.match(r'wait\s+(\d+)\s*(?:seconds?|secs?)?', desc, re.IGNORECASE)
        if wait_match:
            steps.append({
                "step_id": step_id,
                "type":    "wait",
                "seconds": int(wait_match.group(1)),
                "raw":     desc
            })
            continue

        # ── AI step ───────────────────────────────
        ai_keywords = ["analyze", "summarize", "think", "reason",
                       "decide", "evaluate", "determine", "check"]
        if any(kw in desc.lower() for kw in ai_keywords):
            # Check if it's NOT a skill run
            if not re.search(r'run\s+\w+|use\s+\w+\s+skill', desc, re.IGNORECASE):
                steps.append({
                    "step_id": step_id,
                    "type":    "ai",
                    "raw":     desc
                })
                continue

        # ── Skill step ────────────────────────────
        # Formats:
        # "run quick_facts with topic={{topic}}"
        # "run quick_facts {"topic": "{{topic}}"}"
        # "use quick_facts skill"
        skill_match = re.search(
            r'(?:run|use)\s+([a-zA-Z0-9_]+)(?:\s+(?:with|skill))?(.*)$',
            desc, re.IGNORECASE
        )
        if skill_match:
            skill_name = skill_match.group(1).strip()
            inputs_raw = skill_match.group(2).strip()
            inputs     = {}

            # Try JSON inputs first
            json_match = re.search(r'\{(.+)\}', inputs_raw)
            if json_match:
                try:
                    import json
                    inputs = json.loads('{' + json_match.group(1) + '}')
                except Exception:
                    pass

            # Try "with key=value" format
            if not inputs:
                kv_matches = re.findall(r'(\w+)\s*=\s*([^\s,]+)', inputs_raw)
                for k, v in kv_matches:
                    inputs[k] = v

            steps.append({
                "step_id":    step_id,
                "type":       "skill",
                "skill_name": skill_name,
                "inputs":     inputs,
                "raw":        desc
            })
            continue

        # ── Unrecognized ──────────────────────────
        steps.append({
            "step_id": step_id,
            "type":    "unknown",
            "raw":     desc
        })

    return steps


# ─────────────────────────────────────────────
# 4. Auto-detect inputs from {{variable}} usage
# ─────────────────────────────────────────────

def detect_inputs(steps: list[dict]) -> list[dict]:
    seen   = set()
    inputs = []
    for step in steps:
        raw = step.get("raw", "")
        vars_found = re.findall(r'\{\{(\w+)\}\}', raw)
        for var in vars_found:
            if var not in seen:
                seen.add(var)
                inputs.append(build_input(
                    name     = var,
                    type     = "string",
                    required = True,
                    source   = "user_message"
                ))
        # Also check inputs dict
        for v in step.get("inputs", {}).values():
            vars_in_val = re.findall(r'\{\{(\w+)\}\}', str(v))
            for var in vars_in_val:
                if var not in seen:
                    seen.add(var)
                    inputs.append(build_input(
                        name     = var,
                        type     = "string",
                        required = True,
                        source   = "user_message"
                    ))
    return inputs


# ─────────────────────────────────────────────
# 5. Build Workflow JSON
# ─────────────────────────────────────────────

def build_workflow_json(parsed_data: dict) -> dict:
    """
    Assembles a complete workflow JSON from parsed data.
    """
    name        = parsed_data.get("workflow_name", "unnamed_workflow")
    description = parsed_data.get("description", "")
    triggers    = parsed_data.get("trigger_phrases", [])
    raw_steps   = parsed_data.get("steps", [])

    workflow = get_empty_workflow_template(name, description)
    workflow["trigger_phrases"] = triggers

    unresolved = []

    # Auto-detect inputs
    inputs = detect_inputs(raw_steps)
    workflow["inputs"] = inputs

    for raw in raw_steps:
        step_id   = raw["step_id"]
        step_type = raw["type"]

        # ── Condition ─────────────────────────────
        if step_type == "condition":
            workflow["steps"].append(
                build_condition_step(
                    step_id  = step_id,
                    condition = raw["condition"],
                    if_true  = raw["if_true"],
                    if_false = raw["if_false"]
                )
            )

        # ── Wait ──────────────────────────────────
        elif step_type == "wait":
            workflow["steps"].append(
                build_wait_step(
                    step_id = step_id,
                    seconds = raw.get("seconds", 1)
                )
            )

        # ── AI ────────────────────────────────────
        elif step_type == "ai":
            # Auto-inject previous step output
            prev = next(
                (s for s in reversed(workflow["steps"])
                 if s.get("type") in ("skill", "ai")),
                None
            )
            prompt = raw["raw"]
            if prev:
                prev_var = prev.get("output_variable",
                                    f"step_{prev['step_id']}_result")
                prompt += f"\n\nContext from previous step:\n{{{{{prev_var}}}}}"

            workflow["steps"].append(
                build_ai_step(
                    step_id         = step_id,
                    prompt          = prompt,
                    output_variable = f"step_{step_id}_result",
                    on_failure      = "notify_user"
                )
            )

        # ── Skill ─────────────────────────────────
        elif step_type == "skill":
            skill_name = raw.get("skill_name", "")
            inputs_dict = raw.get("inputs", {})

            # Warn if skill doesn't exist
            if not skill_exists(skill_name):
                print(f"[WorkflowParser] Warning: Skill '{skill_name}' not found.", file=sys.stderr)
                unresolved.append({
                    "step_id": step_id,
                    "raw":     raw["raw"],
                    "reason":  f"Skill '{skill_name}' not found. Create it first."
                })
                continue

            workflow["steps"].append(
                build_skill_step(
                    step_id         = step_id,
                    skill_name      = skill_name,
                    inputs          = inputs_dict,
                    output_variable = f"step_{step_id}_result",
                    on_failure      = "notify_user"
                )
            )

        # ── Unknown ───────────────────────────────
        else:
            unresolved.append({
                "step_id": step_id,
                "raw":     raw.get("raw", ""),
                "reason":  f"Could not parse step: '{raw.get('raw', '')}'"
            })

    # Auto-set output to last step
    for step in reversed(workflow["steps"]):
        step_id = step.get("step_id")
        if step.get("type") in ("skill", "ai"):
            workflow["output"]["variable"] = f"step_{step_id}_result"
            break

    return {
        "success":    True,
        "workflow":   workflow,
        "unresolved": unresolved
    }


# ─────────────────────────────────────────────
# 6. Main Entry Point
# ─────────────────────────────────────────────

def parse_workflow_from_conversation(
    conversation_history: list[dict],
    steps_text:    str  = "",
    workflow_name: str  = "",
    description:   str  = ""
) -> dict:
    """
    Entry point. Takes conversation history and builds workflow JSON.
    """
    errors = []

    user_text = "\n".join(
        msg["content"]
        for msg in conversation_history
        if msg.get("role") == "user"
    )

    if not workflow_name:
        workflow_name = extract_workflow_name(user_text) or "unnamed_workflow"

    if workflow_exists(workflow_name):
        errors.append(f"Workflow '{workflow_name}' already exists.")

    triggers = extract_trigger_phrases(user_text)
    if not triggers and workflow_name:
        triggers = [workflow_name.replace("_", " ")]

    steps = parse_workflow_steps(steps_text if steps_text else user_text)
    if not steps:
        errors.append("No steps found.")

    parsed_data = {
        "workflow_name":   workflow_name,
        "description":     description,
        "trigger_phrases": triggers,
        "steps":           steps
    }

    result         = build_workflow_json(parsed_data)
    result["errors"] = errors

    return result
