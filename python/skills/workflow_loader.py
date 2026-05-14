# workflow_loader.py
# Syntx Labs — Workflow Loader
# Loads and caches all workflows from disk at startup

import json
import os
import sys
from pathlib import Path
from typing import Optional

# --- Path resolution ---

def get_workflows_root() -> Path:
    return Path.home() / ".syntx-labs" / "workflows"

def get_user_defined_path() -> Path:
    return get_workflows_root() / "user_defined"


# --- In-memory cache ---
_workflow_cache: dict[str, dict] = {}
_cache_loaded: bool = False


# --- Internal helpers ---

def _load_json_file(filepath: Path) -> Optional[dict]:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"[WorkflowLoader] JSON parse error in {filepath.name}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[WorkflowLoader] Failed to read {filepath.name}: {e}", file=sys.stderr)
        return None


def _load_from_folder(folder: Path) -> dict[str, dict]:
    loaded = {}
    if not folder.exists():
        print(f"[WorkflowLoader] Folder not found, skipping: {folder}", file=sys.stderr)
        return loaded

    for file in folder.glob("*.json"):
        workflow = _load_json_file(file)
        if workflow is None:
            continue
        name = workflow.get("workflow_name")
        if not name:
            print(f"[WorkflowLoader] Skipping {file.name} — missing 'workflow_name'", file=sys.stderr)
            continue
        workflow["_filepath"] = str(file)
        loaded[name] = workflow

    return loaded


# --- Public API ---

def load_all_workflows(force_reload: bool = False) -> list[dict]:
    global _workflow_cache, _cache_loaded

    if _cache_loaded and not force_reload:
        return list(_workflow_cache.values())

    _workflow_cache.clear()
    user_defined = _load_from_folder(get_user_defined_path())
    _workflow_cache.update(user_defined)
    _cache_loaded = True

    print(f"[WorkflowLoader] Loaded {len(_workflow_cache)} workflow(s) into cache.", file=sys.stderr)
    return list(_workflow_cache.values())


def load_workflow(workflow_name: str) -> Optional[dict]:
    if not _cache_loaded:
        load_all_workflows()
    workflow = _workflow_cache.get(workflow_name)
    if workflow is None:
        print(f"[WorkflowLoader] Workflow not found: '{workflow_name}'", file=sys.stderr)
    return workflow


def get_workflow_list() -> list[dict]:
    if not _cache_loaded:
        load_all_workflows()
    return [
        {
            "workflow_name": w.get("workflow_name"),
            "description":   w.get("description", ""),
            "version":       w.get("version", "1.0"),
            "steps_count":   len(w.get("steps", []))
        }
        for w in _workflow_cache.values()
    ]


def workflow_exists(workflow_name: str) -> bool:
    if not _cache_loaded:
        load_all_workflows()
    return workflow_name in _workflow_cache


def invalidate_cache() -> None:
    global _workflow_cache, _cache_loaded
    _workflow_cache.clear()
    _cache_loaded = False
    print("[WorkflowLoader] Cache invalidated.", file=sys.stderr)
