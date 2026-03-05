# pr-cli Test Specification

### Comprehensive Test Plan for the Premiere Pro CLI

> **Document role:** This is the test specification referenced by the phased implementation plan. Tests should be written **before** the code they validate (TDD). Each phase in the implementation plan begins by writing the tests defined here for that phase, then implementing until they pass.

---

## 1. Testing Philosophy

This project follows **Test-Driven Development (TDD)**. For every module and command:

1. Write the test first, asserting the expected behavior
2. Run the test — it must fail (red)
3. Write the minimum code to make it pass (green)
4. Refactor while keeping tests green

All unit tests (Tier 1) run without any external dependencies — no proxy, no Premiere, no network. The socket layer is always mocked. An agent or CI system can run `pytest` cold and get a full pass.

---

## 2. Test Infrastructure

### 2.1 Directory Layout

```
tests/
├── __init__.py
├── conftest.py          ← shared fixtures used by all test files
├── test_config.py       ← config resolution tests
├── test_client.py       ← client.send + exception mapping tests
├── test_output.py       ← output formatting tests
├── test_project.py      ← project command group
├── test_sequence.py     ← sequence command group
├── test_media.py        ← media command group
├── test_clips.py        ← clips command group
├── test_bin.py          ← bin command group
├── test_effects.py      ← effects command group
├── test_metadata.py     ← metadata command group
├── test_export.py       ← export command group
├── test_config_cmds.py  ← config show / config check commands
└── test_skill_doc.py    ← Tier 3: SKILL.md ↔ CLI parity smoke test
```

### 2.2 Core Fixtures (`conftest.py`)

```python
import pytest
from unittest.mock import patch, MagicMock
from typer.testing import CliRunner
from pr_cli.main import app


@pytest.fixture
def runner():
    """Typer CLI test runner."""
    return CliRunner()


@pytest.fixture
def mock_send():
    """
    Patches pr_cli.client.send so no socket activity occurs.
    Yields a MagicMock whose .return_value or .side_effect
    the individual test sets before invoking a CLI command.
    """
    with patch("pr_cli.client.send") as m:
        yield m


@pytest.fixture
def mock_config(tmp_path):
    """
    Provides a temporary config directory and patches config
    resolution to use it. Useful for testing config file fallback.
    """
    config_dir = tmp_path / ".pr-cli"
    config_dir.mkdir()
    with patch("pr_cli.config._config_dir", config_dir):
        yield config_dir


@pytest.fixture
def success_response():
    """Factory for standard success responses."""
    def _make(data: dict):
        return {"status": "SUCCESS", "response": data}
    return _make


@pytest.fixture
def failure_response():
    """Factory for standard failure responses."""
    def _make(message: str):
        return {"status": "FAILURE", "message": message}
    return _make
```

### 2.3 Runner Invocation Convention

Every command test invokes the CLI through Typer's `CliRunner` exactly as an agent would call it from a shell. The canonical pattern is:

```python
result = runner.invoke(app, ["<group>", "<command>", "<args...>", "--json"])
```

The `--json` flag always goes **after** the subcommand. Tests must verify this positioning works. A subset of tests per command group also confirm that `--json` placed before the group is rejected or ignored (defensive check).

---

## 3. Tier 1 — Unit Tests

### 3.1 Config Module (`test_config.py`)

Tests the three-level resolution: env var → config file → built-in default.

| # | Test Name | Setup | Assert |
|---|-----------|-------|--------|
| 1 | `test_default_proxy_url` | No env var, no config file | `get_proxy_url()` returns `"http://localhost:3001"` |
| 2 | `test_default_timeout` | No env var, no config file | `get_timeout()` returns `20` |
| 3 | `test_default_log_level` | No env var, no config file | `get_log_level()` returns `"ERROR"` |
| 4 | `test_env_var_overrides_default` | Set `PR_CLI_PROXY_URL=http://custom:9999` | `get_proxy_url()` returns `"http://custom:9999"` |
| 5 | `test_env_var_overrides_config_file` | Config file sets `proxy_url`, env var also set | env var wins |
| 6 | `test_config_file_overrides_default` | Write `config.toml` with `proxy_url` | `get_proxy_url()` returns config file value |
| 7 | `test_timeout_env_var_parsed_as_int` | Set `PR_CLI_TIMEOUT=60` | `get_timeout()` returns `60` (int, not string) |
| 8 | `test_invalid_timeout_env_var` | Set `PR_CLI_TIMEOUT=notanumber` | Falls back to default `20`, logs warning |
| 9 | `test_log_level_case_insensitive` | Set `PR_CLI_LOG_LEVEL=debug` | `get_log_level()` returns `"DEBUG"` |
| 10 | `test_missing_config_dir_no_crash` | `~/.pr-cli/` does not exist | All getters return defaults, no exception |
| 11 | `test_malformed_toml_no_crash` | Write invalid TOML to config file | Falls back to defaults, logs warning |

