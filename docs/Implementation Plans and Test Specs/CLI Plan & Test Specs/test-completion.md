# pr-cli Test Completion Document

## Test Manifest

| File | Test Count | Phase | Spec Section |
|------|-----------|-------|-------------|
| `tests/conftest.py` | 5 fixtures | Shared | 2.2 |
| `tests/test_config.py` | 11 | Phase 1 | 3.1 |
| `tests/test_output.py` | 11 | Phase 1 | 3.3 |
| `tests/test_config_cmds.py` | 9 | Phase 1 | 3.13 + 3.14 |
| `tests/test_client.py` | 11 | Phase 1 | 3.2 |
| `tests/test_project.py` | 10 | Phase 2 | 3.5 |
| `tests/test_sequence.py` | 15 | Phase 2-3 | 3.6 |
| `tests/test_media.py` | 8 | Phase 2-3 | 3.7 |
| `tests/test_clips.py` | 8 | Phase 3 | 3.9 |
| `tests/test_bin.py` | 7 | Phase 3 | 3.8 |
| `tests/test_effects.py` | 14 | Phase 4 | 3.10 |
| `tests/test_metadata.py` | 12 | Phase 4 | 3.11 |
| `tests/test_export.py` | 8 | Phase 5 | 3.12 |
| `tests/test_skill_doc.py` | 4 | Phase 5 | 5.1 |
| **Total** | **128** | | |

## Phase-to-Test Mapping

### Phase 1 (Foundation)
- `test_config.py`: 11 tests — config resolution, env vars, file loading, defaults
- `test_output.py`: 11 tests — success/error JSON/human output, parse_json_arg
- `test_config_cmds.py`: 9 tests — config show/check commands, --version, --help, --json positioning
- `test_client.py`: 11 tests — send(), exception mapping, timeout passthrough

**Phase 1 total: 42 tests**

### Phase 2 (Core Commands)
- `test_project.py`: 10 tests — info, save, save-as, open, create
- `test_sequence.py` (partial): ~6 tests — list, set-active, create-from-media
- `test_media.py` (partial): ~3 tests — import single/multiple

**Phase 2 total: ~19 tests**

### Phase 3 (Manipulation Commands)
- `test_sequence.py` (remaining): ~9 tests — close-gaps, add-marker, remove-item, set-clip-times
- `test_media.py` (remaining): ~5 tests — add-to-sequence
- `test_clips.py`: 8 tests — set-properties, set-disabled, set-audio-mute
- `test_bin.py`: 7 tests — create, move-items

**Phase 3 total: ~29 tests**

### Phase 4 (Effects + Metadata)
- `test_effects.py`: 14 tests — add-video-filter, add-video-transition, get-clip-effects, get-effect-params, set-effect-param, get-effect-param-value
- `test_metadata.py`: 12 tests — get-project, set-project, get-xmp, set-xmp, add-property, get-panel

**Phase 4 total: 26 tests**

### Phase 5 (Export + SKILL.md)
- `test_export.py`: 8 tests — export sequence (300s timeout), export frame (120s timeout)
- `test_skill_doc.py`: 4 tests — SKILL.md exists, groups mentioned, --help responds, no get_sequence_frame_image

**Phase 5 total: 12 tests**

## Current Status (Post Phase 0)
- 128 tests collected
- 121 failing (assertion-based red-line failures)
- 7 passing (inherent Typer skeleton behavior)
- 0 import errors, 0 syntax errors

## Stub Files Updated During Phase 0
The following production files were updated from bare `pass` to minimal stubs (function signatures, class definitions, Typer app instances) to prevent import errors in tests:
- `pr_cli/config.py` — function signatures + `_DEFAULTS`, `_config_dir`, `_config_file`
- `pr_cli/output.py` — `success()`, `error()`, `parse_json_arg()`, `JsonFlag`
- `pr_cli/client.py` — `send()`, exception classes
- `pr_cli/main.py` — `app` Typer instance, version callback, config sub-app
- `pr_cli/commands/config.py` — `app`, `show()`, `check()`
