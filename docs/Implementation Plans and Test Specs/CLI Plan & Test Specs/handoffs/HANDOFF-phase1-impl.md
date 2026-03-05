## HANDOFF: Phase 1 Implementation -> Phase 1 Review

### Context
Implemented all five Phase 1 foundation modules (config, client, output, main, config commands) replacing Phase 0 stubs with full production code. All 43 Phase 1 tests pass with zero failures.

### Test Coverage
Tests passing after this phase:
- `test_config.py`: 11/11
- `test_output.py`: 11/11
- `test_client.py`: 11/11
- `test_config_cmds.py`: 10/10

### Findings
Key decisions or discoveries:
1. **Config env var snapshotting**: The test helpers (`_reload_config`, `_reload_config_remove_env`) use `patch.dict(os.environ)` as a context manager that exits before the getter functions are called. This required the config module to snapshot env vars at module load time (`_snapshot_env()` captures into `_env_values` dict) rather than reading `os.environ` directly in getter functions. This is the critical design departure from the implementation plan's code sample, which reads env vars at call time.
2. **Test count is 43, not 42**: The test-completion doc states 42 tests for Phase 1, but actual count is 43 because `test_client.py` includes a bonus "exception hierarchy" test (test 11) beyond the 10 specified in the spec.
3. **No test bugs found**: All 43 tests are correct and pass as written. No test modifications were needed.

### Known Risks
- The `_env_values` snapshot approach means that if a future phase needs to change env vars at runtime (not just at module reload), the config module would need `_snapshot_env()` called again. This is fine for CLI usage (single-shot) but worth noting.
- `config check` uses a direct `socketio.Client` connection test, bypassing the transport layer. If the proxy protocol changes, this command might report false negatives while other commands still work.

### Files Modified
- `pr_cli/config.py` -- Full implementation with env var snapshotting and TOML config file loading
- `pr_cli/client.py` -- send() function with exception mapping, module-level socket_client.configure()
- `pr_cli/output.py` -- success/error output functions, parse_json_arg, JsonFlag type alias
- `pr_cli/main.py` -- Docstring update only (was already functional from Phase 0)
- `pr_cli/commands/config.py` -- config show and config check command implementations

### Open Questions
None. All Phase 1 requirements are satisfied.

## Review Findings (Phase 1)

### Blocking Issues
(none)

### Non-Blocking Issues

1. **config.py -- TOML key name inconsistency for timeout**: `get_timeout()` reads from `_file_values.get("default_timeout")` (line 79) while `get_proxy_url()` reads from `_file_values.get("proxy_url")` and `get_log_level()` reads from `_file_values.get("log_level")`. The `default_timeout` key name breaks the pattern -- a user writing a `config.toml` would naturally write `timeout = 30` and wonder why it is ignored. Consider changing to `_file_values.get("timeout")` for consistency, or documenting the expected TOML key names.

2. **output.py -- JSON indentation inconsistency**: `success()` in JSON mode uses `indent=2` (pretty-printed) while `error()` in JSON mode uses no indent (compact single-line). Machine parsers will handle both, but the inconsistency could surprise callers expecting uniform formatting. Consider adding `indent=2` to the `error()` JSON path as well.

3. **client.py -- no-op except clause**: Lines 73-75 (`except Exception: raise`) re-raise unconditionally. This is harmless and communicates intent (we only catch AppError and RuntimeError specifically), but it is dead code that could be removed without changing behavior.

4. **config.py -- empty-string env var behavior**: `get_proxy_url()` uses `or`-chaining which treats an empty string as falsy, falling through to the file/default level. `get_timeout()` uses `is not None` checking which would attempt `int("")` and hit the ValueError warning path. The two getters handle the empty-string edge case differently. For a CLI tool this is unlikely to matter in practice, but the inconsistency could bite if env vars are set to empty values in CI environments.

5. **client.py -- module-level side effect (configure call)**: `socket_client.configure()` runs at import time (line 40-44). This means any module that imports `client` -- even for type checking or exception class access -- triggers a socket configuration call. The tests work around this with patching. This is acceptable for a CLI tool but could become inconvenient if future phases need to import `ProxyNotAvailable` etc. without triggering socket setup. A lazy-init pattern (configure on first `send()` call) would be more flexible but is not required now.

6. **commands/config.py -- potential disconnect exception**: In `config check`, if `sio.connect()` partially succeeds then the `sio.disconnect()` call could theoretically raise. The bare `except Exception: pass` catches this, so no actual bug exists, but wrapping `sio.disconnect()` in its own try/except within the try block would be more explicit.

### Verdict
PASS
