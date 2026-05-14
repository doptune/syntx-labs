# workflow_manager.py
# Syntx Labs — Workflow Manager
# Handles saving and deleting workflows to disk + cache invalidation.

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from workflow_loader import (
    get_user_defined_path,
    workflow_exists,
    load_workflow,
    invalidate_cache
)


# ─────────────────────────────────────────────
# Save Workflow
# ─────────────────────────────────────────────

def save_workflow(workflow_json: dict) -> dict:
    """
    Saves a workflow JSON to disk inside user_defined/.
    Invalidates cache after save.

    Returns:
        { "success": True, "path": "..." }
        { "success": False, "error": "..." }
    """
    try:
        name = workflow_json.get("workflow_name", "").strip()
        if not name:
            return {"success": False, "error": "Workflow has no 'workflow_name'."}

        if not workflow_json.get("steps"):
            return {"success": False, "error": "Workflow has no steps."}

        folder   = get_user_defined_path()
        filepath = folder / f"{name}.json"

        # Update last_modified timestamp
        workflow_json["last_modified"] = datetime.now(timezone.utc).isoformat()

        folder.mkdir(parents=True, exist_ok=True)

        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(workflow_json, f, indent=2, ensure_ascii=False)

        invalidate_cache()
        print(f"[WorkflowManager] Saved: {filepath}", file=sys.stderr)
        return {"success": True, "path": str(filepath)}

    except PermissionError:
        return {"success": False, "error": "Permission denied writing to workflows folder."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
# Delete Workflow
# ─────────────────────────────────────────────

def delete_workflow(workflow_name: str) -> dict:
    """
    Deletes a workflow JSON from disk.
    Invalidates cache after delete.

    Returns:
        { "success": True, "deleted": "workflow_name" }
        { "success": False, "error": "..." }
    """
    try:
        if not workflow_name or not workflow_name.strip():
            return {"success": False, "error": "Workflow name cannot be empty."}

        if not workflow_exists(workflow_name):
            return {"success": False, "error": f"Workflow '{workflow_name}' not found."}

        filepath = get_user_defined_path() / f"{workflow_name}.json"
        if not filepath.exists():
            return {"success": False, "error": f"Workflow file not found: {filepath}"}

        os.remove(filepath)
        invalidate_cache()

        print(f"[WorkflowManager] Deleted: {filepath}", file=sys.stderr)
        return {"success": True, "deleted": workflow_name}

    except PermissionError:
        return {"success": False, "error": "Permission denied deleting workflow file."}
    except Exception as e:
        return {"success": False, "error": str(e)}
