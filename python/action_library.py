"""
Syntx Labs — Action Library
============================
Every atomic action the system can perform.
Hardcoded, reliable, no AI involvement.

Level 1 — File System Actions
Level 2 — Process Control Actions
Level 3 — Application Control Actions
Level 4 — Screen and Browser Actions
"""

import os
import shutil
import subprocess
import platform
import psutil

# pyautogui and pyperclip require a display — lazy loaded only when needed
# so the rest of the library works fine even in headless environments
_pyautogui = None
_pyperclip = None

def _get_pyautogui():
    global _pyautogui
    if _pyautogui is None:
        try:
            import pyautogui
            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = 0.1
            _pyautogui = pyautogui
        except Exception as e:
            raise ImportError(f"pyautogui unavailable: {e}")
    return _pyautogui

def _get_pyperclip():
    global _pyperclip
    if _pyperclip is None:
        try:
            import pyperclip
            _pyperclip = pyperclip
        except Exception as e:
            raise ImportError(f"pyperclip unavailable: {e}")
    return _pyperclip


# ─────────────────────────────────────────────
#  LEVEL 1 — FILE SYSTEM ACTIONS
# ─────────────────────────────────────────────

def read_file(path: str) -> dict:
    """
    Read and return the contents of a file.

    Returns:
        { "success": True, "content": "..." }
        { "success": False, "error": "..." }
    """
    try:
        abs_path = os.path.abspath(path)
        if not os.path.exists(abs_path):
            return {"success": False, "error": f"File not found: {abs_path}"}
        if not os.path.isfile(abs_path):
            return {"success": False, "error": f"Path is not a file: {abs_path}"}
        with open(abs_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"success": True, "content": content}
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def write_file(path: str, content: str) -> dict:
    """
    Write content to a file. Creates the file if it doesn't exist.
    Overwrites if it does.

    Returns:
        { "success": True, "path": "..." }
        { "success": False, "error": "..." }
    """
    try:
        abs_path = os.path.abspath(path)
        parent_dir = os.path.dirname(abs_path)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)
        with open(abs_path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": True, "path": abs_path}
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def create_folder(path: str) -> dict:
    """
    Create a directory (and any missing parents).

    Returns:
        { "success": True, "path": "..." }
        { "success": False, "error": "..." }
    """
    try:
        abs_path = os.path.abspath(path)
        os.makedirs(abs_path, exist_ok=True)
        return {"success": True, "path": abs_path}
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_file(path: str) -> dict:
    """
    Delete a file. Does NOT delete folders — use a dedicated folder delete if needed.

    Returns:
        { "success": True, "path": "..." }
        { "success": False, "error": "..." }
    """
    try:
        abs_path = os.path.abspath(path)
        if not os.path.exists(abs_path):
            return {"success": False, "error": f"File not found: {abs_path}"}
        if not os.path.isfile(abs_path):
            return {"success": False, "error": f"Path is not a file (use delete_folder for directories): {abs_path}"}
        os.remove(abs_path)
        return {"success": True, "path": abs_path}
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def move_file(src: str, dest: str) -> dict:
    """
    Move a file from src to dest.
    If dest is a directory, the file is moved inside it.
    If dest is a full path, the file is moved and renamed.

    Returns:
        { "success": True, "src": "...", "dest": "..." }
        { "success": False, "error": "..." }
    """
    try:
        abs_src = os.path.abspath(src)
        abs_dest = os.path.abspath(dest)
        if not os.path.exists(abs_src):
            return {"success": False, "error": f"Source not found: {abs_src}"}
        if not os.path.isfile(abs_src):
            return {"success": False, "error": f"Source is not a file: {abs_src}"}
        dest_parent = abs_dest if os.path.isdir(abs_dest) else os.path.dirname(abs_dest)
        if dest_parent:
            os.makedirs(dest_parent, exist_ok=True)
        shutil.move(abs_src, abs_dest)
        return {"success": True, "src": abs_src, "dest": abs_dest}
    except PermissionError:
        return {"success": False, "error": f"Permission denied"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def list_files(path: str) -> dict:
    """
    List all files (not folders) inside a directory.

    Returns:
        { "success": True, "files": ["file1.txt", ...] }
        { "success": False, "error": "..." }
    """
    try:
        abs_path = os.path.abspath(path)
        if not os.path.exists(abs_path):
            return {"success": False, "error": f"Directory not found: {abs_path}"}
        if not os.path.isdir(abs_path):
            return {"success": False, "error": f"Path is not a directory: {abs_path}"}
        files = [
            f for f in os.listdir(abs_path)
            if os.path.isfile(os.path.join(abs_path, f))
        ]
        return {"success": True, "files": files}
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
#  LEVEL 2 — PROCESS CONTROL ACTIONS
# ─────────────────────────────────────────────

def open_terminal() -> dict:
    """
    Open the system default terminal emulator.
    Detects OS automatically — Windows, macOS, Linux.

    Returns:
        { "success": True, "terminal": "..." }
        { "success": False, "error": "..." }
    """
    try:
        system = platform.system()

        if system == "Windows":
            subprocess.Popen(["cmd.exe"], creationflags=subprocess.CREATE_NEW_CONSOLE)
            terminal = "cmd.exe"

        elif system == "Darwin":  # macOS
            subprocess.Popen(["open", "-a", "Terminal"])
            terminal = "Terminal.app"

        elif system == "Linux":
            # Try common terminal emulators in order of preference
            terminals = [
                "gnome-terminal", "konsole", "xfce4-terminal",
                "xterm", "lxterminal", "mate-terminal", "tilix"
            ]
            launched = None
            for term in terminals:
                if shutil.which(term):
                    subprocess.Popen([term])
                    launched = term
                    break
            if not launched:
                return {"success": False, "error": "No terminal emulator found. Install gnome-terminal, konsole, or xterm."}
            terminal = launched

        else:
            return {"success": False, "error": f"Unsupported OS: {system}"}

        return {"success": True, "terminal": terminal}

    except FileNotFoundError as e:
        return {"success": False, "error": f"Terminal binary not found: {str(e)}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def run_command(command: str) -> dict:
    """
    Execute a shell command and return its output.
    Runs synchronously — waits for the command to finish.

    Returns:
        { "success": True, "stdout": "...", "stderr": "...", "returncode": 0 }
        { "success": False, "error": "..." }
    """
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=60  # 60 second timeout — prevents hanging forever
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Command timed out after 60 seconds."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def install_package(package_name: str, manager: str = "pip") -> dict:
    """
    Install a package using pip or npm.

    Args:
        package_name: Name of the package to install.
        manager: "pip" (default) or "npm"

    Returns:
        { "success": True, "stdout": "...", "package": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not package_name or not package_name.strip():
            return {"success": False, "error": "Package name cannot be empty."}

        manager = manager.lower().strip()

        if manager == "pip":
            command = f"pip install {package_name}"
        elif manager == "npm":
            command = f"npm install {package_name}"
        else:
            return {"success": False, "error": f"Unsupported package manager: '{manager}'. Use 'pip' or 'npm'."}

        result = run_command(command)

        # On some Linux distros pip requires --break-system-packages — retry automatically
        if not result["success"] and manager == "pip" and "externally-managed-environment" in result.get("stderr", ""):
            result = run_command(f"pip install {package_name} --break-system-packages")

        if result["success"]:
            return {"success": True, "package": package_name, "manager": manager, "stdout": result["stdout"]}
        else:
            return {"success": False, "error": result["stderr"] or result["stdout"], "package": package_name}

    except Exception as e:
        return {"success": False, "error": str(e)}


def kill_process(process_name: str) -> dict:
    """
    Kill all running processes matching the given name.

    Args:
        process_name: The process name to search and kill (e.g. "chrome", "node").

    Returns:
        { "success": True, "killed": 2, "process": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not process_name or not process_name.strip():
            return {"success": False, "error": "Process name cannot be empty."}

        killed = 0
        not_found = True

        for proc in psutil.process_iter(["name", "pid"]):
            try:
                if process_name.lower() in proc.info["name"].lower():
                    not_found = False
                    proc.kill()
                    killed += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                # Process already died or no permission — skip silently
                continue

        if not_found:
            return {"success": False, "error": f"No process found with name: '{process_name}'"}

        return {"success": True, "process": process_name, "killed": killed}

    except Exception as e:
        return {"success": False, "error": str(e)}


def check_process_running(name: str) -> dict:
    """
    Check whether a process with the given name is currently running.

    Args:
        name: Process name to search for (e.g. "chrome", "python").

    Returns:
        { "success": True, "running": True/False, "matches": ["proc1", ...] }
        { "success": False, "error": "..." }
    """
    try:
        if not name or not name.strip():
            return {"success": False, "error": "Process name cannot be empty."}

        matches = []
        for proc in psutil.process_iter(["name", "pid"]):
            try:
                if name.lower() in proc.info["name"].lower():
                    matches.append({"name": proc.info["name"], "pid": proc.info["pid"]})
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        return {
            "success": True,
            "running": len(matches) > 0,
            "matches": matches
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
#  LEVEL 3 — APPLICATION CONTROL ACTIONS
# ─────────────────────────────────────────────


def open_app(app_name: str) -> dict:
    """
    Launch an application by name.
    Detects OS and uses the right launch method automatically.

    Args:
        app_name: App name or full path (e.g. "firefox", "gedit", "/usr/bin/vlc")

    Returns:
        { "success": True, "app": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not app_name or not app_name.strip():
            return {"success": False, "error": "App name cannot be empty."}

        system = platform.system()

        if system == "Windows":
            subprocess.Popen(["start", app_name], shell=True)
        elif system == "Darwin":
            subprocess.Popen(["open", "-a", app_name])
        elif system == "Linux":
            # Check if the binary exists on PATH
            if not shutil.which(app_name) and not os.path.isfile(app_name):
                return {"success": False, "error": f"Application not found: '{app_name}'. Make sure it's installed and on PATH."}
            subprocess.Popen([app_name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            return {"success": False, "error": f"Unsupported OS: {system}"}

        return {"success": True, "app": app_name}

    except FileNotFoundError:
        return {"success": False, "error": f"Application not found: '{app_name}'"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def close_app(app_name: str) -> dict:
    """
    Close all running instances of an application by process name.
    Tries graceful terminate first, then force kills if needed.

    Args:
        app_name: Process name to close (e.g. "firefox", "gedit")

    Returns:
        { "success": True, "closed": 2, "app": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not app_name or not app_name.strip():
            return {"success": False, "error": "App name cannot be empty."}

        closed = 0
        not_found = True

        for proc in psutil.process_iter(["name", "pid"]):
            try:
                if app_name.lower() in proc.info["name"].lower():
                    not_found = False
                    proc.terminate()  # Graceful first
                    try:
                        proc.wait(timeout=3)  # Give it 3 seconds to close
                    except psutil.TimeoutExpired:
                        proc.kill()  # Force kill if it didn't close
                    closed += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        if not_found:
            return {"success": False, "error": f"No running application found: '{app_name}'"}

        return {"success": True, "app": app_name, "closed": closed}

    except Exception as e:
        return {"success": False, "error": str(e)}


def type_text(text: str) -> dict:
    """
    Type text at the current cursor position using pyautogui.
    Works in any focused input field.

    Args:
        text: The text to type.

    Returns:
        { "success": True, "typed": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if text is None:
            return {"success": False, "error": "Text cannot be None."}

        pyautogui = _get_pyautogui()
        pyautogui.typewrite(text, interval=0.05)  # 50ms between keystrokes — natural speed
        return {"success": True, "typed": text}

    except Exception as _fse:
        if "failsafe" in str(_fse).lower() or "FailSafeException" in type(_fse).__name__:
            return {"success": False, "error": "PyAutoGUI failsafe triggered."}
        return {"success": False, "error": "PyAutoGUI failsafe triggered — mouse moved to top-left corner."}


def press_key(key: str) -> dict:
    """
    Press a single keyboard key or key combination.
    Supports pyautogui key names: 'enter', 'tab', 'ctrl+c', 'alt+f4', etc.

    Args:
        key: Key name or combo (e.g. "enter", "ctrl+s", "alt+tab")

    Returns:
        { "success": True, "key": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not key or not key.strip():
            return {"success": False, "error": "Key cannot be empty."}

        pyautogui = _get_pyautogui()
        if "+" in key:
            parts = [k.strip() for k in key.split("+")]
            pyautogui.hotkey(*parts)
        else:
            pyautogui.press(key.strip())

        return {"success": True, "key": key}

    except ImportError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def click_position(x: int, y: int) -> dict:
    """
    Click at a specific screen coordinate.

    Args:
        x: Horizontal screen position in pixels.
        y: Vertical screen position in pixels.

    Returns:
        { "success": True, "x": ..., "y": ... }
        { "success": False, "error": "..." }
    """
    try:
        pyautogui = _get_pyautogui()
        screen_w, screen_h = pyautogui.size()

        if not (0 <= x <= screen_w) or not (0 <= y <= screen_h):
            return {
                "success": False,
                "error": f"Coordinates ({x}, {y}) are outside screen bounds ({screen_w}x{screen_h})."
            }

        pyautogui.click(x, y)
        return {"success": True, "x": x, "y": y}

    except Exception as _fse:
        if "failsafe" in str(_fse).lower() or "FailSafeException" in type(_fse).__name__:
            return {"success": False, "error": "PyAutoGUI failsafe triggered."}
        return {"success": False, "error": "PyAutoGUI failsafe triggered — mouse moved to top-left corner."}


def scroll(direction: str, amount: int) -> dict:
    """
    Scroll the screen up or down at the current mouse position.

    Args:
        direction: "up" or "down"
        amount: Number of scroll clicks (e.g. 3)

    Returns:
        { "success": True, "direction": "...", "amount": ... }
        { "success": False, "error": "..." }
    """
    try:
        if not direction or direction.lower().strip() not in ("up", "down"):
            return {"success": False, "error": "Direction must be 'up' or 'down'."}
        if not isinstance(amount, int) or amount <= 0:
            return {"success": False, "error": "Amount must be a positive integer."}

        pyautogui = _get_pyautogui()
        direction = direction.lower().strip()
        clicks = amount if direction == "up" else -amount
        pyautogui.scroll(clicks)

        return {"success": True, "direction": direction, "amount": amount}

    except Exception as _fse:
        if "failsafe" in str(_fse).lower() or "FailSafeException" in type(_fse).__name__:
            return {"success": False, "error": "PyAutoGUI failsafe triggered."}
        return {"success": False, "error": "PyAutoGUI failsafe triggered — mouse moved to top-left corner."}


def copy_to_clipboard(text: str) -> dict:
    """
    Copy text to the system clipboard.

    Args:
        text: Text to copy.

    Returns:
        { "success": True, "copied": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if text is None:
            return {"success": False, "error": "Text cannot be None."}

        pyperclip = _get_pyperclip()
        pyperclip.copy(text)
        return {"success": True, "copied": text}

    except ImportError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e)}


def paste_from_clipboard() -> dict:
    """
    Get the current text content from the system clipboard.

    Returns:
        { "success": True, "content": "..." }
        { "success": False, "error": "..." }
    """
    try:
        pyperclip = _get_pyperclip()
        content = pyperclip.paste()
        return {"success": True, "content": content}

    except ImportError as e:
        return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─────────────────────────────────────────────
#  LEVEL 4 — SCREEN AND BROWSER ACTIONS
# ─────────────────────────────────────────────
#
#  Three tiers:
#    A) Accessibility-based  — no vision needed, reads UI tree
#    B) Browser automation   — Playwright, headless Chromium
#    C) VLA-dependent        — screenshot + vision model (Claude)
#
#  Browser state is held in a module-level singleton so multiple
#  calls share the same browser session without reopening it.
# ─────────────────────────────────────────────

import base64
import io

# ── Browser singleton ──────────────────────────────────────────
_browser_context = {
    "playwright": None,
    "browser":    None,
    "page":       None,
}

def _get_page():
    """
    Return the active Playwright page, launching browser if needed.
    Uses a persistent singleton so every browser_* call shares one session.
    """
    import asyncio
    from playwright.sync_api import sync_playwright

    ctx = _browser_context
    if ctx["page"] is None:
        pw          = sync_playwright().start()
        browser     = pw.chromium.launch(headless=False)
        page        = browser.new_page()
        ctx["playwright"] = pw
        ctx["browser"]    = browser
        ctx["page"]       = page
    return ctx["page"]


# ── A) ACCESSIBILITY-BASED ACTIONS ────────────────────────────

def get_accessibility_tree() -> dict:
    """
    Return the desktop accessibility tree using AT-SPI (Linux).
    Walks the top-level desktop node and returns a structured list
    of every visible UI element with its role, name, and state.

    Returns:
        { "success": True, "tree": [ { "role": ..., "name": ..., "state": ... }, ... ] }
        { "success": False, "error": "..." }
    """
    try:
        import gi
        gi.require_version("Atspi", "2.0")
        from gi.repository import Atspi

        desktop = Atspi.get_desktop(0)
        tree    = []

        def walk(node, depth=0):
            if depth > 6:          # cap depth — prevents infinite recursion
                return
            try:
                role  = node.get_role_name()
                name  = node.get_name() or ""
                state = [s for s in str(node.get_state_set()).split() if s]
                tree.append({"role": role, "name": name, "depth": depth, "state": state})
                for i in range(node.get_child_count()):
                    walk(node.get_child_at_index(i), depth + 1)
            except Exception:
                pass   # skip inaccessible nodes silently

        walk(desktop)
        return {"success": True, "tree": tree}

    except ImportError:
        return {
            "success": False,
            "error": "AT-SPI not available. Install with: sudo apt install python3-gi gir1.2-atspi-2.0"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def find_element_by_name(name: str) -> dict:
    """
    Search the accessibility tree for a UI element matching the given name.
    Case-insensitive partial match.

    Args:
        name: Text label to search for (e.g. "Save", "File", "OK")

    Returns:
        { "success": True, "matches": [ { "role": ..., "name": ... }, ... ] }
        { "success": False, "error": "..." }
    """
    try:
        if not name or not name.strip():
            return {"success": False, "error": "Element name cannot be empty."}

        result = get_accessibility_tree()
        if not result["success"]:
            return result

        matches = [
            el for el in result["tree"]
            if name.lower() in el["name"].lower()
        ]
        return {
            "success": True,
            "matches": matches,
            "count":   len(matches)
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def find_element_by_role(role: str) -> dict:
    """
    Search the accessibility tree for all elements matching a given role.
    Common roles: "button", "input", "menu", "label", "check box", "combo box"

    Args:
        role: AT-SPI role name to search for.

    Returns:
        { "success": True, "matches": [...], "count": N }
        { "success": False, "error": "..." }
    """
    try:
        if not role or not role.strip():
            return {"success": False, "error": "Role cannot be empty."}

        result = get_accessibility_tree()
        if not result["success"]:
            return result

        matches = [
            el for el in result["tree"]
            if role.lower() in el["role"].lower()
        ]
        return {
            "success": True,
            "matches": matches,
            "count":   len(matches)
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ── B) BROWSER AUTOMATION ACTIONS ─────────────────────────────

def browser_open(url: str) -> dict:
    """
    Open a URL in the managed Playwright Chromium browser.
    Launches the browser automatically on first call.

    Args:
        url: Full URL including scheme (e.g. "https://google.com")

    Returns:
        { "success": True, "url": "...", "title": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not url or not url.strip():
            return {"success": False, "error": "URL cannot be empty."}
        if not url.startswith(("http://", "https://")):
            url = "https://" + url   # be forgiving — add scheme if missing

        page = _get_page()
        page.goto(url, timeout=15000)
        return {"success": True, "url": page.url, "title": page.title()}

    except Exception as e:
        return {"success": False, "error": str(e)}


def browser_find_element(selector: str) -> dict:
    """
    Find an element in the current browser page by CSS selector or visible text.
    Tries CSS selector first, then falls back to text search.

    Args:
        selector: CSS selector (e.g. "#submit-btn") or visible text (e.g. "Sign In")

    Returns:
        { "success": True, "found": True, "selector": "...", "text": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not selector or not selector.strip():
            return {"success": False, "error": "Selector cannot be empty."}

        page = _get_page()

        # Try CSS selector first
        el = page.query_selector(selector)

        # Fall back to text match
        if el is None:
            el = page.query_selector(f"text={selector}")

        if el is None:
            return {"success": False, "error": f"No element found for: '{selector}'"}

        inner_text = el.inner_text() if el else ""
        return {
            "success":  True,
            "found":    True,
            "selector": selector,
            "text":     inner_text[:200]   # cap output length
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def browser_click(selector: str) -> dict:
    """
    Click an element in the current browser page.

    Args:
        selector: CSS selector or visible text of the element to click.

    Returns:
        { "success": True, "clicked": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not selector or not selector.strip():
            return {"success": False, "error": "Selector cannot be empty."}

        page = _get_page()

        el = page.query_selector(selector) or page.query_selector(f"text={selector}")
        if el is None:
            return {"success": False, "error": f"No element found for: '{selector}'"}

        el.click()
        return {"success": True, "clicked": selector}

    except Exception as e:
        return {"success": False, "error": str(e)}


def browser_type(selector: str, text: str) -> dict:
    """
    Type text into a browser input field.

    Args:
        selector: CSS selector or visible text of the input.
        text:     Text to type.

    Returns:
        { "success": True, "selector": "...", "typed": "..." }
        { "success": False, "error": "..." }
    """
    try:
        if not selector or not selector.strip():
            return {"success": False, "error": "Selector cannot be empty."}
        if text is None:
            return {"success": False, "error": "Text cannot be None."}

        page = _get_page()

        el = page.query_selector(selector) or page.query_selector(f"text={selector}")
        if el is None:
            return {"success": False, "error": f"No element found for: '{selector}'"}

        el.fill(text)
        return {"success": True, "selector": selector, "typed": text}

    except Exception as e:
        return {"success": False, "error": str(e)}


def browser_get_content() -> dict:
    """
    Return the full visible text content of the current browser page.

    Returns:
        { "success": True, "url": "...", "title": "...", "content": "..." }
        { "success": False, "error": "..." }
    """
    try:
        page    = _get_page()
        content = page.inner_text("body")
        return {
            "success": True,
            "url":     page.url,
            "title":   page.title(),
            "content": content
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


def browser_screenshot() -> dict:
    """
    Take a screenshot of the current browser page.
    Returns the image as a base64-encoded PNG string.

    Returns:
        { "success": True, "image_base64": "...", "format": "png" }
        { "success": False, "error": "..." }
    """
    try:
        page       = _get_page()
        img_bytes  = page.screenshot(type="png", full_page=False)
        b64        = base64.b64encode(img_bytes).decode("utf-8")
        return {"success": True, "image_base64": b64, "format": "png"}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ── C) VLA-DEPENDENT ACTIONS ──────────────────────────────────

def take_screenshot() -> dict:
    try:
        import subprocess, os, time, base64, tempfile
        tmp = os.path.expanduser("~/.syntx-labs/screenshot_tmp.png")
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        time.sleep(1)

        system = __import__('platform').system()

        if system == "Linux":
            subprocess.run(["scrot", tmp], capture_output=True, timeout=10)
            if not os.path.exists(tmp):
                subprocess.run(["gnome-screenshot", "-f", tmp], capture_output=True, timeout=15)

        elif system == "Darwin":  # macOS
            subprocess.run(["screencapture", "-x", tmp], capture_output=True, timeout=10)

        elif system == "Windows":
            import ctypes
            # Use PowerShell on Windows
            subprocess.run([
                "powershell", "-command",
                f"Add-Type -AssemblyName System.Windows.Forms; "
                f"[System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object {{ "
                f"$bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); "
                f"$g = [System.Drawing.Graphics]::FromImage($bmp); "
                f"$g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); "
                f"$bmp.Save('{tmp}') }}"
            ], capture_output=True, timeout=15)

        if not os.path.exists(tmp):
            return {{"success": False, "error": "Screenshot failed on this platform."}}

        with open(tmp, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        os.remove(tmp)
        return {{"success": True, "image_base64": b64, "format": "png"}}

    except Exception as e:
        return {{"success": False, "error": str(e)}}


def pass_to_vision_model(screenshot_path: str, prompt: str) -> dict:
    try:
        import base64, urllib.request, json as _json, os

        if not os.path.exists(screenshot_path):
            return {"success": False, "error": f"Screenshot file not found: {screenshot_path}"}

        with open(screenshot_path, "rb") as f:
            image_base64 = base64.b64encode(f.read()).decode("utf-8")

        payload = _json.dumps({
            "model": "moondream",
            "prompt": f"Describe in detail what you see in this screenshot. {prompt}",
            "images": [image_base64],
            "stream": False
        }).encode()

        req = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"}
        )

        with urllib.request.urlopen(req, timeout=300) as resp:
            data = _json.loads(resp.read())
            response = data.get("response", "").strip()

        # Clean up screenshot file
        os.remove(screenshot_path)

        return {"success": True, "response": response, "prompt": prompt}

    except Exception as e:
        return {"success": False, "error": str(e)}
    
# ─────────────────────────────────────────────
#  ACTION REGISTRY — for validator use
# ─────────────────────────────────────────────

def get_all_actions() -> list:
    """Returns all valid system action names. Used by skill_validator."""
    return [
        # Level 1 — File System
        "read_file", "write_file", "create_folder", "delete_file",
        "move_file", "list_files",
        # Level 2 — Process Control
        "open_terminal", "run_command", "install_package",
        "kill_process", "check_process_running",
        # Level 3 — Application Control
        "open_app", "close_app", "type_text", "press_key",
        "click_position", "scroll", "copy_to_clipboard", "paste_from_clipboard",
        # Level 4 — Screen & Browser
        "get_accessibility_tree", "find_element_by_name", "find_element_by_role",
        "browser_open", "browser_find_element", "browser_click",
        "browser_type", "browser_get_content", "browser_screenshot",
        "take_screenshot", "pass_to_vision_model",
    ]
