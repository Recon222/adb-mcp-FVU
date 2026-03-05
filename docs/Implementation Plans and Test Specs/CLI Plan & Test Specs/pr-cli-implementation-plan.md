# pr-cli Phased Implementation Plan

### For execution by a Claude Code Python agent

> **Companion document:** `pr-cli-test-spec.md` contains the full test specification. This plan references it throughout. Tests are written first (TDD) in every phase.

---

## Key Context for the Implementing Agent

You are building `pr-cli`, a Typer-based Python CLI that controls Adobe Premiere Pro through an existing socket.io proxy and UXP plugin. You are **not** modifying the proxy (`adb-proxy-socket/`) or the plugin (`uxp/`). You are replacing the MCP layer (`mcp/`) with a standalone CLI.

**The two source files you must read before starting:**
1. `CLI_Plan_v2` — the high-level architecture (in project knowledge)
2. `pr-cli-test-spec.md` — the test specification (companion to this document)

**Critical rules:**
- Every CLI command maps to an action string sent over the socket. The mapping table in Section 7 of `CLI_Plan_v2` is the ground truth. Any mismatch silently produces wrong behavior.
- Every command's JSON output must follow the contract: `{"status": "SUCCESS", "data": {...}}` or `{"status": "ERROR", "message": "..."}`. No exceptions. No variations.
- The `--json` flag is declared per-command (not globally) and always appears after the subcommand: `pr-cli <group> <command> --json`.
- TDD: write the test, watch it fail, write the code, watch it pass.

---

## Outstanding Issues Resolved in This Plan

These items were flagged in the v2 review and are resolved here with specific implementation guidance.

### Issue 1: Directory Structure Typo

The v2 plan's tree diagram shows `commands/` and `tests/` as siblings of `pr_cli/`. They must be **children** of `pr_cli/` (for `commands/`) and children of `pr-cli/` root (for `tests/`). The correct structure:

```
pr-cli/
├── pr_cli/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── output.py
│   ├── client.py
│   ├── transport/
│   │   ├── __init__.py
│   │   ├── socket_client.py
│   │   └── logger.py
│   └── commands/
│       ├── __init__.py
│       ├── project.py
│       ├── sequence.py
│       ├── media.py
│       ├── clips.py
│       ├── bin.py
│       ├── effects.py
│       ├── metadata.py
│       └── export.py
├── tests/
│   └── (as defined in test spec)
├── pyproject.toml
├── README.md
└── SKILL.md
```

### Issue 2: `sequence list` Data Shaping

`sequence list` reuses the `getProjectInfo` action string. The raw response includes `name`, `path`, `id`, `items`, and an embedded sequence array. The `sequence list` command must **extract only the sequence data** and pass that to `output.success()`. The agent calling `sequence list --json` should receive:

```json
{
  "status": "SUCCESS",
  "data": {
    "sequences": [
      {"name": "...", "id": "...", "isActive": true, ...}
    ]
  }
}
```

Implementation: In `commands/sequence.py`, the `list` function calls `client.send("getProjectInfo", {})`, then extracts `response["response"]["items"]` filtered to sequences (or a dedicated sequences field if the proxy returns one). Inspect the actual `getProjectInfo` response shape during Phase 2 integration testing and adjust.

### Issue 3: `--help` Text Quality

