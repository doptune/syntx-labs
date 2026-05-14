"""
Syntx Labs — Capability Detection System
==========================================
Checks what the current user setup supports BEFORE any skill runs.
No cloud LLM checks. No API keys. Fully local detection only.

Run this before executing any skill to get the full capability profile.
"""

import os
import platform
import importlib
import importlib.util
import socket


# ─────────────────────────────────────────────
#  INDIVIDUAL CAPABILITY CHECKS
# ─────────────────────────────────────────────

def check_vla_available() -> dict:
    """
    Check if the currently loaded local model supports vision (VLA).
    Looks for a flag file that the model loader writes when a
    VLA-capable model is loaded into Syntx Labs.

    The flag file lives at: ~/.syntx-labs/flags/vla_enabled
    When a VLA model is loaded, the model loader creates this file.
    When a non-vision model is loaded, this file is deleted.

    Returns:
        { "success": True, "available": True/False, "reason": "..." }
        { "success": False, "error": "..." }
    """
    try:
        flag_path = os.path.expanduser("~/.syntx-labs/flags/vla_enabled")
        available = os.path.isfile(flag_path)
        reason    = "VLA flag file found." if available else \
                    "No VLA flag file at ~/.syntx-labs/flags/vla_enabled — load a vision-capable model first."
        return {"success": True, "available": available, "reason": reason}

    except Exception as e:
        return {"success": False, "error": str(e)}


def check_browser_available() -> dict:
    """
    Check if Playwright is installed AND Chromium browser is available.
    Both must be present for browser automation skills to work.

    Returns:
        { "success": True, "available": True/False, "reason": "..." }
        { "success": False, "error": "..." }
    """
    try:
        # Step 1 — is playwright installed?
        playwright_spec = importlib.util.find_spec("playwright")
        if playwright_spec is None:
            return {
                "success":   True,
                "available": False,
                "reason":    "Playwright not installed. Run: pip install playwright"
            }

        # Step 2 — is Chromium downloaded?
        from playwright.sync_api import sync_playwright
        try:
            pw      = sync_playwright().start()
            browser = pw.chromium.launch(headless=True)
            browser.close()
            pw.stop()
            return {"success": True, "available": True, "reason": "Playwright + Chromium ready."}
        except Exception as launch_err:
            return {
                "success":   True,
                "available": False,
                "reason":    f"Playwright installed but Chromium missing. Run: python3 -m playwright install chromium. Detail: {str(launch_err)}"
            }

    except Exception as e:
        return {"success": False, "error": str(e)}


def check_accessibility_available() -> dict:
    """
    Check if the AT-SPI accessibility API is available (Linux).
    Required for get_accessibility_tree, find_element_by_name/role.

    On Linux — checks for gi + Atspi bindings.
    On Windows — checks for pywinauto (UIAutomation).
    On macOS  — checks for ApplicationServices via pyobjc.

    Returns:
        { "success": True, "available": True/False, "reason": "...", "method": "..." }
        { "success": False, "error": "..." }
    """
    try:
        system = platform.system()

        if system == "Linux":
            try:
                import gi
                gi.require_version("Atspi", "2.0")
                from gi.repository import Atspi
                return {
                    "success":   True,
                    "available": True,
                    "method":    "AT-SPI",
                    "reason":    "AT-SPI accessibility API is available."
                }
            except Exception:
                return {
                    "success":   True,
                    "available": False,
                    "method":    "AT-SPI",
                    "reason":    "AT-SPI not available. Run: sudo apt install python3-gi gir1.2-atspi-2.0"
                }

        elif system == "Windows":
            spec = importlib.util.find_spec("pywinauto")
            if spec:
                return {"success": True, "available": True,  "method": "UIAutomation", "reason": "pywinauto available."}
            else:
                return {"success": True, "available": False, "method": "UIAutomation", "reason": "pywinauto not installed. Run: pip install pywinauto"}

        elif system == "Darwin":
            spec = importlib.util.find_spec("AppKit")
            if spec:
                return {"success": True, "available": True,  "method": "ApplicationServices", "reason": "pyobjc AppKit available."}
            else:
                return {"success": True, "available": False, "method": "ApplicationServices", "reason": "pyobjc not installed. Run: pip install pyobjc"}

        else:
            return {"success": True, "available": False, "method": "unknown", "reason": f"Unsupported OS: {system}"}

    except Exception as e:
        return {"success": False, "error": str(e)}


def check_internet_available() -> dict:
    """
    Check if the machine has an active internet connection.
    Does a lightweight socket connect to google.com:80 — no HTTP, no tracking.

    Returns:
        { "success": True, "available": True/False, "reason": "..." }
        { "success": False, "error": "..." }
    """
    try:
        socket.setdefaulttimeout(3)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("8.8.8.8", 53))
        return {"success": True, "available": True,  "reason": "Internet connection active."}
    except socket.error:
        return {"success": True, "available": False, "reason": "No internet connection detected."}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
#  FULL CAPABILITY PROFILE
# ─────────────────────────────────────────────

def get_system_capabilities() -> dict:
    """
    Run all capability checks and return a single unified profile.
    This is what the skill executor calls before running any skill.

    Returns:
        {
            "success": True,
            "profile": {
                "vla":                False,
                "browser_automation": True,
                "accessibility_api":  True,
                "internet":           True,
                "os":                 "ubuntu"
            }
        }
        { "success": False, "error": "..." }
    """
    try:
        vla           = check_vla_available()
        browser       = check_browser_available()
        accessibility = check_accessibility_available()
        internet      = check_internet_available()

        # Resolve OS to a clean readable name
        system = platform.system()
        if system == "Linux":
            # Try to get distro name (Ubuntu, Fedora, etc.)
            try:
                with open("/etc/os-release") as f:
                    lines = f.read().splitlines()
                distro_map = {line.split("=")[0]: line.split("=")[1].strip('"')
                              for line in lines if "=" in line}
                os_name = distro_map.get("NAME", "linux").lower().split()[0]
            except Exception:
                os_name = "linux"
        elif system == "Windows":
            os_name = "windows"
        elif system == "Darwin":
            os_name = "macos"
        else:
            os_name = system.lower()

        profile = {
            "vla":                vla.get("available", False),
            "browser_automation": browser.get("available", False),
            "accessibility_api":  accessibility.get("available", False),
            "internet":           internet.get("available", False),
            "os":                 os_name,
        }

        # Attach reasons for transparency — helpful for debugging skill failures
        reasons = {
            "vla":                vla.get("reason",  vla.get("error",  "check failed")),
            "browser_automation": browser.get("reason", browser.get("error", "check failed")),
            "accessibility_api":  accessibility.get("reason", accessibility.get("error", "check failed")),
            "internet":           internet.get("reason", internet.get("error", "check failed")),
        }

        return {
            "success": True,
            "profile": profile,
            "reasons": reasons
        }

    except Exception as e:
        return {"success": False, "error": str(e)}
