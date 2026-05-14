import sys
# skill_parser.py
# Syntx Labs — Skill Parser
# Parses natural language conversation into valid skill JSON.

import re
from datetime import datetime, timezone
from skill_schema import get_empty_skill_template, build_input, build_system_step, build_ai_step, build_knowledge_read_step
from skill_loader import skill_exists
from action_library import get_all_actions
from capability_checker import get_system_capabilities

# ─────────────────────────────────────────────
# Action Mappings — natural language → library
# ─────────────────────────────────────────────

STEP_MAPPINGS = {
    # Browser
    "open browser"          : "browser_open",
    "open url"              : "browser_open",
    "go to website"         : "browser_open",
    "browse to"             : "browser_open",
    "click on"              : "browser_click",
    "click button"          : "browser_click",
    "type in browser"       : "browser_type",
    "fill form"             : "browser_type",
    "get page content"      : "browser_get_content",
    "read webpage"          : "browser_get_content",
    "browser screenshot"    : "browser_screenshot",
    "find element"          : "browser_find_element",

    # File system
    "read file"             : "read_file",
    "read the file"         : "read_file",
    "open file"             : "read_file",
    "write file"            : "write_file",
    "save file"             : "write_file",
    "create folder"         : "create_folder",
    "make folder"           : "create_folder",
    "delete file"           : "delete_file",
    "remove file"           : "delete_file",
    "move file"             : "move_file",
    "list files"            : "list_files",

    # Process control
    "open terminal"         : "open_terminal",
    "launch terminal"       : "open_terminal",
    "run command"           : "run_command",
    "execute command"       : "run_command",
    "run script"            : "run_command",
    "install package"       : "install_package",
    "install library"       : "install_package",
    "kill process"          : "kill_process",
    "stop process"          : "kill_process",
    "check process"         : "check_process_running",

    # App control
    "open app"              : "open_app",
    "launch app"            : "open_app",
    "open application"      : "open_app",
    "close app"             : "close_app",
    "close application"     : "close_app",
    "type text"             : "type_text",
    "type"                  : "type_text",
    "press key"             : "press_key",
    "click position"        : "click_position",
    "click"                 : "click_position",
    "scroll"                : "scroll",
    "copy to clipboard"     : "copy_to_clipboard",
    "copy"                  : "copy_to_clipboard",
    "paste"                 : "paste_from_clipboard",

    # Accessibility
    "get accessibility tree": "get_accessibility_tree",
    "find element by name"  : "find_element_by_name",
    "find element by role"  : "find_element_by_role",

    # VLA
    "take screenshot"       : "take_screenshot",
    "screenshot"            : "take_screenshot",
    "capture screen"        : "take_screenshot",
    "ask vision model"      : "pass_to_vision_model",
    "pass to vision"        : "pass_to_vision_model",

    "read knowledge"    : "knowledge_read",
    "load knowledge"    : "knowledge_read",
    "get knowledge"     : "knowledge_read",
    "fetch knowledge"   : "knowledge_read",
}

# Actions that need capability flags
_REQUIRES_VLA         = {"take_screenshot", "pass_to_vision_model"}
_REQUIRES_BROWSER     = {"browser_open", "browser_click", "browser_type",
                         "browser_find_element", "browser_get_content", "browser_screenshot"}
_REQUIRES_ACCESIBILITY = {"get_accessibility_tree", "find_element_by_name", "find_element_by_role"}
_REQUIRES_INTERNET    = {"browser_open"}


# ─────────────────────────────────────────────
# 1. Extract Skill Name
# ─────────────────────────────────────────────