### 3.2 Client Module (`test_client.py`)

Tests the `client.send()` function, exception mapping from raw `socket_client` exceptions to the three named CLI exception types, and command dict construction.

**Exception mapping rules** (this is critical — see Implementation Plan for details):

- `socket_client` raises `RuntimeError` containing `"proxy server"` → `ProxyNotAvailable`
- `socket_client` raises `RuntimeError` containing `"Connection Timed Out"` or `"MCP Plugin"` → `PremiereNotConnected`
- `socket_client` raises `AppError` → `CommandFailed`
- `socket_client` returns `None` → `ProxyNotAvailable`

| # | Test Name | Setup | Assert |
|---|-----------|-------|--------|
| 1 | `test_send_builds_correct_command_dict` | Mock `socket_client.send_message_blocking` | Called with `{"application": "premiere", "action": "<action>", "options": {<opts>}}` |
| 2 | `test_send_returns_response_on_success` | Mock returns `{"status": "SUCCESS", "response": {...}}` | `send()` returns the same dict |
| 3 | `test_send_passes_custom_timeout` | Call with `timeout=600` | `send_message_blocking` called with `timeout=600` |
| 4 | `test_send_uses_default_timeout_when_none` | Call without timeout | `send_message_blocking` called with `timeout=None` (defers to socket_client global) |
| 5 | `test_runtime_error_proxy_maps_to_proxy_not_available` | Mock raises `RuntimeError("...proxy server...")` | Raises `ProxyNotAvailable` |
| 6 | `test_runtime_error_timeout_maps_to_premiere_not_connected` | Mock raises `RuntimeError("...Connection Timed Out...")` | Raises `PremiereNotConnected` |
| 7 | `test_app_error_maps_to_command_failed` | Mock raises `AppError("some message")` | Raises `CommandFailed` with message preserved |
| 8 | `test_none_response_maps_to_proxy_not_available` | Mock returns `None` | Raises `ProxyNotAvailable` |
| 9 | `test_configure_called_on_import` | Import `client` module | `socket_client.configure` was called once with values from config |
| 10 | `test_unexpected_exception_propagates` | Mock raises `ValueError` | `ValueError` is not swallowed — it propagates |

### 3.3 Output Module (`test_output.py`)

| # | Test Name | Setup | Assert |
|---|-----------|-------|--------|
| 1 | `test_success_json_mode` | Call `output.success({"name": "X"}, json_mode=True)` | stdout is `{"status": "SUCCESS", "data": {"name": "X"}}` (valid JSON, no Rich markup) |
| 2 | `test_error_json_mode` | Call `output.error("boom", json_mode=True)` | stdout is `{"status": "ERROR", "message": "boom"}` |
| 3 | `test_success_human_mode` | Call `output.success({"name": "X"}, json_mode=False)` | stdout contains "X" formatted by Rich (no JSON wrapper) |
| 4 | `test_error_human_mode` | Call `output.error("boom", json_mode=False)` | stderr contains "boom" with Rich error styling |
| 5 | `test_json_output_is_parseable` | Success + pipe through `json.loads()` | Parses without error, has exactly keys `status` and `data` |
| 6 | `test_error_json_output_is_parseable` | Error + pipe through `json.loads()` | Parses without error, has exactly keys `status` and `message` |
| 7 | `test_json_flag_type_alias_exists` | Import `JsonFlag` from output | It is an `Annotated[bool, ...]` type |

### 3.4 Command Group Tests — Shared Pattern

Every command group follows the same test template. For each command in the group, there are **six standard tests**:

