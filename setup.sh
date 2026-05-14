#!/bin/bash
echo "Setting up Syntx Labs..."

# Create folders
mkdir -p ~/.syntx-labs/base
mkdir -p ~/.syntx-labs/skills/built_in
mkdir -p ~/.syntx-labs/skills/user_defined
mkdir -p ~/.syntx-labs/workflows/user_defined
mkdir -p ~/.syntx-labs/flags
mkdir -p ~/.syntx-labs/syntx-python/skills

# Copy Python files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/python/action_library.py" ~/.syntx-labs/syntx-python/
cp "$SCRIPT_DIR/python/capability_checker.py" ~/.syntx-labs/syntx-python/
cp "$SCRIPT_DIR/python/skills/"*.py ~/.syntx-labs/syntx-python/skills/

# Install Python packages
pip install psutil playwright pyautogui pyperclip pillow --break-system-packages
python3 -m playwright install chromium

# Linux only
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    sudo apt install -y scrot gnome-screenshot python3-tk python3-dev sqlite3
fi

echo "Done! Now install Ollama from https://ollama.ai"
echo "Then run: ollama pull (model name)"
