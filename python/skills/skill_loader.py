# skill_loader.py
# Syntx Labs — Skill Loader
# Loads and caches all skills from built_in/ and user_defined/ at startup

import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

# --- Path resolution ---

def get_skills_root() -> Path:
    return Path.home() / ".syntx-labs" / "skills"

def get_built_in_path() -> Path:
    return get_skills_root() / "built_in"

def get_user_defined_path() -> Path:
    return get_skills_root() / "user_defined"


# --- In-memory cache ---
# { "skill_name": { ...skill dict... } }

_skill_cache: dict[str, dict] = {}
_cache_loaded: bool = False


# --- Internal helpers ---

def _load_json_file(filepath: Path) -> Optional[dict]:
    """Reads a single JSON file and returns the parsed dict. Returns None on failure."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data
    except json.JSONDecodeError as e:
        print(f"[SkillLoader] JSON parse error in {filepath.name}: {e}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[SkillLoader] Failed to read {filepath.name}: {e}", file=sys.stderr)
        return None


def _load_from_folder(folder: Path, source_tag: str) -> dict[str, dict]:
    """
    Reads all .json files from a folder.
    Attaches a '_source' tag (built_in / user_defined) to each skill.
    Returns a dict keyed by skill_name.
    """
    loaded = {}

    if not folder.exists():
        print(f"[SkillLoader] Folder not found, skipping: {folder}", file=sys.stderr)
        return loaded

    for file in folder.glob("*.json"):
        skill = _load_json_file(file)
        if skill is None:
            continue

        name = skill.get("skill_name")
        if not name:
            print(f"[SkillLoader] Skipping {file.name} — missing 'skill_name'", file=sys.stderr)
            continue

        skill["_source"] = source_tag
        skill["_filepath"] = str(file)
        skill["_filesize"] = file.stat().st_size
        loaded[name] = skill

    return loaded


# --- Public API ---

def load_all_skills(force_reload: bool = False) -> list[dict]:
    """
    Reads all JSON files from built_in/ and user_defined/.
    Caches them in memory. Returns full list of skill dicts.
    Call this once at startup. Use force_reload=True to refresh cache.
    """
    global _skill_cache, _cache_loaded

    if _cache_loaded and not force_reload:
        return list(_skill_cache.values())

    _skill_cache.clear()

    built_in    = _load_from_folder(get_built_in_path(),    source_tag="built_in")
    user_defined = _load_from_folder(get_user_defined_path(), source_tag="user_defined")

    # user_defined overrides built_in if same skill_name exists
    _skill_cache.update(built_in)
    _skill_cache.update(user_defined)

    _cache_loaded = True
    print(f"[SkillLoader] Loaded {len(_skill_cache)} skill(s) into cache.", file=sys.stderr)

    return list(_skill_cache.values())


def load_skill(skill_name: str) -> Optional[dict]:
    """
    Returns a single skill dict by name.
    Pulls from cache. Returns None if not found.
    """
    if not _cache_loaded:
        load_all_skills()

    skill = _skill_cache.get(skill_name)
    if skill is None:
        print(f"[SkillLoader] Skill not found: '{skill_name}'", file=sys.stderr)
    return skill


def get_skill_list() -> list[dict]:
    """
    Returns a lightweight list of all skills.
    Each entry has: skill_name, description, version, _source.
    Use this for UI listing — no heavy step data.
    """
    if not _cache_loaded:
        load_all_skills()

    return [
        {
            "skill_name":    s.get("skill_name"),
            "description":   s.get("description", ""),
            "version":       s.get("version", "1.0"),
            "_source":       s.get("_source", "unknown"),
            "last_executed": s.get("last_executed", "—"),
            "knowledge_access": s.get("requires", {}).get("knowledge_access", []),
            "filesize":      s.get("_filesize", 0)
        }
        for s in _skill_cache.values()
    ]


def skill_exists(skill_name: str) -> bool:
    """Returns True if skill is in cache, False otherwise."""
    if not _cache_loaded:
        load_all_skills()

    return skill_name in _skill_cache


def invalidate_cache() -> None:
    """
    Clears the in-memory cache.
    Call this after creating, editing, or deleting a skill
    so next access picks up fresh data.
    """
    global _skill_cache, _cache_loaded
    _skill_cache.clear()
    _cache_loaded = False
    print("[SkillLoader] Cache invalidated.", file=sys.stderr)