Every command's `--help` text must include:
- A one-line description (the function docstring's first line)
- An example invocation in the epilog or docstring

Use Typer's `help` parameter in `@app.command(help="...")` and `rich_help_panel` where appropriate. The SKILL.md smoke test (Tier 3) validates that all commands respond to `--help`, but a human review of help text quality should happen at the end of each phase.

### Issue 4: Exception Mapping from `socket_client.py`

This is the most subtle implementation detail. The existing `socket_client.py` raises `RuntimeError` for **both** "proxy unreachable" and "Premiere not connected" — the only differentiator is the error message string.

**Mapping rules for `client.py`:**

```python
from pr_cli.transport.socket_client import AppError

class ProxyNotAvailable(Exception):
    """Proxy server is not running or unreachable."""
    pass

class PremiereNotConnected(Exception):
    """Proxy is reachable but Premiere/plugin is not connected."""
    pass

class CommandFailed(Exception):
    """Premiere received the command but returned FAILURE."""
    pass

def send(action: str, options: dict, timeout: int | None = None) -> dict:
    command = {
        "application": APPLICATION,
        "action": action,
        "options": options,
    }
    try:
        response = socket_client.send_message_blocking(command, timeout=timeout)
    except AppError as e:
        raise CommandFailed(str(e)) from e
    except RuntimeError as e:
        msg = str(e).lower()
        if "proxy server" in msg:
            raise ProxyNotAvailable(str(e)) from e
        else:
            # "Connection Timed Out" / "MCP Plugin" → Premiere issue
            raise PremiereNotConnected(str(e)) from e
    except Exception as e:
        # Unexpected errors — don't swallow
        raise

    if response is None:
        raise ProxyNotAvailable(
            "No response received from proxy. Is the proxy running?"
        )

    return response
```

The string matching on `"proxy server"` comes directly from the two distinct `RuntimeError` messages in `socket_client.py`:
- `"Could not connect to {application} command proxy server"` → proxy is down
- `"Could not connect to {application}. Connection Timed Out"` → proxy is up but Premiere didn't respond

### Issue 5: `add-to-sequence` UXP Verification

**Resolved:** The `addMediaToSequence` handler is confirmed present and fully implemented in `uxp/pr/commands/core.js`. It is also registered in the `commandHandlers` export and was already exposed as an MCP tool (`add_media_to_sequence`) in `pr-mcp.py`. The v2 plan's caution was warranted but investigation shows the handler is ready. Implement `media add-to-sequence` normally in Phase 3 with no UXP work required.

---

## Phase 0 — Test Infrastructure (TDD Foundation)

**Goal:** Set up the test framework and write all Phase 1 tests before any production code exists.

### Steps

1. **Create the directory structure** — all directories, all `__init__.py` files, empty `pyproject.toml`
2. **Write `pyproject.toml`** — copy exactly from `CLI_Plan_v2` Section 2, including `pytest-cov` in dev deps
3. **Write `tests/conftest.py`** — all shared fixtures as defined in the test spec Section 2.2
4. **Write `tests/test_config.py`** — all 11 tests from test spec Section 3.1. They will all fail (modules don't exist yet). That's correct.
5. **Write `tests/test_client.py`** — all 10 tests from test spec Section 3.2. All fail.
6. **Write `tests/test_output.py`** — all 7 tests from test spec Section 3.3. All fail.
7. **Write `tests/test_config_cmds.py`** — all 5 tests from test spec Section 3.13 (config commands) + 4 global tests from Section 3.14. All fail.
8. **Verify:** `pip install -e ".[dev]"` works, `pytest --collect-only` discovers all tests, `pytest` runs and reports failures (not import errors from missing test infrastructure — the test files themselves must be syntactically valid even though they import modules that don't exist yet)

**Phase 0 exit criteria:** All test files parse correctly. `pytest --collect-only` shows the correct number of tests. Every test fails because the production modules don't exist.

**Practical note for the agent:** You may need to create minimal stub files (`config.py`, `client.py`, `output.py`, `main.py`) with just enough content (empty classes, pass statements) for the test files to import without `ModuleNotFoundError`. That's fine — the tests should still fail on assertions, not on imports.

---

## Phase 1 — Foundation

**Goal:** Implement the core infrastructure modules. All Phase 0 tests turn green.

### Step 1.1 — Initialize Git and Scaffold

1. Create `pr-cli/` at the repo root
2. `cd pr-cli && git init`
3. Add `pr-cli/` to the parent repo's `.gitignore`
4. Create `.gitignore` inside `pr-cli/` (ignore `.venv/`, `__pycache__/`, `*.egg-info/`, `.pytest_cache/`, `.mypy_cache/`, `dist/`, `build/`)
5. Create all directories and `__init__.py` files per the corrected structure (Issue 1)
6. Write `pyproject.toml` — exact content from `CLI_Plan_v2` Section 2
7. `pip install -e ".[dev]"` — verify it completes

### Step 1.2 — Copy and Rework Transport

1. Copy `mcp/socket_client.py` → `pr_cli/transport/socket_client.py`
2. Copy `mcp/logger.py` → `pr_cli/transport/logger.py`
3. **Do NOT copy `core.py`** — its logic is inlined into `client.py`
4. **Rework `logger.py`:**

```python
"""
Logging for pr-cli transport layer.
Respects PR_CLI_LOG_LEVEL: ERROR (default, silent) or DEBUG (emit to stderr).
"""
import sys
import os

_level = os.environ.get("PR_CLI_LOG_LEVEL", "ERROR").upper()

def log(message: str, filter_tag: str = "PR-CLI"):
    """Only emit if log level is DEBUG. Always to stderr, never stdout."""
    if _level == "DEBUG":
        print(f"{filter_tag} : {message}", file=sys.stderr)
```

5. Update `socket_client.py` import: change `import logger` to `from pr_cli.transport import logger`
6. Create `pr_cli/transport/__init__.py` — empty or with convenience imports

### Step 1.3 — Implement `config.py`

Implement the full config module per `CLI_Plan_v2` Section 3. Key implementation detail:

```python
"""
Configuration resolution: env var → config file → built-in default.
"""
import os
import sys
from pathlib import Path

_DEFAULTS = {
    "proxy_url": "http://localhost:3001",
    "timeout": 20,
    "log_level": "ERROR",
}

_config_dir = Path.home() / ".pr-cli"
_config_file = _config_dir / "config.toml"
_file_values: dict = {}

def _load_config_file():
    global _file_values
    if _config_file.exists():
        try:
            # Python 3.11+ has tomllib; 3.10 needs fallback
            try:
                import tomllib
            except ImportError:
                import tomli as tomllib
            with open(_config_file, "rb") as f:
                _file_values = tomllib.load(f)
        except Exception as e:
            print(f"Warning: could not parse {_config_file}: {e}", file=sys.stderr)
            _file_values = {}

_load_config_file()

def get_proxy_url() -> str:
    return os.environ.get("PR_CLI_PROXY_URL") or _file_values.get("proxy_url") or _DEFAULTS["proxy_url"]

def get_timeout() -> int:
    env = os.environ.get("PR_CLI_TIMEOUT")
    if env is not None:
        try:
            return int(env)
        except ValueError:
            print(f"Warning: PR_CLI_TIMEOUT='{env}' is not a valid integer, using default", file=sys.stderr)
            return _DEFAULTS["timeout"]
    file_val = _file_values.get("default_timeout")
    if file_val is not None:
        return int(file_val)
    return _DEFAULTS["timeout"]

def get_log_level() -> str:
    env = os.environ.get("PR_CLI_LOG_LEVEL")
    if env:
        return env.upper()
    return _file_values.get("log_level", _DEFAULTS["log_level"]).upper()
```

**Note on Python 3.10:** `tomllib` was added in 3.11. Since `pyproject.toml` declares `>=3.10`, add `tomli` as a dependency (it's the backport) or gate the import. The code above handles both.

**After implementing:** Run `pytest tests/test_config.py` — all 11 tests should pass.

### Step 1.4 — Implement `client.py`

Implement per Issue 4 resolution above. The module:

1. Imports `socket_client` from `pr_cli.transport`
2. Reads config via `pr_cli.config`
3. Calls `socket_client.configure()` at module level
4. Exposes `send(action, options, timeout=None) -> dict`
5. Defines three exception classes: `ProxyNotAvailable`, `PremiereNotConnected`, `CommandFailed`
6. Maps raw exceptions per the rules in Issue 4

**After implementing:** Run `pytest tests/test_client.py` — all 10 tests should pass.

### Step 1.5 — Implement `output.py`

```python
"""
Output formatting for pr-cli.
All output goes through these two functions. The JSON contract is sacred.
"""
import json
import sys
from typing import Annotated
import typer
from rich.console import Console
from rich.panel import Panel

# Type alias used by every command to declare --json
JsonFlag = Annotated[bool, typer.Option("--json", help="Output as machine-readable JSON")]

_console = Console()
_err_console = Console(stderr=True)

def success(data: dict, json_mode: bool = False):
    if json_mode:
        print(json.dumps({"status": "SUCCESS", "data": data}, indent=2, default=str))
    else:
        _console.print_json(json.dumps(data, default=str))

def error(message: str, json_mode: bool = False):
    if json_mode:
        print(json.dumps({"status": "ERROR", "message": message}))
    else:
        _err_console.print(Panel(f"[red]{message}[/red]", title="Error", border_style="red"))


def parse_json_arg(value: str, expected_type: str = "dict") -> dict | list:
    """
    Parse a JSON string argument. Raises typer.BadParameter on failure.
    Used by metadata and effects commands for dict/list arguments.
    """
    if not value or not value.strip():
        raise typer.BadParameter("JSON argument cannot be empty")
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as e:
        raise typer.BadParameter(f"Invalid JSON: {e}")

    if expected_type == "dict" and not isinstance(parsed, dict):
        raise typer.BadParameter(f"Expected a JSON object (dict), got {type(parsed).__name__}")
    if expected_type == "list" and not isinstance(parsed, list):
        raise typer.BadParameter(f"Expected a JSON array (list), got {type(parsed).__name__}")
    return parsed
```

**After implementing:** Run `pytest tests/test_output.py` — all 7 tests should pass.

### Step 1.6 — Implement `main.py` Scaffolding

```python
"""
pr-cli entry point. Registers all command group sub-apps.
"""
import typer
from pr_cli import __version__

app = typer.Typer(
    name="pr-cli",
    help="Agent-first CLI for Adobe Premiere Pro automation.",
    no_args_is_help=True,
)

def version_callback(value: bool):
    if value:
        print(f"pr-cli {__version__}")
        raise typer.Exit()

@app.callback()
def main(
    version: bool = typer.Option(None, "--version", callback=version_callback, is_eager=True, help="Show version and exit"),
):
    pass

# Import and register sub-apps (added as they are implemented)
from pr_cli.commands import config as config_cmds
app.add_typer(config_cmds.app, name="config", help="Show and check CLI configuration")
```

And in `pr_cli/__init__.py`:

```python
__version__ = "0.1.0"
```

### Step 1.7 — Implement Config Commands

Create `pr_cli/commands/config.py`:

```python
import typer
from pr_cli import config
from pr_cli.output import success, error, JsonFlag

app = typer.Typer(no_args_is_help=True)

@app.command()
def show(json_mode: JsonFlag = False):
    """Print the currently resolved configuration."""
    data = {
        "proxy_url": config.get_proxy_url(),
        "timeout": config.get_timeout(),
        "log_level": config.get_log_level(),
    }
    success(data, json_mode)

@app.command()
def check(json_mode: JsonFlag = False):
    """Test connectivity to the proxy server."""
    import socketio
    url = config.get_proxy_url()
    sio = socketio.Client(logger=False)
    reachable = False
    try:
        sio.connect(url, transports=["websocket"], wait_timeout=5)
        reachable = True
        sio.disconnect()
    except Exception:
        pass

    if reachable:
        success({"proxy_reachable": True, "proxy_url": url}, json_mode)
    else:
        error(f"Cannot reach proxy at {url}. Is it running?", json_mode)
        raise typer.Exit(code=1)
```

### Step 1.8 — Smoke Test `--json` Positioning

Run manually and in tests:

```bash
pr-cli config show --json        # MUST work (flag after subcommand)
pr-cli --json config show        # MUST fail or ignore --json (not a global flag)
```

**After all Step 1.x:** Run `pytest` — all Phase 0 + Phase 1 tests pass. Run `pr-cli --version` and `pr-cli --help`. Commit.

**Phase 1 exit criteria:** `pr-cli config check` reports proxy status. `pr-cli config show --json` outputs valid JSON. 100% coverage on `config.py`, `client.py`, `output.py`. All tests green.

---

## Phase 2 — Core Commands

**Goal:** Implement project, media import, and basic sequence commands. The "create project → import media → create sequence" workflow works end-to-end.

### TDD First

Before writing any command code:
1. Write `tests/test_project.py` — all tests from test spec Section 3.5
2. Write `tests/test_media.py` — tests 1-2 from test spec Section 3.7 (import only; `add-to-sequence` deferred to Phase 3)
3. Write `tests/test_sequence.py` — tests 1-3 from test spec Section 3.6 (list, set-active, create-from-media only)
4. Run `pytest` — all new tests fail, all Phase 1 tests still pass

### Step 2.1 — Project Commands (`commands/project.py`)

Implement all five commands. Pattern for each:

```python
import typer
from pr_cli import client
from pr_cli.output import success, error, JsonFlag

app = typer.Typer(no_args_is_help=True)

@app.command()
def info(json_mode: JsonFlag = False):
    """Get active project name, path, ID, and item list."""
    try:
        response = client.send("getProjectInfo", {})
        success(response.get("response", response), json_mode)
    except client.ProxyNotAvailable:
        error("Cannot reach proxy. Is it running? Run: pr-cli config check", json_mode)
        raise typer.Exit(code=1)
    except client.PremiereNotConnected:
        error("Proxy reachable but Premiere plugin is not connected.", json_mode)
        raise typer.Exit(code=1)
    except client.CommandFailed as e:
        error(str(e), json_mode)
        raise typer.Exit(code=1)
```

**Commands and their action strings:**

| Command | Function | Action String | Arguments |
|---|---|---|---|
| `info` | `info()` | `getProjectInfo` | none |
| `save` | `save()` | `saveProject` | none |
| `save-as` | `save_as(file_path)` | `saveProjectAs` | `{"filePath": file_path}` |
| `open` | `open_project(file_path)` | `openProject` | `{"filePath": file_path}` |
| `create` | `create(directory_path, project_name)` | `createProject` | `{"path": directory_path, "name": project_name}` |

Register in `main.py`: `app.add_typer(project.app, name="project")`

Run `pytest tests/test_project.py` — all pass.

### Step 2.2 — Media Import Command (`commands/media.py`)

```python
@app.command(name="import")
def import_media(
    file_paths: Annotated[list[str], typer.Argument(help="Paths to media files to import")],
    json_mode: JsonFlag = False,
):
    """Import one or more media files into the active project."""
    # ... standard try/except pattern ...
    response = client.send("importMedia", {"filePaths": file_paths})
```

**Note:** `import` is a Python keyword so the function is named `import_media` with `name="import"` in the decorator.

Run `pytest tests/test_media.py` — import tests pass.

### Step 2.3 — Sequence Commands (Partial: list, set-active, create-from-media)

Implement `commands/sequence.py` with these three commands:

| Command | Action String | Special Handling |
|---|---|---|
| `list` | `getProjectInfo` | **Extract sequences only** from full response (Issue 2). Look for a `sequences` key or filter `items` by type. |
| `set-active` | `setActiveSequence` | `{"sequenceId": sequence_id}` |
| `create-from-media` | `createSequenceFromMedia` | `item_names` is `list[str]` positional arg, `--name` is optional |

For `sequence list`, the data shaping:

```python
@app.command(name="list")
def list_sequences(json_mode: JsonFlag = False):
    """List all sequences in the active project."""
    try:
        response = client.send("getProjectInfo", {})
        project_data = response.get("response", {})
        # The getProjectInfo response includes items; extract sequence info
        # Actual shape determined by integration test — adjust field name if needed
        items = project_data.get("items", [])
        sequences = [item for item in items if item.get("type") == "sequence"] if isinstance(items, list) else items
        success({"sequences": sequences}, json_mode)
    except ...
```

**Important:** The exact response shape of `getProjectInfo` needs verification during integration testing. The sequence extraction logic may need adjustment based on the actual data. Write the unit tests against a mocked response shape that matches what the UXP plugin returns (based on `uxp/pr/commands/utils.js` `getSequenceInfo` — it returns objects with `name`, `id`, `isActive`, `frameSize`, `videoTracks`, `audioTracks`, `fps`, etc.).

Register in `main.py`: `app.add_typer(sequence.app, name="sequence")`

Run `pytest tests/test_sequence.py` — the three implemented commands' tests pass.

### Step 2.4 — Integration Verification

With Premiere running:
1. `pr-cli config check --json` → confirms proxy reachable
2. `pr-cli project create /tmp MyTestProject --json` → creates project
3. `pr-cli media import /path/to/test-clip.mp4 --json` → imports media
4. `pr-cli sequence create-from-media test-clip.mp4 --name "Test Sequence" --json` → creates sequence
5. `pr-cli sequence list --json` → shows the new sequence with its ID
6. Inspect the `sequence list` output shape and adjust the data extraction in Step 2.3 if needed

### Step 2.5 — Draft SKILL.md Sections

Write SKILL.md sections 1-3 (what, prerequisites, rules) and partial section 4 (command reference for project, media import, sequence list/set-active/create-from-media). This is a living document.

**Phase 2 exit criteria:** Full create→import→sequence workflow works via CLI. All Phase 2 tests green. 90%+ coverage on `commands/project.py`, `commands/media.py`, `commands/sequence.py`.

---

## Phase 3 — Manipulation Commands

**Goal:** Clips, bins, and remaining sequence commands.

### TDD First

1. Write `tests/test_clips.py` — all tests from test spec Section 3.9
2. Write `tests/test_bin.py` — all tests from test spec Section 3.8
3. Add remaining tests to `tests/test_sequence.py` — tests 4-7 from test spec Section 3.6
4. Add tests 3-4 to `tests/test_media.py` — the `add-to-sequence` tests from test spec Section 3.7
5. Run `pytest` — new tests fail, all existing tests still pass

### Step 3.1 — Clips Commands (`commands/clips.py`)

| Command | Action String | Arguments |
|---|---|---|
| `set-properties` | `setVideoClipProperties` | `sequenceId`, `videoTrackIndex`, `trackItemIndex`, `--opacity` (default 100), `--blend-mode` (default "NORMAL") |
| `set-disabled` | `setClipDisabled` | `sequenceId`, `trackIndex`, `trackItemIndex`, `trackType`, `disabled` (bool) |
| `set-audio-mute` | `setAudioTrackMute` | `sequenceId`, `audioTrackIndex`, `mute` (bool) |

### Step 3.2 — Bin Commands (`commands/bin.py`)

| Command | Action String | Arguments |
|---|---|---|
| `create` | `createBinInActiveProject` | `binName` (str) |
| `move-items` | `moveProjectItemsToBin` | `binName` (str), `itemNames` (list[str] positional) |

For `move-items`, the bin name comes first, then the item names as variadics:

```python
@app.command(name="move-items")
def move_items(
    bin_name: Annotated[str, typer.Argument(help="Target bin name")],
    item_names: Annotated[list[str], typer.Argument(help="Items to move")],
    json_mode: JsonFlag = False,
):
```

### Step 3.3 — Remaining Sequence Commands

Add to existing `commands/sequence.py`:

| Command | Action String | Arguments |
|---|---|---|
| `close-gaps` | `closeGapsOnSequence` | `sequenceId`, `trackIndex`, `trackType` |
| `add-marker` | `addMarkerToSequence` | `sequenceId`, `markerName`, `startTimeTicks` (int), `durationTicks` (int), `comments` (str), `--marker-type` (default "Comment") |
| `remove-item` | `removeItemFromSequence` | `sequenceId`, `trackIndex`, `trackItemIndex`, `trackType`, `--ripple-delete` (default True) |
| `set-clip-times` | `setClipStartEndTimes` | `sequenceId`, `trackIndex`, `trackItemIndex`, `startTimeTicks` (int), `endTimeTicks` (int), `trackType` |

### Step 3.4 — Media `add-to-sequence` Command

Add to existing `commands/media.py`:

| Command | Action String | Arguments |
|---|---|---|
| `add-to-sequence` | `addMediaToSequence` | `sequenceId`, `itemName`, `videoTrackIndex` (int), `audioTrackIndex` (int), `--insertion-time-ticks` (default 0), `--overwrite/--no-overwrite` (default True) |

This is confirmed wired in the UXP plugin (Issue 5 resolved above).

**Phase 3 exit criteria:** All clips, bin, remaining sequence, and media add-to-sequence tests green. Update SKILL.md with new commands.

---

## Phase 4 — Effects and Metadata

**Goal:** The two command groups that require JSON string argument parsing.

### TDD First

1. Write `tests/test_effects.py` — all 10 tests from test spec Section 3.10
2. Write `tests/test_metadata.py` — all 8 tests from test spec Section 3.11
3. Run `pytest` — new tests fail, all existing pass

### Step 4.1 — Effects Commands (`commands/effects.py`)

| Command | Action String | Complex Args |
|---|---|---|
| `add-video-filter` | `appendVideoFilter` | `--properties` optional JSON string (list of `{name, value}` dicts) |
| `add-video-transition` | `appendVideoTransition` | `--duration` (float, default 1.0), `--alignment` (float, default 0.5) |
| `get-clip-effects` | `getClipEffects` | none |
| `get-effect-params` | `getEffectParameters` | `effectMatchName` arg |
| `set-effect-param` | `setEffectParameter` | `value` arg — accept as string, attempt `json.loads()`, fall back to raw string if not valid JSON (handles both `75` and `'{"x":960}'`) |
| `get-effect-param-value` | `getEffectParameterValue` | `--time-ticks` (default 0), `--track-type` (default "VIDEO") |

For `add-video-filter`, the `--properties` argument:

```python
@app.command(name="add-video-filter")
def add_video_filter(
    sequence_id: Annotated[str, typer.Argument(help="Sequence ID")],
    track_index: Annotated[int, typer.Argument(help="Video track index")],
    item_index: Annotated[int, typer.Argument(help="Clip index on track")],
    effect_name: Annotated[str, typer.Argument(help="Effect match name, e.g. 'AE.ADBE Black & White'")],
    properties: Annotated[str, typer.Option(help="JSON array of {name, value} objects")] = "[]",
    json_mode: JsonFlag = False,
):
    parsed_props = parse_json_arg(properties, expected_type="list")
    response = client.send("appendVideoFilter", {
        "sequenceId": sequence_id,
        "videoTrackIndex": track_index,
        "trackItemIndex": item_index,
        "effectName": effect_name,
        "properties": parsed_props,
    })
```

For `set-effect-param`, the `value` argument needs smart parsing:

```python
def _parse_value(raw: str):
    """Try JSON parse first (handles dicts, lists, numbers, bools). Fall back to string."""
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw
```

### Step 4.2 — Metadata Commands (`commands/metadata.py`)

| Command | Action String | Complex Args |
|---|---|---|
| `get-project` | `getProjectMetadata` | `itemName` |
| `set-project` | `setProjectMetadata` | `itemName`, `fields` (JSON string → dict) |
| `get-xmp` | `getXMPMetadata` | `itemName` |
| `set-xmp` | `setXMPMetadata` | `itemName`, `metadataUpdates` (JSON string → dict) |
| `add-property` | `addMetadataProperty` | `propertyName`, `propertyLabel`, `--type` (default "Text") |
| `get-panel` | `getProjectPanelMetadata` | none |

For `set-project` and `set-xmp`, use `parse_json_arg()` from `output.py`:

```python
@app.command(name="set-project")
def set_project(
    item_name: Annotated[str, typer.Argument(help="Project item name")],
    fields_json: Annotated[str, typer.Argument(help="JSON object of field:value pairs")],
    json_mode: JsonFlag = False,
):
    fields = parse_json_arg(fields_json, expected_type="dict")
    response = client.send("setProjectMetadata", {
        "itemName": item_name,
        "metadataFields": fields,
    })
```

**Phase 4 exit criteria:** All effects and metadata tests green. JSON argument parsing works correctly for valid and invalid input. Update SKILL.md.

---

## Phase 5 — Export, SKILL.md, and Completion

**Goal:** Final commands, complete documentation, smoke tests, full integration pass.

### TDD First

1. Write `tests/test_export.py` — all 5 tests from test spec Section 3.12
2. Write `tests/test_skill_doc.py` — all 3 tests from test spec Section 5.1
3. Run `pytest` — export tests fail (not implemented), skill doc test fails (SKILL.md incomplete)

### Step 5.1 — Export Commands (`commands/export.py`)

| Command | Action String | Special |
|---|---|---|
| `sequence` | `exportSequence` | `--timeout` (default **300**, not the global 20) |
| `frame` | `exportFrame` | `--timeout` (default **120**) |

```python
@app.command()
def sequence(
    sequence_id: Annotated[str, typer.Argument(help="Sequence ID to export")],
    output_path: Annotated[str, typer.Argument(help="Output file path")],
    preset_path: Annotated[str, typer.Argument(help="Export preset (.epr) path")],
    timeout: Annotated[int, typer.Option(help="Timeout in seconds (exports are slow)")] = 300,
    json_mode: JsonFlag = False,
):
    """Export a sequence to video. Default timeout is 300 seconds."""
    # ... standard try/except, passing timeout to client.send ...
    response = client.send("exportSequence", {
        "sequenceId": sequence_id,
        "outputPath": output_path,
        "presetPath": preset_path,
    }, timeout=timeout)
```

### Step 5.2 — Write Complete SKILL.md

Write the full SKILL.md per `CLI_Plan_v2` Section 10. Structure:

1. **What this tool does** — one paragraph
2. **Prerequisites** — proxy + plugin check instructions
3. **Important rules for agents** — sequence ID requirement, export timeouts, `--json` positioning, list vs dict arg format, `get_sequence_frame_image` omission note
4. **Command reference** — every command, every flag, example invocation, example JSON output
5. **Named workflows** — "create project and rough cut", "add effects to clips", "export final video"
6. **Error reference** — the three error types, exit codes, what to do for each

### Step 5.3 — Run Tier 3 Smoke Test

`pytest tests/test_skill_doc.py` — must pass. Fix any drift between SKILL.md and actual CLI.

### Step 5.4 — Full Integration Test Suite

With Premiere running, run `pytest -m integration`. All Tier 2 tests must pass. The rapid-fire test (10 sequential commands) validates the per-command socket connection limitation is not a blocker.

### Step 5.5 — Coverage Check

```bash
pytest --cov=pr_cli --cov-report=term-missing --cov-fail-under=90
```

Verify: `config.py` and `client.py` at 100%. `commands/` at 90%+.

### Step 5.6 — Final Commit and Tag

1. Review all `--help` text for quality (Issue 3)
2. Commit everything
3. Tag `v0.1.0`

**Phase 5 exit criteria:** All Definition of Done items from `CLI_Plan_v2` Section 13 are satisfied. The CLI is production-ready.

---

## Appendix A: Command Registration Checklist

After all phases, `main.py` should have these registrations:

```python
from pr_cli.commands import config as config_cmds
from pr_cli.commands import project, sequence, media, clips, bin as bin_cmds, effects, metadata, export

app.add_typer(config_cmds.app, name="config", help="Show and check CLI configuration")
app.add_typer(project.app, name="project", help="Project operations")
app.add_typer(sequence.app, name="sequence", help="Sequence operations")
app.add_typer(media.app, name="media", help="Media import and placement")
app.add_typer(clips.app, name="clips", help="Clip property manipulation")
app.add_typer(bin_cmds.app, name="bin", help="Bin/folder management")
app.add_typer(effects.app, name="effects", help="Effects and transitions")
app.add_typer(metadata.app, name="metadata", help="Project and XMP metadata")
app.add_typer(export.app, name="export", help="Export sequences and frames")
```

**Note:** `bin` is a Python builtin, so import it aliased as `bin_cmds`.

---

## Appendix B: Python 3.10 Compatibility Notes

- Use `from __future__ import annotations` at the top of every file for `X | Y` union syntax
- Or use `Optional[X]` and `Union[X, Y]` from `typing`
- `tomllib` requires 3.11+; add `tomli` to dependencies as a fallback
- `list[str]` in function signatures works in 3.10 with `from __future__ import annotations`

---

## Appendix C: Dependency Addition

Add `tomli` to the dependency list for Python 3.10 compatibility:

```toml
dependencies = [
    "typer[all]>=0.12.0",
    "python-socketio",
    "websocket-client>=1.8.0",
    "requests",
    "tomli>=2.0.0; python_version < '3.11'",
]
```