1. **Happy path with `--json`** — mock returns success, assert exit code 0, assert JSON output shape
2. **Happy path without `--json`** (human mode) — mock returns success, assert exit code 0, assert output contains key data
3. **Proxy not available** — mock raises `ProxyNotAvailable`, assert exit code 1, assert error message mentions proxy
4. **Premiere not connected** — mock raises `PremiereNotConnected`, assert exit code 1, assert error message mentions plugin/Premiere
5. **Command failed** — mock raises `CommandFailed`, assert exit code 1, assert error message preserved
6. **Correct action string** — mock the send function, invoke command, assert `send()` was called with the exact action string from the mapping table

For commands with complex arguments, two additional tests:

7. **Valid JSON string argument** — pass well-formed JSON, assert it parses and reaches `send()` as a dict
8. **Malformed JSON string argument** — pass `'{bad json'`, assert exit code 2, assert `BadParameter` error

### 3.5 Project Commands (`test_project.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `project info` | happy path json | `getProjectInfo` | Output contains `"status": "SUCCESS"` |
| 2 | `project info` | proxy down | `getProjectInfo` | Exit 1, mentions proxy |
| 3 | `project info` | premiere disconnected | `getProjectInfo` | Exit 1, mentions plugin |
| 4 | `project save` | happy path json | `saveProject` | Exit 0 |
| 5 | `project save-as /tmp/x.prproj` | happy path json | `saveProjectAs` | `send()` options has `filePath` |
| 6 | `project open /tmp/x.prproj` | happy path json | `openProject` | `send()` options has `filePath` |
| 7 | `project create /tmp MyProject` | happy path json | `createProject` | `send()` options has `path` and `name` |
| 8 | `project create /tmp MyProject` | command failed | `createProject` | Exit 1, error message preserved |

### 3.6 Sequence Commands (`test_sequence.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `sequence list` | happy path json | `getProjectInfo` | Output contains only sequence data, not full project info |
| 2 | `sequence set-active <id>` | happy path json | `setActiveSequence` | `send()` options has `sequenceId` |
| 3 | `sequence create-from-media clip1 clip2 --name "Cut"` | happy path | `createSequenceFromMedia` | options has `itemNames` as list, `sequenceName` |
| 4 | `sequence close-gaps <id> 0 VIDEO` | happy path | `closeGapsOnSequence` | options has `sequenceId`, `trackIndex`, `trackType` |
| 5 | `sequence add-marker <id> ...` | happy path | `addMarkerToSequence` | options has all marker fields |
| 6 | `sequence remove-item <id> 0 0 VIDEO` | happy path | `removeItemFromSequence` | options has `rippleDelete` default `True` |
| 7 | `sequence set-clip-times <id> ...` | happy path | `setClipStartEndTimes` | options has `startTimeTicks`, `endTimeTicks` |

Plus the standard error tests (proxy down, premiere disconnected, command failed) for each command.

**Special test for `sequence list`:**

| # | Test | Assert |
|---|------|--------|
| S1 | `test_sequence_list_extracts_sequences_only` | Mock returns full `getProjectInfo` response with sequences embedded. Output JSON `data` field contains only the sequence array, not `name`, `path`, `id`, `items`. |

### 3.7 Media Commands (`test_media.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `media import /a.mp4 /b.mp4` | happy path | `importMedia` | options `filePaths` is `["/a.mp4", "/b.mp4"]` |
| 2 | `media import /a.mp4` | single file | `importMedia` | options `filePaths` is `["/a.mp4"]` |
| 3 | `media add-to-sequence <id> clip1 0 0` | happy path | `addMediaToSequence` | options has `sequenceId`, `itemName`, `videoTrackIndex`, `audioTrackIndex` |
| 4 | `media add-to-sequence <id> clip1 0 0 --insertion-time-ticks 5000 --overwrite` | with opts | `addMediaToSequence` | options has correct `insertionTimeTicks` and `overwrite` |

### 3.8 Bin Commands (`test_bin.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `bin create "Assets"` | happy path | `createBinInActiveProject` | options `binName` is `"Assets"` |
| 2 | `bin move-items "Assets" clip1.mp4 clip2.mp4` | happy path | `moveProjectItemsToBin` | options `itemNames` is list, `binName` is string |