def extract_skill_name(text: str) -> str | None:
    """
    Pulls skill name from text.
    Looks for patterns like: 'skill name: X', 'call it X', 'name it X', 'skill called X'
    Falls back to first quoted string, then None.
    """
    patterns = [
        r'skill name[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
        r'call it[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
        r'name it[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
        r'skill called[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
        r'create a skill[:\s]+(["\']?)([a-zA-Z0-9 _\-]+)\1',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(2).strip()

    # fallback — first quoted string
    quoted = re.search(r'["\']([a-zA-Z0-9 _\-]+)["\']', text)
    if quoted:
        return quoted.group(1).strip()

    return None


# ─────────────────────────────────────────────
# 2. Extract Trigger Phrases
# ─────────────────────────────────────────────

def extract_trigger_phrases(text: str) -> list[str]:
    """
    Pulls trigger phrases from text.
    Looks for: 'trigger: X', 'when user says X', 'activated by X', quoted lists.
    """
    triggers = []

    # Explicit trigger block: trigger: "phrase1", "phrase2"
    block = re.search(r'trigger[s]?[:\s]+(.+)', text, re.IGNORECASE)
    if block:
        raw = block.group(1)
        found = re.findall(r'["\']([^"\']+)["\']', raw)
        if found:
            triggers.extend(found)
        else:
            # No quotes — split by comma
            triggers.extend([t.strip() for t in raw.split(",") if t.strip()])

    # "when user says X"
    says = re.findall(r'when (?:user )?says?\s+["\']?([^"\',.]+)["\']?', text, re.IGNORECASE)
    triggers.extend([s.strip() for s in says])

    # "activated by X"
    activated = re.findall(r'activated by\s+["\']?([^"\',.]+)["\']?', text, re.IGNORECASE)
    triggers.extend([a.strip() for a in activated])

    # Deduplicate, clean
    seen = set()
    clean = []
    for t in triggers:
        t = t.strip().lower()
        if t and t not in seen:
            seen.add(t)
            clean.append(t)

    return clean


# ─────────────────────────────────────────────
# 3. Map Step to Action
# ─────────────────────────────────────────────

def map_step_to_action(step_description: str) -> dict:
    """
    Maps a natural language step description to an action_library action.
    Returns:
        { "matched": True,  "action": "open_app", "confidence": "high"/"low" }
        { "matched": False, "action": None, "reason": "No match found. Needs clarification." }
    """
    text = step_description.lower().strip()

    # Exact / substring match — longest match wins (most specific)
    best_match = None
    best_len   = 0
    for phrase, action in STEP_MAPPINGS.items():
        if phrase in text and len(phrase) > best_len:
            best_match = action
            best_len   = len(phrase)

    if best_match:
        return {"matched": True, "action": best_match, "confidence": "high"}

    # Fuzzy — check if any action name words appear in text
    all_actions = get_all_actions()
    for action in all_actions:
        words = action.replace("_", " ").split()
        if all(w in text for w in words):
            return {"matched": True, "action": action, "confidence": "low"}

    return {
        "matched": False,
        "action":  None,
        "reason":  f"Could not map '{step_description}' to any known action. Please clarify."
    }


# ─────────────────────────────────────────────
# 4. Extract Steps
# ─────────────────────────────────────────────

def extract_steps(text: str) -> list[dict]:
    """
    Pulls step descriptions from text.
    Looks for numbered lists, bullet points, or 'step N:' patterns.
    Returns list of { "step_id": N, "raw": "description", "type": "system"/"ai" }
    """
    steps = []

    # Numbered: "1. do this" or "1) do this" or "step 1: do this"
    numbered = re.findall(
        r'(?:step\s*)?(\d+)[.):\s]+([^\n]+)',
        text, re.IGNORECASE | re.MULTILINE
    )
    if numbered:
        for num, desc in numbered:
            steps.append({
                "step_id": int(num),
                "raw":     desc.strip(),
                "type":    _infer_step_type(desc)
            })
        return steps

    # Bullet points: "- do this" or "• do this"
    bullets = re.findall(r'^[\-•*]\s+(.+)$', text, re.MULTILINE)
    if bullets:
        for i, desc in enumerate(bullets, start=1):
            steps.append({
                "step_id": i,
                "raw":     desc.strip(),
                "type":    _infer_step_type(desc)
            })
        return steps

    return steps


def _infer_step_type(description: str) -> str:
    """
    Infers whether a step is a system action or an AI reasoning step.
    AI steps usually contain words like: check, verify, decide, analyze, determine, ask
    """
    ai_keywords = {"check", "verify", "decide", "analyze", "analyse",
                   "determine", "ask", "think", "reason", "confirm", "evaluate"}
    words = set(description.lower().split())
    if words & ai_keywords:
        return "ai"
    return "system"


def _extract_params(description: str, action: str) -> list:
    desc = description.strip()

    # Check for {{variable}} placeholder first — user will supply at runtime
    var_match = re.search(r'\{\{(\w+)\}\}', desc)

    # ── URL extraction ────────────────────────
    url_match = re.search(r'https?://\S+', desc)

    # ── Path extraction ───────────────────────
    path_match = re.search(r'(/[\w/._-]+)', desc)
    path = path_match.group(1) if path_match else None

    # ── Quoted string extraction ──────────────
    quoted = re.findall(r'["\']([^"\']+)["\']', desc)

    # ── Number extraction ─────────────────────
    numbers = re.findall(r'\b(\d+)\b', desc)

    # ── Word after action keyword ─────────────
    words = desc.split()

    # ── Browser ──────────────────────────────
    if action == "browser_open":
        if url_match: return [url_match.group(0)]  # URL already contains {{topic}}
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return []

    if action == "browser_find_element":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    if action == "browser_click":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    if action == "browser_type":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0], quoted[1]] if len(quoted) >= 2 else (words[-2:] if len(words) >= 2 else [])

    # ── File system ───────────────────────────
    if action == "create_folder":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [path] if path else (quoted[:1] if quoted else [])

    if action == "read_file":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [path] if path else (quoted[:1] if quoted else [])

    if action == "write_file":
        # Match full path including {{var}} and extensions like /path/{{topic}}/file.txt
        full_path_match = re.search(r'(/[\w/._-]*(?:\{\{\w+\}\})?[\w/._-]*)', desc)
        if full_path_match:
            matched_path = full_path_match.group(1)
            return [matched_path, ""]
        if var_match:
            all_vars = re.findall(r'\{\{(\w+)\}\}', desc)
            if len(all_vars) >= 2:
                return [f"{{{{{all_vars[0]}}}}}", f"{{{{{all_vars[1]}}}}}"]
            return [f"{{{{{var_match.group(1)}}}}}", ""]
        
    if action == "knowledge_read":
        words = desc.lower().split()
        # grab word after "knowledge" or "read"
        for i, w in enumerate(words):
            if w in ("knowledge", "read") and i + 1 < len(words):
                return [words[i + 1]]
        return [path] if path else []

    if action == "delete_file":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [path] if path else (quoted[:1] if quoted else [])

    if action == "move_file":
        paths = re.findall(r'(/[\w/._-]+)', desc)
        return paths[:2] if len(paths) >= 2 else (quoted[:2] if len(quoted) >= 2 else [])

    if action == "list_files":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [path] if path else (quoted[:1] if quoted else [])

    # ── Process control ───────────────────────
    if action == "run_command":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        if quoted: return [quoted[0]]
        for kw in ("run command", "execute command", "run script"):
            if kw in desc.lower():
                return [desc.lower().split(kw)[-1].strip()]
        return [desc]

    if action == "install_package":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}","pip"]
        last_word = words[-1] if words else ""
        manager = "pip"
        if "npm" in desc.lower(): manager = "npm"
        return [last_word, manager]

    if action == "kill_process":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    if action == "check_process_running":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    # ── App control ───────────────────────────
    if action == "open_app":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    if action == "close_app":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    if action == "type_text":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else ([" ".join(words[1:])] if len(words) > 1 else [])

    if action == "press_key":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    if action == "click_position":
        if len(numbers) >= 2: return [int(numbers[0]), int(numbers[1])]
        return []

    if action == "scroll":
        direction = "down"
        if "up" in desc.lower(): direction = "up"
        amount = int(numbers[0]) if numbers else 3
        return [direction, amount]

    if action == "copy_to_clipboard":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else ([" ".join(words[1:])] if len(words) > 1 else [])

    # ── Accessibility ─────────────────────────
    if action == "find_element_by_name":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    if action == "find_element_by_role":
        if var_match: return [f"{{{{{var_match.group(1)}}}}}"]
        return [quoted[0]] if quoted else (words[-1:] if words else [])

    # ── VLA ───────────────────────────────────
    if action == "pass_to_vision_model":
        return ["{{screenshot}}", quoted[0] if quoted else desc]

    return []

