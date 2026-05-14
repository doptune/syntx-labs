# Syntx Labs
### By Doptune — Good products for real people.

> A fully local AI training, automation, and skill execution platform.
> No cloud. No API keys. No tracking. Just your machine, your model, your data.

---

## Table of Contents

1. [What is Syntx Labs?](#what-is-syntx-labs)
2. [Architecture Overview](#architecture-overview)
3. [Requirements](#requirements)
4. [Installation](#installation)
5. [Folder Structure](#folder-structure)
6. [The Four Sections](#the-four-sections)
   - [Knowledge Ontology](#1-knowledge-ontology)
   - [Instruction Console](#2-instruction-console)
   - [Validation Chat Environment (VCE)](#3-validation-chat-environment-vce)
   - [Skill Constellation](#4-skill-constellation)
7. [Workflow Orchestrator](#workflow-orchestrator)
8. [Instruction Console — Full Command Reference](#instruction-console--full-command-reference)
9. [Skill System — Full Reference](#skill-system--full-reference)
10. [Workflow System — Full Reference](#workflow-system--full-reference)
11. [VCE — Full Reference](#vce--full-reference)
12. [Supported Models](#supported-models)
13. [Python Backend — File Reference](#python-backend--file-reference)
14. [Cross-Platform Notes](#cross-platform-notes)
15. [Contributing](#contributing)
16. [License](#license)

---

## What is Syntx Labs?

Syntx Labs is a desktop application built with **Tauri + Rust** (frontend shell) and **Python** (AI backend). It lets you:

- **Train a local AI** on your personal knowledge — facts, ideas, projects, theories
- **Build skills** — automated multi-step actions your AI can execute on your computer
- **Build workflows** — chains of skills with conditions and branching logic
- **Chat with your trained AI** in a clean validation environment
- **Automate your computer** — open apps, browse the web, write files, run commands, click things

Everything runs **100% locally**. Your data never leaves your machine.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   Tauri Shell                    │
│         (Rust — window, file system, IPC)        │
├─────────────────────────────────────────────────┤
│              Frontend (HTML/CSS/JS)              │
│   Knowledge Ontology | Console | VCE | Skills   │
├─────────────────────────────────────────────────┤
│           Python Backend (Skills Engine)         │
│  skill_executor | skill_parser | skill_validator │
│  workflow_executor | workflow_parser             │
│  action_library | capability_checker             │
├─────────────────────────────────────────────────┤
│              Local AI (Ollama)                   │
│         gemma2:2b (text) | moondream (vision)    │
├─────────────────────────────────────────────────┤
│              SQLite Knowledge DBs                │
│         ~/.syntx-labs/base/folder/sub.db         │
└─────────────────────────────────────────────────┘
```

**Data flow:**
1. User types in Instruction Console or VCE
2. JS calls Tauri via `invoke()`
3. Tauri spawns Python process
4. Python executes skill/workflow/training logic
5. Result returns through stdout → Tauri → JS → UI

---

## Requirements

### System
- **OS:** Linux (primary), macOS, Windows
- **RAM:** 8GB minimum, 16GB recommended
- **Storage:** 2GB+ free (for models)

### Software
- [Rust + Cargo](https://rustup.rs/) `1.70+`
- [Node.js](https://nodejs.org/) `18+`
- [Python](https://python.org/) `3.10+`
- [Ollama](https://ollama.ai/) — local model runner
- [Tauri CLI](https://tauri.app/) `v2`

### Python Packages
```bash
pip install psutil playwright pyautogui pyperclip pillow scrot --break-system-packages
python3 -m playwright install chromium
```

### Linux Only
```bash
sudo apt install python3-tk python3-dev gnome-screenshot scrot sqlite3
sudo apt install python3-gi gir1.2-atspi-2.0  # For accessibility API (optional)
```

### Models (via Ollama)
```bash
ollama pull gemma2:2b      # Text reasoning (required)
ollama pull moondream      # Vision / VLA (required for screenshot skills)
```

---

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/doptune/syntx-labs.git
cd syntx-labs
```

### 2. Create the required folder structure
```bash
mkdir -p ~/.syntx-labs/base
mkdir -p ~/.syntx-labs/skills/built_in
mkdir -p ~/.syntx-labs/skills/user_defined
mkdir -p ~/.syntx-labs/workflows/user_defined
mkdir -p ~/.syntx-labs/flags
mkdir -p ~/.syntx-labs/syntx-python/skills
```

### 3. Copy Python backend files
```bash
cp python/action_library.py        ~/.syntx-labs/syntx-python/
cp python/capability_checker.py    ~/.syntx-labs/syntx-python/
cp python/skills/*.py              ~/.syntx-labs/syntx-python/skills/
```

### 4. Install Rust dependencies and build
```bash
cd src-tauri
cargo build
```

### 5. Run in development mode
```bash
cd ..
cargo tauri dev
```

### 6. Build for production
```bash
cargo tauri build
```

### 7. Enable VLA (Vision)
```bash
touch ~/.syntx-labs/flags/vla_enabled
```

---

## Folder Structure

```
~/.syntx-labs/
├── base/                          # Knowledge Ontology data
│   ├── science/
│   │   ├── quantum.db             # SQLite — facts + summary
│   │   └── biology.db
│   └── personal/
│       └── doptune.db
├── skills/
│   ├── built_in/                  # Read-only skills (shipped with app)
│   └── user_defined/              # Your created skills (JSON)
│       ├── quick_facts.json
│       └── code_writer.json
├── workflows/
│   └── user_defined/              # Your created workflows (JSON)
│       └── morning_routine.json
├── flags/
│   └── vla_enabled                # Flag file — enables vision model
├── sessions.json                  # Instruction Console session history
├── vce_sessions.json              # VCE chat history
├── positions.json                 # Knowledge Ontology node positions
└── syntx-python/
    ├── action_library.py
    ├── capability_checker.py
    └── skills/
        ├── skill_schema.py
        ├── skill_loader.py
        ├── skill_executor.py
        ├── skill_parser.py
        ├── skill_validator.py
        ├── skill_manager.py
        ├── skill_tester.py
        ├── skill_fallback.py
        ├── workflow_schema.py
        ├── workflow_loader.py
        ├── workflow_executor.py
        ├── workflow_parser.py
        └── workflow_manager.py
```

---

## The Four Sections

### 1. Knowledge Ontology

The visual memory system. Think of it as a tree of everything your AI knows beyond its pretrained data.

**What it stores:**
- Your personal details, opinions, ideas
- Project information, theories, research
- Anything not available on the internet

**Structure:**
- **Folders** (blue nodes) = topics like `science`, `personal`, `projects`
- **Leaf nodes** (green nodes) = sub-topics like `quantum`, `doptune`, `my_startup`
- Each leaf node is a **SQLite database** containing facts + a summary

**Toolbar tools:**
| Tool | Shortcut | Description |
|------|----------|-------------|
| Pan | `G` | Drag nodes around |
| Select | `V` | Select and inspect nodes |
| Box Select | `B` | Select multiple nodes |
| Rename | `R` | Rename a node |
| Delete | `Shift + Del` | Delete selected node |

**Right-click menu on nodes:**
- **Share Node Data** — copies the node's JSON to clipboard
- **Reveal in Explorer** — opens the folder in file manager
- **Usage** — shows how many times this node was accessed + last used date
- **Delete node** — permanently deletes the node and its database

---

### 2. Instruction Console

The command center. Everything starts here — training, skill creation, workflow creation.

**Layout:**
- Top bar shows current session objective and training status
- Message area shows conversation history
- Bottom feed is where you type commands and instructions
- Session list on the left shows all training sessions

**Key concepts:**
- A **session** is a training conversation
- A **folder** is a knowledge topic (e.g. `science`, `personal`)
- A **sub-session** is a specific subject within a folder (e.g. `quantum`, `doptune`)
- Each sub-session gets a **retrieval code** (e.g. `SC-001`) for recall

**Full command reference** — see [Instruction Console — Full Command Reference](#instruction-console--full-command-reference)

---

### 3. Validation Chat Environment (VCE)

A clean chat interface to talk with your trained AI. No industrial UI — just a conversation.

**What makes it different from regular chatbots:**
- Uses your **trained knowledge** from the Knowledge Ontology
- Can **run skills** directly from chat
- Can **run workflows** directly from chat
- Knowledge is injected automatically — no manual context needed

**How to trigger skills from VCE:**
```
give me facts about black holes using the quick_facts skill
tell me about Doptune using the skill about_doptune
run the code_writer skill
```

**How to trigger workflows from VCE:**
```
research neural networks using the quick_research workflow
run the morning_routine workflow
```

**If inputs are missing**, VCE will ask you inline — no popups, no redirects.

---

### 4. Skill Constellation

The visual skill manager. Shows all your skills in a spreadsheet-style grid with a node graph visualization.

**Grid columns:**
| Column | Description |
|--------|-------------|
| src | Skill index number |
| skill name | Name of the skill |
| memory | File size on disk |
| source | JSON filename |
| used ontology | Knowledge paths connected |
| last executed | Date and time of last run |
| description | What the skill does |
| used workflows | Which workflows use this skill |

**Clicking a skill** shows its step diagram:
- **Orange pentagon** = the skill (center)
- **Purple pentagons** = system steps
- **Green pentagons** = AI steps
- **Orange pentagons** = condition steps
- **Blue circles** = knowledge ontology connections

**Sort by** dropdown: src, last executed, memory

**New button** — starts `/skill create` in the Instruction Console

**Right-click on a skill:**
- Run skill
- Test in sandbox
- View JSON
- Delete skill

---

## Workflow Orchestrator

Visual workflow manager. Shows all workflows as cards with a draggable node editor.

**Grid view** — all workflows as cards showing name and step count

**Detail view** — click a workflow card to see:
- Draggable nodes for each step
- Lines connecting steps
- Color-coded by step type:
  - 🟠 Orange = skill step
  - 🟡 Yellow = condition step
  - 🟢 Green = AI step
  - 🔵 Blue = wait step
- **Green lines** = condition true branch
- **Red lines** = condition false branch

**Run button** — runs the workflow, asks for inputs if needed

**Right-click on workflow card:**
- Run
- View JSON
- Delete

---

## Instruction Console — Full Command Reference

### Training Commands

#### Start a training session
```
/train --text -folder_name
```
Example:
```
/train --text -science
/train --text -personal
/train --text -projects
```
- `folder_name` becomes a top-level folder in Knowledge Ontology
- Creates `~/.syntx-labs/base/folder_name/`

#### Start a sub-session
```
/sub sub_name
```
Example:
```
/sub quantum_physics
/sub doptune
/sub my_startup_idea
```
- Must be inside an active training session
- Creates a SQLite database for this sub-topic
- You receive a **retrieval code** (e.g. `SC-001`)

#### Train the AI
After starting a sub-session, just type naturally:
```
Quantum entanglement is when two particles are connected regardless of distance
The speed of light is approximately 299,792,458 meters per second
Doptune is a tech startup founded by Aravind in Kerala, India
```
- Facts are automatically detected and stored
- The AI responds as a curious student asking follow-up questions
- Use the **insert button** (⬆) on any message to manually add it as a fact

#### End a sub-session
```
/endsub
```
- Generates an AI summary of everything learned
- Saves summary to the SQLite database
- Shows retrieval code for future recall

#### Recall a past sub-session
```
/recall RETRIEVAL_CODE
```
Example:
```
/recall SC-001
/recall QU-145
```
- Loads past facts and summary into the current conversation context
- AI acknowledges and continues with that knowledge

#### End training session
```
/quit
```
- Must `/endsub` first if a sub-session is active
- Resets session state

---

### Skill Commands

#### Create a skill
```
/skill create
```
Starts an interactive creation flow:
1. **Name** — e.g. `quick_facts`
2. **Description** — what the skill does
3. **Steps** — numbered list of actions (see Step Writing Guide below)
4. **Knowledge** — optional path to knowledge ontology (e.g. `personal/doptune` or `no`)

#### List all skills
```
/skill list
```

#### View a skill's JSON
```
/skill view skill_name
```
Example:
```
/skill view quick_facts
```

#### Run a skill
```
/skill run skill_name
/skill run skill_name {"input_name": "value"}
```
Examples:
```
/skill run quick_facts {"topic": "Black_holes"}
/skill run code_writer {"task": "fibonacci"}
/skill run wiki_lookup {"topic": "Neural_network"}
/skill run research_and_code {"topic": "Quantum_physics"}
```

#### Test a skill in sandbox
```
/skill test skill_name
```
- Runs in a safe sandboxed environment
- Never touches real files or apps
- Shows pass/fail report

#### Edit a skill
```
/skill edit skill_name
```
- Re-enters the creation flow with existing data pre-filled

#### Delete a skill
```
/skill delete skill_name
```
- Shows confirmation modal
- Cannot delete built-in skills

---

### Workflow Commands

#### Create a workflow
```
/workflow create
```
Starts an interactive creation flow:
1. **Name** — e.g. `morning_routine`
2. **Description** — what the workflow does
3. **Steps** — numbered list (see Workflow Step Writing Guide below)

#### List all workflows
```
/workflow list
```

#### View a workflow's JSON
```
/workflow view workflow_name
```

#### Run a workflow
```
/workflow run workflow_name
/workflow run workflow_name {"input_name": "value"}
```
Examples:
```
/workflow run quick_research {"topic": "Neural_network"}
/workflow run morning_routine {"topic": "AI_news"}
```

#### Delete a workflow
```
/workflow delete workflow_name
```

---

## Skill System — Full Reference

### Step Writing Guide

When creating a skill, describe steps as a numbered list. Here are all supported step types:

#### Browser Actions
```
1. Open browser https://example.com
2. Open browser https://en.wikipedia.org/wiki/{{topic}}
3. Get page content
4. Find element #search-input
5. Click button submit
6. Type in browser "hello world"
7. Browser screenshot
```

#### File System Actions
```
1. Create folder /home/user/projects/{{name}}
2. Write file /home/user/notes/{{topic}}.txt
3. Read file /home/user/notes/{{topic}}.txt
4. Delete file /home/user/temp/old.txt
5. Move file /home/user/a.txt /home/user/b.txt
6. List files /home/user/projects
```

#### Process / Terminal Actions
```
1. Run command echo "hello world"
2. Run command python3 /home/user/script.py
3. Run command df -h
4. Install package requests
5. Kill process chrome
6. Check process firefox
7. Open terminal
```

#### App Control Actions
```
1. Open app spotify
2. Open app firefox
3. Close app chrome
4. Type text "hello world"
5. Press key enter
6. Press key ctrl+s
7. Click position 100 200
8. Scroll down 3
9. Copy hello world
10. Paste
```

#### AI Reasoning Actions
Any step containing: `analyze`, `summarize`, `determine`, `evaluate`, `check`, `decide`, `think`, `reason`
```
3. Analyze the content and summarize the key points about {{topic}}
4. Determine the best approach based on the previous results
5. Evaluate and write a complete Python script for {{task}}
```

#### Knowledge Read Actions
```
1. Read knowledge personal/doptune
1. Read knowledge science/quantum
1. Read knowledge projects/syntx_labs
```

#### VLA / Vision Actions (requires moondream)
```
1. Take screenshot
2. Ask vision model describe everything visible on screen
```

### Dynamic Inputs with `{{variable}}`

Use `{{variable_name}}` in any step to make it dynamic:
```
1. Open browser https://en.wikipedia.org/wiki/{{topic}}
2. Get page content
3. Analyze and summarize key facts about {{topic}}
4. Write file /home/user/research/{{topic}}/summary.txt
```

Run with:
```
/skill run wiki_lookup {"topic": "Black_holes"}
```

### Step Color Legend (in Skill Graph)
| Color | Type |
|-------|------|
| 🟣 Purple pentagon | System action step |
| 🟢 Green pentagon | AI reasoning step |
| 🟠 Orange pentagon | Condition step |
| 🔵 Blue circle | Knowledge ontology connection |
| 🟠 Orange pentagon (center) | The skill itself |

### Example Skills

#### `quick_facts` — Get 10 facts about any topic
```
Steps:
1. Open browser https://en.wikipedia.org/wiki/{{topic}}
2. Get page content
3. Analyze the content and give exactly 10 clear interesting facts about {{topic}} as a numbered list
```
Run: `/skill run quick_facts {"topic": "Black_holes"}`

#### `code_writer` — Write a Python script
```
Steps:
1. Analyze and write a complete working python script for {{task}}
2. Write file /home/user/scripts/{{task}}.py
```
Run: `/skill run code_writer {"task": "fibonacci"}`

#### `wiki_lookup` — Research and save
```
Steps:
1. Open browser https://en.wikipedia.org/wiki/{{topic}}
2. Get page content
3. Analyze and summarize the key facts about {{topic}} in simple points
4. Write file /home/user/wiki/{{topic}}.txt
```
Run: `/skill run wiki_lookup {"topic": "Quantum_physics"}`

#### `research_and_code` — Full research pipeline
```
Steps:
1. Create folder /home/user/research/{{topic}}
2. Open browser https://en.wikipedia.org/wiki/{{topic}}
3. Get page content
4. Analyze the content and write a detailed research summary about {{topic}} with key concepts and facts
5. Write file /home/user/research/{{topic}}/summary.txt
6. Analyze the research summary and write a complete working Python script that demonstrates or simulates a concept from {{topic}}
7. Write file /home/user/research/{{topic}}/demo.py
8. List files /home/user/research/{{topic}}
```
Run: `/skill run research_and_code {"topic": "Neural_network"}`

#### `about_doptune` — Knowledge-based answer
```
Steps:
1. Read knowledge personal/doptune
2. Analyze the knowledge and tell me everything about {{topic}}
```
Run: `/skill run about_doptune {"topic": "Doptune"}`

#### `see_screen` — VLA screenshot description
```
Steps:
1. Take screenshot
2. Ask vision model describe everything visible in this screenshot in detail including all text apps and UI elements
3. Write file /home/user/screen_description.txt
```
Run: `/skill run see_screen`

---

## Workflow System — Full Reference

### Workflow Step Writing Guide

#### Skill step
```
1. run quick_facts with topic={{topic}}
2. run code_writer with task={{topic}}_script
3. run wiki_lookup with topic={{topic}}
```

#### Condition step
```
3. if step_1_success go to 4 else go to 5
```

#### Wait step
```
2. wait 5 seconds
```

#### AI step
Any step with: `analyze`, `summarize`, `determine`, `evaluate`
```
3. analyze the results and determine the best next action
```

### Condition Variables
After each skill step, these variables are available:
- `step_1_success` — True if step 1 succeeded
- `step_2_success` — True if step 2 succeeded
- `step_N_result` — The output of step N

### Example Workflows

#### `quick_research` — Research and code
```
Steps:
1. run quick_facts with topic={{topic}}
2. run code_writer with task={{topic}}
```
Run: `/workflow run quick_research {"topic": "Neural_network"}`

#### `conditional_research` — Research with fallback
```
Steps:
1. run quick_facts with topic={{topic}}
2. if step_1_success go to 3 else go to 4
3. run code_writer with task={{topic}}
4. wait 2 seconds
```
Run: `/workflow run conditional_research {"topic": "Quantum_physics"}`

#### `morning_routine` — Full morning automation
```
Steps:
1. run quick_facts with topic={{news_topic}}
2. run code_writer with task=daily_planner
3. if step_1_success go to 4 else go to 5
4. run research_and_code with topic={{news_topic}}
5. wait 3 seconds
```
Run: `/workflow run morning_routine {"news_topic": "AI"}`

---

## VCE — Full Reference

### Regular Chat
Just type normally — the VCE uses your trained knowledge automatically:
```
Who am I?
What is Doptune?
Tell me about quantum entanglement
Explain neural networks
```

### Running Skills from VCE
```
give me facts about {{topic}} using the quick_facts skill
tell me about {{topic}} using the skill wiki_lookup
write me a {{task}} script using the code_writer skill
run the see_screen skill
```

### Running Workflows from VCE
```
research {{topic}} using the quick_research workflow
run the morning_routine workflow
use the conditional_research workflow
```

### Input Prompting
If a skill or workflow needs inputs that weren't provided, VCE will ask you inline:
```
> What is the value for "topic"?
> [type here and press Enter]
```

### Session Management
- **New Environment** — starts a fresh chat
- **Search** — search through past conversations
- **Right-click on session** — rename, star, delete

---

## Supported Models

### Text / Reasoning Models (via Ollama)
| Model | Size | Speed | Quality | Recommended |
|-------|------|-------|---------|-------------|
| `gemma2:2b` | 1.5GB | Fast | Good | ✅ Default |
| `gemma2:9b` | 5.5GB | Medium | Better | For 32GB+ RAM |
| `llama3:8b` | 4.7GB | Medium | Great | For 16GB+ RAM |
| `mistral:7b` | 4.1GB | Medium | Great | Good alternative |
| `qwen2.5:3b` | 1.9GB | Fast | Good | Alternative to gemma2:2b |

### Vision / VLA Models (via Ollama)
| Model | Size | Use Case | Recommended |
|-------|------|----------|-------------|
| `moondream` | 1.7GB | Screenshots, UI description | ✅ Default |
| `llava:7b` | 4.5GB | Better vision quality | For 16GB+ VRAM |
| `llava:13b` | 8GB | Best vision quality | For 24GB+ VRAM |

### Changing the Model
In `main.js`, change all occurrences of `model: 'gemma2:2b'` to your preferred model.
In `main.rs`, change `"model": "gemma2:2b"` in the `ollama_bridge` function.

---

## Python Backend — File Reference

| File | Location | Purpose |
|------|----------|---------|
| `action_library.py` | `syntx-python/` | All atomic computer actions (file, browser, GUI, VLA) |
| `capability_checker.py` | `syntx-python/` | Detects what the system supports (VLA, browser, etc.) |
| `skill_schema.py` | `syntx-python/skills/` | Locked skill JSON schema + step builders |
| `skill_loader.py` | `syntx-python/skills/` | Loads and caches skills from disk |
| `skill_executor.py` | `syntx-python/skills/` | Runs skill steps in sequence |
| `skill_parser.py` | `syntx-python/skills/` | Converts natural language to skill JSON |
| `skill_validator.py` | `syntx-python/skills/` | Validates skill JSON before saving |
| `skill_manager.py` | `syntx-python/skills/` | Saves and deletes skills |
| `skill_tester.py` | `syntx-python/skills/` | Runs skills in a safe sandbox |
| `skill_fallback.py` | `syntx-python/skills/` | Handles capability mismatches gracefully |
| `workflow_schema.py` | `syntx-python/skills/` | Locked workflow JSON schema + step builders |
| `workflow_loader.py` | `syntx-python/skills/` | Loads and caches workflows from disk |
| `workflow_executor.py` | `syntx-python/skills/` | Runs workflow steps with condition branching |
| `workflow_parser.py` | `syntx-python/skills/` | Converts natural language to workflow JSON |
| `workflow_manager.py` | `syntx-python/skills/` | Saves and deletes workflows |

### Action Library — All Available Actions

#### Level 1 — File System
| Action | Parameters | Description |
|--------|-----------|-------------|
| `read_file` | `path` | Read file contents |
| `write_file` | `path, content` | Write content to file |
| `create_folder` | `path` | Create directory |
| `delete_file` | `path` | Delete a file |
| `move_file` | `src, dest` | Move a file |
| `list_files` | `path` | List files in directory |

#### Level 2 — Process Control
| Action | Parameters | Description |
|--------|-----------|-------------|
| `run_command` | `command` | Execute shell command |
| `open_terminal` | — | Open terminal emulator |
| `install_package` | `name, manager` | Install pip/npm package |
| `kill_process` | `name` | Kill a process by name |
| `check_process_running` | `name` | Check if process is running |

#### Level 3 — Application Control
| Action | Parameters | Description |
|--------|-----------|-------------|
| `open_app` | `app_name` | Launch an application |
| `close_app` | `app_name` | Close an application |
| `type_text` | `text` | Type text at cursor |
| `press_key` | `key` | Press a key (e.g. `enter`, `ctrl+s`) |
| `click_position` | `x, y` | Click at screen coordinates |
| `scroll` | `direction, amount` | Scroll up or down |
| `copy_to_clipboard` | `text` | Copy text to clipboard |
| `paste_from_clipboard` | — | Get clipboard contents |

#### Level 4 — Screen & Browser
| Action | Parameters | Description |
|--------|-----------|-------------|
| `browser_open` | `url` | Open URL in Chromium |
| `browser_find_element` | `selector` | Find element by CSS/text |
| `browser_click` | `selector` | Click element |
| `browser_type` | `selector, text` | Type into input |
| `browser_get_content` | — | Get page text content |
| `browser_screenshot` | — | Screenshot current page |
| `get_accessibility_tree` | — | Get UI accessibility tree |
| `find_element_by_name` | `name` | Find UI element by name |
| `find_element_by_role` | `role` | Find UI elements by role |
| `take_screenshot` | — | Screenshot full desktop |
| `pass_to_vision_model` | `path, prompt` | Send screenshot to VLA model |

---

## Cross-Platform Notes

### Linux (Primary Platform)
- All features fully supported
- Requires `scrot` for screenshots: `sudo apt install scrot`
- Requires `gnome-screenshot` as fallback: `sudo apt install gnome-screenshot`
- Accessibility API requires: `sudo apt install python3-gi gir1.2-atspi-2.0`

### macOS
- Screenshots use `screencapture` (built-in, no install needed)
- File reveal uses `open` command (built-in)
- Terminal opens `Terminal.app`
- Accessibility API uses `pyobjc`: `pip install pyobjc`
- Browser automation works as-is

### Windows
- Screenshots use PowerShell (built-in)
- File reveal uses `explorer` (built-in)
- Terminal opens `cmd.exe`
- Accessibility API uses `pywinauto`: `pip install pywinauto`
- Browser automation works as-is

---

## Contributing

Syntx Labs is open source under the MIT license. Contributions welcome!

### Areas where help is most needed
- **New built-in skills** — add to `~/.syntx-labs/skills/built_in/`
- **Better NLP parsing** — `skill_parser.py` and `workflow_parser.py`
- **More action library actions** — `action_library.py`
- **Windows/macOS testing** — cross-platform bug fixes
- **Model integrations** — support for more Ollama models
- **UI improvements** — better skill/workflow visualization

### How to contribute
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test on your platform
5. Submit a pull request

### Reporting bugs
Open a GitHub issue with:
- Your OS and version
- Your RAM and GPU specs
- The exact command or action that failed
- The error message if any

---

## License

MIT License — Copyright (c) 2026 Doptune

Permission is hereby granted, free of charge, to any person obtaining a copy of this software to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.

---

## About Doptune

**Doptune** is a tech startup building good products for real people.
We believe software should work for the user — not the other way around.

A Doptune Product

---