### 3.9 Clips Commands (`test_clips.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `clips set-properties <id> 0 0` | defaults | `setVideoClipProperties` | options has `opacity: 100`, `blendMode: "NORMAL"` |
| 2 | `clips set-properties <id> 0 0 --opacity 50 --blend-mode MULTIPLY` | with opts | `setVideoClipProperties` | options has `opacity: 50`, `blendMode: "MULTIPLY"` |
| 3 | `clips set-disabled <id> 0 0 VIDEO true` | happy path | `setClipDisabled` | options has `disabled: True` |
| 4 | `clips set-audio-mute <id> 0 true` | happy path | `setAudioTrackMute` | options has `mute: True` |

### 3.10 Effects Commands (`test_effects.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `effects add-video-filter <id> 0 0 "AE.ADBE Black & White"` | happy path | `appendVideoFilter` | options has `effectName` |
| 2 | `effects add-video-filter <id> 0 0 "AE.ADBE Gaussian Blur 2" --properties '[{"name":"Blurriness","value":50}]'` | with properties | `appendVideoFilter` | options `properties` is parsed list of dicts |
| 3 | `effects add-video-filter <id> 0 0 "X" --properties '{bad'` | bad JSON | — | Exit 2, `BadParameter` |
| 4 | `effects add-video-transition <id> 0 0 "AE.ADBE Cross Dissolve New"` | defaults | `appendVideoTransition` | `duration` and `clipAlignment` have defaults |
| 5 | `effects add-video-transition <id> 0 0 "X" --duration 1.5 --alignment 0.5` | with opts | `appendVideoTransition` | options match |
| 6 | `effects get-clip-effects <id> 0 0` | happy path | `getClipEffects` | options correct |
| 7 | `effects get-effect-params <id> 0 0 "AE.ADBE Motion"` | happy path | `getEffectParameters` | options has `effectMatchName` |
| 8 | `effects set-effect-param <id> 0 0 "AE.ADBE Motion" "Position" '{"x":960,"y":540}'` | dict value | `setEffectParameter` | value is parsed dict |
| 9 | `effects set-effect-param <id> 0 0 "AE.ADBE Opacity" "Opacity" 75` | numeric value | `setEffectParameter` | value is number |
| 10 | `effects get-effect-param-value <id> 0 0 "AE.ADBE Motion" "Position"` | happy path | `getEffectParameterValue` | options has defaults for `timeTicks` and `trackType` |

### 3.11 Metadata Commands (`test_metadata.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `metadata get-project "clip.mp4"` | happy path | `getProjectMetadata` | options `itemName` |
| 2 | `metadata set-project "clip.mp4" '{"Column.PropertyText.Scene":"5"}'` | valid JSON | `setProjectMetadata` | options `metadataFields` is parsed dict |
| 3 | `metadata set-project "clip.mp4" '{bad'` | bad JSON | — | Exit 2 |
| 4 | `metadata get-xmp "clip.mp4"` | happy path | `getXMPMetadata` | options `itemName` |
| 5 | `metadata set-xmp "clip.mp4" '{"dublinCore":{"description":"test"}}'` | valid JSON | `setXMPMetadata` | options `metadataUpdates` is parsed dict |
| 6 | `metadata add-property MyField "My Field"` | happy path | `addMetadataProperty` | options has `propertyName`, `propertyLabel`, default `propertyType: "Text"` |
| 7 | `metadata add-property MyField "My Field" --type Integer` | with type | `addMetadataProperty` | options `propertyType: "Integer"` |
| 8 | `metadata get-panel` | happy path | `getProjectPanelMetadata` | options is empty dict |

### 3.12 Export Commands (`test_export.py`)

| # | Command | Test | Action String | Key Assert |
|---|---------|------|---------------|------------|
| 1 | `export sequence <id> /out.mp4 /preset.epr` | happy path | `exportSequence` | options has all three fields |
| 2 | `export sequence <id> /out.mp4 /preset.epr --timeout 600` | custom timeout | `exportSequence` | `send()` called with `timeout=600` |
| 3 | `export sequence <id> /out.mp4 /preset.epr` | default timeout | `exportSequence` | `send()` called with `timeout=300` (command default, not global 20) |
| 4 | `export frame <id> /frame.png 5` | happy path | `exportFrame` | options has `sequenceId`, `filePath`, `seconds` |
| 5 | `export frame <id> /frame.png 5 --timeout 120` | custom timeout | `exportFrame` | `send()` called with `timeout=120` |

### 3.13 Config Commands (`test_config_cmds.py`)