# ─────────────────────────────────────────────
# 5. Build Skill JSON
# ─────────────────────────────────────────────

def build_skill_json(parsed_data: dict) -> dict:
    """
    Takes parsed data and assembles a complete valid skill JSON.
    parsed_data keys: skill_name, description, trigger_phrases, steps, inputs
    Returns: { "success": True, "skill": {...}, "unresolved": [...] }
    """
    name        = parsed_data.get("skill_name", "unnamed_skill")
    description = parsed_data.get("description", "")
    triggers    = parsed_data.get("trigger_phrases", [])
    raw_steps   = parsed_data.get("steps", [])
    inputs      = parsed_data.get("inputs", [])

    skill       = get_empty_skill_template(name, description)
    skill["trigger_phrases"] = triggers

    # Add inputs
    for inp in inputs:
        skill["inputs"].append(
            build_input(
                name     = inp.get("name", "input"),
                type     = inp.get("type", "string"),
                required = inp.get("required", True),
                source   = inp.get("source", "user_message")
            )
        )

    # Build steps — track unresolved
    unresolved  = []
    capabilities = get_system_capabilities().get("profile", {})

    for raw in raw_steps:
        step_id = raw["step_id"]
        desc    = raw["raw"]
        stype   = raw["type"]

        if stype == "ai":
            # Auto-inject previous system step outputs into prompt
            prev_system = next(
                (s for s in reversed(skill["steps"]) if s.get("type") == "system"),
                None
            )
            if prev_system:
                prev_var = prev_system.get("output_variable", f"step_{prev_system['step_id']}_result")
                # For second+ AI steps, use previous AI output as context instead
                prev_ai_before = next(
                    (s for s in reversed(skill["steps"]) if s.get("type") == "ai"),
                    None
                )
                if prev_ai_before:
                    prev_var = prev_ai_before.get("output_variable", f"step_{prev_ai_before['step_id']}_result")
                enriched_prompt = f"{desc}\n\nContext from previous step:\n{{{{{prev_var}}}}}"
            else:
                enriched_prompt = desc

            skill["steps"].append(
                build_ai_step(
                    step_id         = step_id,
                    prompt          = enriched_prompt,
                    output_variable = f"step_{step_id}_result",
                    on_failure      = "notify_user"
                )
            )
            continue

        # Handle knowledge_read BEFORE mapping
        if any(kw in desc.lower() for kw in ("read knowledge", "load knowledge", "get knowledge", "fetch knowledge")):
            parts = desc.lower().split()
            k_idx = next((i for i, w in enumerate(parts) if w == "knowledge"), -1)
            k_path = parts[k_idx + 1] if k_idx >= 0 and k_idx + 1 < len(parts) else ""
            skill["requires"]["knowledge_access"].append(k_path) if k_path and k_path not in skill["requires"]["knowledge_access"] else None
            skill["steps"].append(
                build_knowledge_read_step(
                    step_id         = step_id,
                    knowledge_path  = k_path,
                    output_variable = f"step_{step_id}_knowledge",
                    on_failure      = "notify_user"
                )
            )
            continue

        # System step — map to action
        mapping = map_step_to_action(desc)
        if not mapping["matched"]:
            unresolved.append({
                "step_id": step_id,
                "raw":     desc,
                "reason":  mapping["reason"]
            })
            continue

        action = mapping["action"]

        

        # Flag capability mismatches as warnings (not blockers — fallback handles it)
        if action in _REQUIRES_VLA and not capabilities.get("vla"):
            print(f"[Parser] Warning: Step {step_id} uses VLA action '{action}' but VLA not available. Fallback will handle.", file=sys.stderr)
        if action in _REQUIRES_BROWSER and not capabilities.get("browser_automation"):
            print(f"[Parser] Warning: Step {step_id} uses browser action '{action}' but browser not available. Fallback will handle.", file=sys.stderr)

        # Update requires block
        if action in _REQUIRES_VLA:
            skill["requires"]["vla"] = True
        if action in _REQUIRES_BROWSER:
            skill["requires"]["browser_automation"] = True
        if action in _REQUIRES_ACCESIBILITY:
            skill["requires"]["accessibility_api"] = True
        if action in _REQUIRES_INTERNET:
            skill["requires"]["internet"] = True

        # Auto-detect knowledge_read steps and add to knowledge_access
        if "knowledge" in desc.lower():
            k_path = _extract_params(desc, "knowledge_read")
            if k_path and k_path[0] not in skill["requires"]["knowledge_access"]:
                skill["requires"]["knowledge_access"].append(k_path[0] if k_path else desc)

        params = _extract_params(desc, action)

        # Auto-wire write_file content from NEAREST previous AI step
        if action == "write_file" and len(params) >= 1:
            prev_ai = next(
                (s for s in reversed(skill["steps"]) if s.get("type") == "ai"),
                None
            )
            if prev_ai:
                out_var = prev_ai.get("output_variable", f"step_{prev_ai['step_id']}_result")
                params = [params[0], f"{{{{{out_var}}}}}"]

        on_fail = "skip" if (action == "browser_open" and len(params) == 0) else "notify_user"
        if action == "knowledge_read":
            k_path = _extract_params(desc, "knowledge_read")
            skill["steps"].append(
                build_knowledge_read_step(
                    step_id         = step_id,
                    knowledge_path  = k_path[0] if k_path else "",
                    output_variable = f"step_{step_id}_knowledge",
                    on_failure      = "notify_user"
                )
            )
        else:
            skill["steps"].append(
                build_system_step(
                    step_id    = step_id,
                    action     = action,
                    params     = params,
                    on_failure = on_fail
                )
            )

    # Auto-set output variable to last step AFTER all steps are built
    for step in reversed(skill["steps"]):
        step_id = step.get("step_id")
        if step.get("type") == "ai":
            skill["output"]["variable"] = f"step_{step_id}_result"
            break
        elif step.get("type") == "system":
            skill["output"]["variable"] = f"step_{step_id}_result"
            break

    return {
        "success":    True,
        "skill":      skill,
        "unresolved": unresolved
    }


