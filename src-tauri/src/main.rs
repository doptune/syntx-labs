#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use serde::Serialize;

#[derive(Serialize)]
struct Node {
    name: String,
    children: Vec<Node>,
}

fn read_dir_recursive(path: PathBuf) -> Node {
    let name = path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let mut children = Vec::new();

    if path.is_dir() {
        if let Ok(entries) = fs::read_dir(&path) {
            let mut entries: Vec<_> = entries
                .filter_map(|e| e.ok())
                .collect();
            entries.sort_by_key(|e| e.file_name());
            for entry in entries {
                children.push(read_dir_recursive(entry.path()));
            }
        }
    }

    Node { name, children }
}

#[tauri::command]
fn save_positions(positions: std::collections::HashMap<String, (f64, f64)>) {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("positions.json");
    let json = serde_json::to_string(&positions).unwrap();
    fs::write(path, json).unwrap();
}

#[tauri::command]
fn load_positions() -> std::collections::HashMap<String, (f64, f64)> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("positions.json");
    if path.exists() {
        let json = fs::read_to_string(path).unwrap_or_default();
        serde_json::from_str(&json).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    }
}

#[tauri::command]
fn rename_node(old_path: String, new_name: String) -> Result<(), String> {
    let path = std::path::Path::new(&old_path);
    let parent = path.parent().ok_or("No parent directory")?;
    let new_path = parent.join(&new_name);
    fs::rename(path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_tree() -> Node {
    let base_path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base");

    read_dir_recursive(base_path)
}


#[tauri::command]
fn get_base_path() -> String {
    dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn delete_node(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_base_size() -> u64 {
    let base_path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base");

    fn dir_size(path: &std::path::Path) -> u64 {
        let mut size = 0;
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_dir() {
                    size += dir_size(&p);
                } else {
                    size += p.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        size
    }

    dir_size(&base_path)
}


#[tauri::command]
fn save_sessions(sessions: String) -> Result<(), String> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("sessions.json");
    fs::write(path, sessions).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_sessions() -> String {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("sessions.json");
    if path.exists() {
        fs::read_to_string(path).unwrap_or_default()
    } else {
        String::from("[]")
    }
}

#[tauri::command]
fn create_session_folder(folder_name: String) -> Result<(), String> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base")
        .join(&folder_name);
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_subsession(folder_name: String, sub_name: String) -> Result<String, String> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base")
        .join(&folder_name)
        .join(format!("{}.db", sub_name));

    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| e.to_string())?;

    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS summary (
            id INTEGER PRIMARY KEY,
            content TEXT,
            created_at TEXT
        );
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    ").map_err(|e| e.to_string())?;

    // store sub-session name
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
        rusqlite::params!["name", sub_name]
    ).map_err(|e| e.to_string())?;

    // generate retrieval code e.g. MS-001
    let code = format!("{}-{:03}", 
        &folder_name[..2].to_uppercase(),
        chrono::Utc::now().timestamp() % 1000
    );
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
        rusqlite::params!["retrieval_code", code.clone()]
    ).map_err(|e| e.to_string())?;

    Ok(code)
}

#[tauri::command]
fn delete_all_knowledge() -> Result<(), String> {
    let base_path = dirs::home_dir()
        .expect("no home")
        .join(".syntx-labs")
        .join("base");
    if base_path.exists() {
        for entry in fs::read_dir(&base_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_all_skills() -> Result<(), String> {
    let path = dirs::home_dir()
        .expect("no home")
        .join(".syntx-labs")
        .join("skills")
        .join("user_defined");
    if path.exists() {
        for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_all_workflows() -> Result<(), String> {
    let path = dirs::home_dir()
        .expect("no home")
        .join(".syntx-labs")
        .join("workflows")
        .join("user_defined");
    if path.exists() {
        for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn export_all_as_zip() -> Result<(), String> {
    use std::io::Write;

    let home = dirs::home_dir().expect("no home");
    let syntx_path = home.join(".syntx-labs");

    // Downloads folder — works on Linux, Mac, Windows
    let downloads = home.join("Downloads");
    if !downloads.exists() {
        fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let zip_path = downloads.join(format!("syntx-export-{}.zip", timestamp));
    let file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Folders to include
    let dirs_to_export = ["base", "skills", "workflows"];

    for dir_name in &dirs_to_export {
        let dir_path = syntx_path.join(dir_name);
        if !dir_path.exists() { continue; }
        add_dir_to_zip(&mut zip, &dir_path, dir_name, &options)?;
    }

    // Also include sessions JSON files
    for file_name in &["sessions.json", "vce_sessions.json"] {
        let file_path = syntx_path.join(file_name);
        if file_path.exists() {
            zip.start_file(*file_name, options).map_err(|e| e.to_string())?;
            let content = fs::read(&file_path).map_err(|e| e.to_string())?;
            zip.write_all(&content).map_err(|e| e.to_string())?;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    dir: &std::path::Path,
    base: &str,
    options: &zip::write::FileOptions,
) -> Result<(), String> {
    use std::io::Write;
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = format!("{}/{}", base, entry.file_name().to_string_lossy());
        if path.is_dir() {
            add_dir_to_zip(zip, &path, &name, options)?;
        } else {
            zip.start_file(&name, *options).map_err(|e| e.to_string())?;
            let content = fs::read(&path).map_err(|e| e.to_string())?;
            zip.write_all(&content).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn insert_fact(folder_name: String, sub_name: String, fact: String) -> Result<(), String> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base")
        .join(&folder_name)
        .join(format!("{}.db", sub_name));

    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO facts (content, created_at) VALUES (?1, ?2)",
        rusqlite::params![fact, chrono::Utc::now().to_rfc3339()]
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_facts(folder_name: String, sub_name: String) -> Result<String, String> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base")
        .join(&folder_name)
        .join(format!("{}.db", sub_name));

    if !path.exists() {
        return Ok("[]".to_string());
    }

    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT content FROM facts ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;

    let facts: Vec<String> = stmt.query_map([], |row| {
        row.get(0)
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    serde_json::to_string(&facts).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_summary(folder_name: String, sub_name: String, summary: String) -> Result<(), String> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base")
        .join(&folder_name)
        .join(format!("{}.db", sub_name));

    let conn = rusqlite::Connection::open(&path)
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO summary (id, content, created_at) VALUES (1, ?1, ?2)",
        rusqlite::params![summary, chrono::Utc::now().to_rfc3339()]
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn recall_subsession(retrieval_code: String) -> Result<String, String> {
    let base_path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base");

    // search all folders for the db with this retrieval code
    if let Ok(folders) = fs::read_dir(&base_path) {
        for folder in folders.filter_map(|e| e.ok()) {
            let folder_path = folder.path();
            if folder_path.is_dir() {
                if let Ok(files) = fs::read_dir(&folder_path) {
                    for file in files.filter_map(|e| e.ok()) {
                        let file_path = file.path();
                        if file_path.extension().and_then(|e| e.to_str()) == Some("db") {
                            // open and check retrieval code
                            if let Ok(conn) = rusqlite::Connection::open(&file_path) {
                                let code: Result<String, _> = conn.query_row(
                                    "SELECT value FROM meta WHERE key = 'retrieval_code'",
                                    [],
                                    |row| row.get(0)
                                );
                                if let Ok(c) = code {
                                    if c.to_uppercase() == retrieval_code.to_uppercase() {
                                        // found it! get name, facts and summary
                                        let name: String = conn.query_row(
                                            "SELECT value FROM meta WHERE key = 'name'",
                                            [],
                                            |row| row.get(0)
                                        ).unwrap_or_default();

                                        let mut stmt = conn.prepare(
                                            "SELECT content FROM facts ORDER BY created_at ASC"
                                        ).map_err(|e| e.to_string())?;

                                        let facts: Vec<String> = stmt.query_map([], |row| {
                                            row.get(0)
                                        })
                                        .map_err(|e| e.to_string())?
                                        .filter_map(|r| r.ok())
                                        .collect();

                                        let summary: String = conn.query_row(
                                            "SELECT content FROM summary WHERE id = 1",
                                            [],
                                            |row| row.get(0)
                                        ).unwrap_or_default();

                                        let folder_name = folder.file_name()
                                            .to_string_lossy()
                                            .to_string();

                                        let result = serde_json::json!({
                                            "name": name,
                                            "folder": folder_name,
                                            "retrieval_code": c,
                                            "facts": facts,
                                            "summary": summary
                                        });

                                        return Ok(result.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err(format!("No sub-session found with retrieval code: {}", retrieval_code))
}

#[tauri::command]
fn save_model_preference(text_model: String, vision_model: String) -> Result<(), String> {
    let path = dirs::home_dir()
        .unwrap()
        .join(".syntx-labs")
        .join("model_preference.json");
    let json = serde_json::json!({
        "text_model": text_model,
        "vision_model": vision_model
    });
    fs::write(path, json.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_knowledge() -> Result<String, String> {
    let base_path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base");

    let mut all_knowledge = Vec::new();

    if let Ok(folders) = fs::read_dir(&base_path) {
        for folder in folders.filter_map(|e| e.ok()) {
            let folder_path = folder.path();
            if folder_path.is_dir() {
                let folder_name = folder.file_name()
                    .to_string_lossy()
                    .to_string();

                if let Ok(files) = fs::read_dir(&folder_path) {
                    for file in files.filter_map(|e| e.ok()) {
                        let file_path = file.path();
                        if file_path.extension()
                            .and_then(|e| e.to_str()) == Some("db") {

                            if let Ok(conn) = rusqlite::Connection::open(&file_path) {
                                // get name
                                let name: String = conn.query_row(
                                    "SELECT value FROM meta WHERE key = 'name'",
                                    [],
                                    |row| row.get(0)
                                ).unwrap_or_default();

                                // get facts
                                let facts: Vec<String> = conn.prepare(
                                    "SELECT content FROM facts ORDER BY created_at ASC"
                                )
                                .and_then(|mut stmt| {
                                    stmt.query_map([], |row| row.get(0))
                                        .map(|rows| rows.filter_map(|r| r.ok()).collect())
                                })
                                .unwrap_or_default();

                                // get summary
                                let summary: String = conn.query_row(
                                    "SELECT content FROM summary WHERE id = 1",
                                    [],
                                    |row| row.get(0)
                                ).unwrap_or_default();

                                // get retrieval code
                                let retrieval_code: String = conn.query_row(
                                    "SELECT value FROM meta WHERE key = 'retrieval_code'",
                                    [],
                                    |row| row.get(0)
                                ).unwrap_or_default();

                                all_knowledge.push(serde_json::json!({
                                    "folder": folder_name,
                                    "name": name,
                                    "retrieval_code": retrieval_code,
                                    "summary": summary,
                                    "facts": facts
                                }));
                            }
                        }
                    }
                }
            }
        }
    }

    serde_json::to_string(&all_knowledge).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_vce_sessions(sessions: String) -> Result<(), String> {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("vce_sessions.json");
    fs::write(path, sessions).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_vce_sessions() -> String {
    let path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("vce_sessions.json");
    if path.exists() {
        fs::read_to_string(path).unwrap_or_default()
    } else {
        String::from("[]")
    }
}

// ============================================================
// SKILLS
// ============================================================

fn get_skills_path() -> PathBuf {
    dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("skills")
}

#[tauri::command]
fn run_python_skill(function: String, args: String) -> Result<String, String> {
    use std::process::Command;

    let home = dirs::home_dir().unwrap();
    let skills_path = home.join(".syntx-labs").join("syntx-python").join("skills");
    let syntx_python_path = home.join(".syntx-labs").join("syntx-python");

    let script = format!(
        r#"
import sys, json, os
sys.path.insert(0, '{skills_path}')
sys.path.insert(0, '{syntx_python_path}')

# At the top of run_python_skill Python script, add:
import json as _mpjson, os as _mpos
_mp_path = _mpos.path.expanduser('~/.syntx-labs/model_preference.json')
if _mpos.path.exists(_mp_path):
    _mp = _mpjson.load(open(_mp_path))
    _TEXT_MODEL = _mp.get('text_model', 'gemma2:2b')
else:
    _TEXT_MODEL = 'gemma2:2b'

args_file = os.environ.get('SYNTX_ARGS_FILE')
with open(args_file, 'r') as f:
    args = json.load(f)
fn   = os.environ['SYNTX_FN']

if fn == 'parse_skill_from_conversation':
    from skill_parser import parse_skill_from_conversation
    history    = json.loads(args['conversation_history'])
    steps_text = args.get('steps_text', '')
    skill_name = args.get('skill_name', '')
    description = args.get('description', '')
    ka = args.get('knowledge_access', '[]')
    knowledge_access = json.loads(ka) if isinstance(ka, str) else ka
    result = parse_skill_from_conversation(
        history,
        steps_text=steps_text,
        skill_name=skill_name,
        description=description,
        knowledge_access=knowledge_access
    )
    print(json.dumps(result))

elif fn == 'run_full_validation':
    from skill_validator import run_full_validation
    result = run_full_validation(json.loads(args['skill_json']))
    print(json.dumps(result))

elif fn == 'test_skill':
    from skill_tester import test_skill
    result = test_skill(json.loads(args['skill_json']))
    print(json.dumps(result))

elif fn == 'save_skill':
    from skill_manager import save_skill
    result = save_skill(json.loads(args['skill_json']))
    print(json.dumps(result))

elif fn == 'load_skill':
    from skill_loader import load_skill
    result = load_skill(args['skill_name'])
    print(json.dumps(result))

elif fn == 'get_skill_list':
    from skill_loader import get_skill_list
    result = get_skill_list()
    print(json.dumps(result))

elif fn == 'skill_exists':
    from skill_loader import skill_exists
    result = skill_exists(args['skill_name'])
    print(json.dumps(result))

elif fn == 'delete_skill':
    from skill_manager import delete_skill
    result = delete_skill(args['skill_name'])
    print(json.dumps(result))

elif fn == 'execute_skill':
    from skill_executor import execute_skill
    import urllib.request, json as _json
    skill  = json.loads(args['skill_json'])
    inputs = json.loads(args['user_inputs'])
    def ollama_bridge(prompt: str) -> str:
        payload = _json.dumps({{"model": _TEXT_MODEL, "prompt": prompt, "stream": False}}).encode()
        req = urllib.request.Request("http://localhost:11434/api/generate", data=payload, headers={{"Content-Type": "application/json"}})
        with urllib.request.urlopen(req, timeout=300) as resp:
            return _json.loads(resp.read())["response"].strip()
    result = execute_skill(skill, inputs, model_bridge=ollama_bridge)
    # Save last executed timestamp
    import json as _json2
    from pathlib import Path
    skill_path = Path.home() / '.syntx-labs' / 'skills' / 'user_defined' / f"{{skill['skill_name']}}.json"
    if skill_path.exists():
        with open(skill_path, 'r') as f:
            sk = _json2.load(f)
        sk['last_executed'] = __import__('datetime').datetime.utcnow().isoformat()
        with open(skill_path, 'w') as f:
            _json2.dump(sk, f, indent=2)
    # Strip large base64 images from context before returning
    clean_context = {{}}
    for k, v in result.get("context", {{}}).items():
        if isinstance(v, dict) and "image_base64" in v:
            clean_context[k] = {{**v, "image_base64": "[stripped]"}}
        elif isinstance(v, str) and len(v) > 50000:
            clean_context[k] = v[:500] + "...[truncated]"
        else:
            clean_context[k] = v
    result["context"] = clean_context
    print(_json.dumps(result))
elif fn == 'parse_workflow_from_conversation':
    from workflow_parser import parse_workflow_from_conversation
    history    = json.loads(args['conversation_history'])
    steps_text = args.get('steps_text', '')
    workflow_name = args.get('workflow_name', '')
    description = args.get('description', '')
    result = parse_workflow_from_conversation(
        history,
        steps_text=steps_text,
        workflow_name=workflow_name,
        description=description
    )
    print(json.dumps(result))

elif fn == 'save_workflow':
    from workflow_manager import save_workflow
    result = save_workflow(json.loads(args['workflow_json']))
    print(json.dumps(result))

elif fn == 'load_workflow':
    from workflow_loader import load_workflow
    result = load_workflow(args['workflow_name'])
    print(json.dumps(result))

elif fn == 'get_workflow_list':
    from workflow_loader import get_workflow_list
    result = get_workflow_list()
    print(json.dumps(result))

elif fn == 'workflow_exists':
    from workflow_loader import workflow_exists
    result = workflow_exists(args['workflow_name'])
    print(json.dumps(result))

elif fn == 'delete_workflow':
    from workflow_manager import delete_workflow
    result = delete_workflow(args['workflow_name'])
    print(json.dumps(result))

elif fn == 'execute_workflow':
    from workflow_executor import execute_workflow
    import urllib.request, json as _json
    workflow = json.loads(args['workflow_json'])
    inputs   = json.loads(args['user_inputs'])
    def ollama_bridge(prompt: str) -> str:
        payload = _json.dumps({{"model": _TEXT_MODEL, "prompt": prompt, "stream": False}}).encode()
        req = urllib.request.Request("http://localhost:11434/api/generate", data=payload, headers={{"Content-Type": "application/json"}})
        with urllib.request.urlopen(req, timeout=300) as resp:
            return _json.loads(resp.read())["response"].strip()
    result = execute_workflow(workflow, inputs, model_bridge=ollama_bridge)
    # Strip large data from context
    clean_context = {{}}
    for k, v in result.get("context", {{}}).items():
        if isinstance(v, str) and len(v) > 50000:
            clean_context[k] = v[:500] + "...[truncated]"
        else:
            clean_context[k] = v
    result["context"] = clean_context
    print(_json.dumps(result))
"#,
        skills_path = skills_path.display(),
        syntx_python_path = syntx_python_path.display(),
    );

    // Write args to temp file to avoid env var size limit
    let tmp_path = std::env::temp_dir().join(format!("syntx_args_{}_{}.json", &function, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos()));
    fs::write(&tmp_path, &args).map_err(|e| e.to_string())?;

    let output = Command::new("python3")
        .arg("-c")
        .arg(&script)
        .env("SYNTX_ARGS_FILE", tmp_path.to_str().unwrap())
        .env("SYNTX_FN", &function)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
} else {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!("STDERR: {} | STDOUT: {}", stderr, stdout))
}
}

// Add to your invoke_handler too:
// run_python_skill

fn main() {
    // existing base path creation...
    let base_path = dirs::home_dir()
        .expect("Could not find home directory")
        .join(".syntx-labs")
        .join("base");
    if !base_path.exists() {
        std::fs::create_dir_all(&base_path).expect("Could not create base folder");
    }

    // Skills root folder
    let skills_path = get_skills_path();
    if !skills_path.exists() {
        std::fs::create_dir_all(&skills_path).expect("Could not create skills folder");
    }

    // ADD THIS — built_in and user_defined subfolders
    let built_in_path = skills_path.join("built_in");
    if !built_in_path.exists() {
        std::fs::create_dir_all(&built_in_path).expect("Could not create built_in skills folder");
    }

    let user_defined_path = skills_path.join("user_defined");
    if !user_defined_path.exists() {
        std::fs::create_dir_all(&user_defined_path).expect("Could not create user_defined skills folder");
    }

    // Workflow folders
    let workflows_path = dirs::home_dir()
        .unwrap()
        .join(".syntx-labs")
        .join("workflows");
    if !workflows_path.exists() {
        std::fs::create_dir_all(&workflows_path).expect("Could not create workflows folder");
    }
    let workflows_user_path = workflows_path.join("user_defined");
    if !workflows_user_path.exists() {
        std::fs::create_dir_all(&workflows_user_path).expect("Could not create user_defined workflows folder");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // ...all your existing commands...
            get_tree, save_positions, load_positions, rename_node,
            get_base_path, delete_node, reveal_in_explorer, get_base_size,
            save_sessions, load_sessions, create_session_folder,
            create_subsession, insert_fact, get_facts, save_summary,
            recall_subsession, get_all_knowledge, save_vce_sessions, load_vce_sessions, run_python_skill, delete_all_knowledge, delete_all_skills, delete_all_workflows, export_all_as_zip, save_model_preference,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}