| # | Command | Test | Assert |
|---|---------|------|--------|
| 1 | `config show --json` | happy path | Exit 0, output is valid JSON with keys `proxy_url`, `timeout`, `log_level` |
| 2 | `config show` | human mode | Exit 0, output contains URL and timeout values |
| 3 | `config check --json` | proxy reachable | Exit 0, JSON has `"proxy_reachable": true` |
| 4 | `config check --json` | proxy unreachable | Exit 1, JSON has `"proxy_reachable": false` |
| 5 | `config check` | proxy unreachable human | Exit 1, output contains helpful message about starting proxy |

**Note:** `config check` needs its own mock — it makes a lightweight socket probe rather than sending a full command. The fixture should mock the socket connection attempt itself.

### 3.14 Global CLI Tests (added to `test_config_cmds.py` or a new `test_global.py`)

| # | Test | Assert |
|---|------|--------|
| 1 | `test_version_flag` | `pr-cli --version` exits 0, output contains version string |
| 2 | `test_help_flag` | `pr-cli --help` exits 0, output lists all command groups |
| 3 | `test_unknown_command` | `pr-cli nonexistent` exits non-zero |
| 4 | `test_json_flag_before_group_ignored` | `pr-cli --json project info` exits non-zero or `--json` is not recognized as global |

---

## 4. Tier 2 — Integration Tests

These are **not TDD** — they are written after commands are implemented and require a live environment. They are tagged `@pytest.mark.integration` and excluded from default `pytest` runs.

### 4.1 Prerequisites

- Proxy running on `localhost:3001`
- Premiere Pro open with the UXP plugin connected and registered
- A known test project file (path configured via `PR_CLI_TEST_PROJECT` env var)

### 4.2 Integration Test Inventory

| # | Test | What It Validates |
|---|------|-------------------|
| 1 | `test_integration_config_check` | `pr-cli config check --json` returns `proxy_reachable: true` |
| 2 | `test_integration_project_info` | `pr-cli project info --json` returns valid project data |
| 3 | `test_integration_full_workflow` | Create project → import media → create sequence → verify sequence list. Full round-trip. |
| 4 | `test_integration_rapid_fire_commands` | Run 10 `project info` commands in sequence. All succeed. Validates per-command socket cycling doesn't break under chained usage. |
| 5 | `test_integration_export_frame` | Export a frame to a temp file, verify the file exists on disk |
| 6 | `test_integration_effects_roundtrip` | Add a filter, read back effect list, verify filter is present |
| 7 | `test_integration_metadata_roundtrip` | Set project metadata, read it back, verify values match |

### 4.3 Integration Test Timeouts

All integration tests must set a generous timeout (60 seconds minimum) because Premiere operations are not instantaneous. Export tests should use 300+ seconds. Use `@pytest.mark.timeout(300)` from `pytest-timeout` if installed.

---

## 5. Tier 3 — SKILL.md Smoke Test (`test_skill_doc.py`)

This test parses `SKILL.md` and verifies that every CLI command referenced in it actually exists and responds to `--help`.

### 5.1 Implementation Approach

```python
import re
from pathlib import Path
from typer.testing import CliRunner
from pr_cli.main import app

runner = CliRunner()

SKILL_PATH = Path(__file__).parent.parent / "SKILL.md"


def extract_commands_from_skill_doc():
    """
    Parse SKILL.md and extract all lines that look like CLI invocations.
    Pattern: lines starting with `pr-cli ` in code blocks.
    Returns a list of command fragments like ["project info", "sequence list", ...]
    """
    text = SKILL_PATH.read_text()
    # Match lines like: pr-cli project info --json
    # Extract just the command part (group + command name, no args)
    pattern = r"pr-cli\s+([\w-]+\s+[\w-]+)"
    matches = re.findall(pattern, text)
    # Deduplicate
    return list(set(matches))


def test_skill_doc_exists():
    assert SKILL_PATH.exists(), "SKILL.md must exist in the pr-cli root"


def test_skill_doc_commands_all_exist():
    """Every command referenced in SKILL.md must respond to --help."""
    commands = extract_commands_from_skill_doc()
    assert len(commands) > 0, "SKILL.md should reference at least one command"

    failures = []
    for cmd in commands:
        parts = cmd.strip().split()
        result = runner.invoke(app, parts + ["--help"])
        if result.exit_code != 0:
            failures.append(f"'{cmd}' failed with exit code {result.exit_code}")

    assert not failures, f"SKILL.md references commands that don't exist:\n" + "\n".join(failures)


def test_skill_doc_no_get_sequence_frame_image():
    """
    SKILL.md must NOT reference get_sequence_frame_image or get-sequence-frame-image,
    since this MCP-only command is intentionally omitted.
    """
    text = SKILL_PATH.read_text()
    assert "get_sequence_frame_image" not in text.lower().replace("-", "_"), \
        "SKILL.md should not reference the omitted get_sequence_frame_image command"
```