# ─────────────────────────────────────────────
# 6. Main — Parse from Conversation
# ─────────────────────────────────────────────

def parse_skill_from_conversation(conversation_history: list[dict], steps_text: str = "", skill_name: str = "", description: str = "", knowledge_access: list = None) -> dict:
    """
    Entry point. Takes full conversation history, extracts skill definition.

    Args:
        conversation_history: [ { "role": "user"/"assistant", "content": "..." }, ... ]

    Returns:
        {
            "success":    True/False,
            "skill":      { ...complete skill JSON... },
            "unresolved": [ { step_id, raw, reason } ],  # steps needing clarification
            "errors":     [ "..." ]
        }
    """
    errors = []

    # Combine all user messages into one block for parsing
    user_text = "\n".join(
        msg["content"]
        for msg in conversation_history
        if msg.get("role") == "user"
    )

    if not user_text.strip():
        return {"success": False, "skill": None, "unresolved": [], "errors": ["No user messages found."]}

    # Use passed skill_name — only extract from text if not provided
    if not skill_name:
        skill_name = extract_skill_name(user_text) or "unnamed_skill"

    # Warn if skill already exists
    if skill_exists(skill_name):
        errors.append(f"Skill '{skill_name}' already exists. Ask user to confirm overwrite.")

    triggers = extract_trigger_phrases(user_text)
    if not triggers and skill_name:
        triggers = [skill_name.replace("_", " ")]

    steps = extract_steps(steps_text if steps_text else user_text)
    if not steps:
        errors.append("No steps found. Ask user to describe the steps clearly (numbered list works best).")

    # Build description from first assistant message if available
    description = next(
        (msg["content"][:200] for msg in conversation_history if msg.get("role") == "assistant"),
        ""
    )

    # Auto-detect {{variable}} placeholders in steps text
    import re as _re
    detected_inputs = []
    seen_vars = set()
    for step in steps:
        vars_found = _re.findall(r'\{\{(\w+)\}\}', step.get("raw", ""))
        for var in vars_found:
            if var not in seen_vars:
                seen_vars.add(var)
                detected_inputs.append({
                    "name": var,
                    "type": "string",
                    "required": True,
                    "source": "user_message"
                })

    parsed_data = {
        "skill_name":      skill_name,
        "description":     description,
        "trigger_phrases": triggers,
        "steps":           steps,
        "inputs":          detected_inputs
    }

    result = build_skill_json(parsed_data)
    result["errors"] = errors

    return result
