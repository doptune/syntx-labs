import sys
# skill_manager.py
# Syntx Labs — Skill Manager
# Handles saving and deleting skills to disk + cache invalidation.

import json
import os
from pathlib import Path
from datetime import datetime, timezone
from skill_loader import (
    get_built_in_path,
    get_user_defined_path,
    skill_exists,
    load_skill,
    invalidate_cache
)
from skill_validator import run_full_validation


# ─────────────────────────────────────────────
# Save Skill
# ─────────────────────────────────────────────

def save_skill(skill_json: dict) -> dict:
    """
    Saves a skill JSON to disk inside user_defined/.
    Validates before saving. Overwrites if skill already exists.
    Invalidates cache after save.

    Returns:
        { "success": True, "path": "..." }
        { "success": False, "error": "..." }
    """
    try:
        # Validate first — never save a broken skill
        validation = run_full_validation(skill_json)
        if not validation["valid"]:
            return {
                "success": False,
                "error": "Validation failed before save.",
                "errors": validation["errors"]
            }

        name = skill_json.get("skill_name", "").strip()
        if not name:
            return {"success": False, "error": "Skill has no 'skill_name'."}

        # Always save to user_defined — never touch built_in
        folder   = get_user_defined_path()
        filepath = folder / f"{name}.json"

        # Update last_modified timestamp
        skill_json["last_modified"] = datetime.now(timezone.utc).isoformat()

        folder.mkdir(parents=True, exist_ok=True)

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(skill_json, f, indent=2, ensure_ascii=False)

        invalidate_cache()
        print(f"[SkillManager] Saved: {filepath}", file=sys.stderr)
        return {"success": True, "path": str(filepath)}

    except PermissionError:
        return {"success": False, "error": f"Permission denied writing to skills folder."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Delete Skill
# ─────────────────────────────────────────────

def delete_skill(skill_name: str) -> dict:
    """
    Deletes a skill JSON from disk.
    Only user_defined skills can be deleted — built_in are protected.
    Invalidates cache after delete.

    Returns:
        { "success": True, "deleted": "skill_name" }
        { "success": False, "error": "..." }
    """
    try:
        if not skill_name or not skill_name.strip():
            return {"success": False, "error": "Skill name cannot be empty."}

        # Check it exists first
        if not skill_exists(skill_name):
            return {"success": False, "error": f"Skill '{skill_name}' not found."}

        # Load to check source
        skill = load_skill(skill_name)
        if skill and skill.get("_source") == "built_in":
            return {"success": False, "error": f"'{skill_name}' is a built-in skill and cannot be deleted."}

        filepath = get_user_defined_path() / f"{skill_name}.json"
        if not filepath.exists():
            return {"success": False, "error": f"Skill file not found: {filepath}"}

        os.remove(filepath)
        invalidate_cache()

        print(f"[SkillManager] Deleted: {filepath}", file=sys.stderr)
        return {"success": True, "deleted": skill_name}

    except PermissionError:
        return {"success": False, "error": "Permission denied deleting skill file."}
    except Exception as e:
        return {"success": False, "error": str(e)}