---

## 6. Coverage Requirements

| Module / Package | Minimum Coverage |
|---|---|
| `pr_cli/config.py` | 100% |
| `pr_cli/client.py` | 100% |
| `pr_cli/output.py` | 100% |
| `pr_cli/commands/` (all files) | 90% |
| `pr_cli/transport/` | Not measured (copied infrastructure, mocked in all tests) |

Run coverage with:

```bash
pytest --cov=pr_cli --cov-report=term-missing --cov-fail-under=90
```

---

## 7. Test ↔ Phase Mapping

This table maps each test file to the implementation phase where it should be written and first pass.

| Test File | Written In | Must Pass By |
|---|---|---|
| `test_config.py` | Phase 0 (TDD) | Phase 1 step 5 |
| `test_client.py` | Phase 0 (TDD) | Phase 1 step 6 |
| `test_output.py` | Phase 0 (TDD) | Phase 1 step 7 |
| `test_config_cmds.py` | Phase 1 | Phase 1 step 9 |
| `test_project.py` | Phase 2 | Phase 2 step 1 |
| `test_media.py` | Phase 2 | Phase 2 step 2 |
| `test_sequence.py` | Phase 2 (partial) | Phase 2 step 3 |
| `test_clips.py` | Phase 3 | Phase 3 step 1 |
| `test_bin.py` | Phase 3 | Phase 3 step 2 |
| `test_sequence.py` (remaining) | Phase 3 | Phase 3 step 3 |
| `test_effects.py` | Phase 4 | Phase 4 step 1 |
| `test_metadata.py` | Phase 4 | Phase 4 step 2 |
| `test_export.py` | Phase 5 | Phase 5 step 1 |
| `test_skill_doc.py` | Phase 5 | Phase 5 step 3 |

---

## 8. JSON String Argument Validation Tests

Commands that accept JSON string arguments (`metadata set-project`, `metadata set-xmp`, `effects add-video-filter --properties`, `effects set-effect-param`) share a validation pattern. These tests ensure consistent behavior:

| # | Input | Expected |
|---|-------|----------|
| 1 | `'{}'` | Parses to empty dict, passes to `send()` |
| 2 | `'{"key": "value"}'` | Parses correctly |
| 3 | `'{bad json'` | Exit code 2, `BadParameter` error message |
| 4 | `''` (empty string) | Exit code 2, `BadParameter` |
| 5 | `'"just a string"'` | Exit code 2 (expected dict, got string) — for dict-type args |
| 6 | `'[1, 2, 3]'` | Valid for `--properties` (list type), exit 2 for dict-type args |

The validation logic should live in a shared helper (e.g., `output.parse_json_arg(value, expected_type="dict")`) so all commands behave identically and one set of tests covers the shared code.

---

## 9. Error Message Consistency Tests

Every command's error output in JSON mode must follow the contract. These are spot-checked across command groups rather than exhaustively tested per command:

```python
def test_all_errors_have_consistent_json_shape(runner, mock_send):
    """
    Sample several commands with different error types.
    All must produce {"status": "ERROR", "message": "..."} in JSON mode.
    """
    from pr_cli.client import ProxyNotAvailable, PremiereNotConnected, CommandFailed

    commands_to_test = [
        ["project", "info", "--json"],
        ["sequence", "list", "--json"],
        ["media", "import", "/fake.mp4", "--json"],
    ]

    for error_class in [ProxyNotAvailable, PremiereNotConnected, CommandFailed]:
        mock_send.side_effect = error_class("test error")
        for cmd in commands_to_test:
            result = runner.invoke(app, cmd)
            assert result.exit_code == 1
            data = json.loads(result.output)
            assert data["status"] == "ERROR"
            assert "message" in data
```
