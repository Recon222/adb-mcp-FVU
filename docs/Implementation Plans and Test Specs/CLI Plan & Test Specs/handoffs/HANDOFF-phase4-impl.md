## HANDOFF: Phase 4 Implementation -> Phase 4 Review

### Context
Implemented Phase 4 effects and metadata commands: effects (add-video-filter, add-video-transition, get-clip-effects, get-effect-params, set-effect-param, get-effect-param-value) and metadata (get-project, set-project, get-xmp, set-xmp, add-property, get-panel). Registered both sub-apps in main.py. All 118 tests pass with zero failures across Phases 1-4, zero regressions. The 11 remaining failures are Phase 5 tests (export + SKILL.md) which are expected to fail.

### Test Coverage
Tests passing after this phase:
- `test_effects.py`: 14/14
- `test_metadata.py`: 12/12
- `test_clips.py`: 8/8
- `test_bin.py`: 7/7
- `test_sequence.py`: 15/15
- `test_media.py`: 8/8
- `test_project.py`: 10/10
- `test_config_cmds.py`: 9/9 (includes global tests)
- `test_config.py`: 11/11
- `test_client.py`: 11/11
- `test_output.py`: 11/11
- Phase 5 stubs (expected failures): 11

**Phase 4 specific new tests: 26/26 (all pass)**
- Effects: 14 tests (add-video-filter happy/properties/bad-json/proxy-down, add-video-transition defaults/custom-opts, get-clip-effects happy, get-effect-params happy, set-effect-param dict/numeric/string-fallback, get-effect-param-value happy/custom-time/command-failed)
- Metadata: 12 tests (get-project happy/proxy-down, set-project valid-json/bad-json, get-xmp happy, set-xmp valid-json/bad-json, add-property default-type/custom-type/command-failed, get-panel happy/premiere-disconnected)

**Full suite: 118 passed, 11 failed (Phase 5 stubs only)**

### Findings
Key decisions or discoveries:

1. **JSON parsing for effects**: `add-video-filter` uses `parse_json_arg(properties, expected_type="list")` from `output.py` for the `--properties` option. The parse happens before the try/except block so `typer.BadParameter` propagates naturally as exit code 2.

2. **Smart value parsing for set-effect-param**: Uses `_parse_value()` helper that tries `json.loads()` first (handles dicts, lists, numbers, booleans), falls back to raw string. This correctly parses `"75"` as `int(75)`, `'{"x": 960}'` as a dict, and `"plain text"` as a string.

3. **JSON parsing for metadata**: `set-project` and `set-xmp` use `parse_json_arg(fields_json, expected_type="dict")` for their JSON dict arguments. Same pattern as effects -- parse before try/except.

4. **No test bugs found**: All 26 Phase 4 tests passed on first run. No test modifications needed.

5. **Exception import pattern**: Continued using the direct-import pattern (`from pr_cli.client import ProxyNotAvailable, PremiereNotConnected, CommandFailed`) consistent with Phases 2-3.

6. **Action string verification**: All 12 action strings verified character-for-character against `pr-mcp.py`:
   - `appendVideoFilter`, `appendVideoTransition`, `getClipEffects`, `getEffectParameters`, `setEffectParameter`, `getEffectParameterValue`
   - `getProjectMetadata`, `setProjectMetadata`, `getXMPMetadata`, `setXMPMetadata`, `addMetadataProperty`, `getProjectPanelMetadata`

### Known Risks
- None. All commands follow the established tri-exception pattern exactly.

### Files Modified
- `pr_cli/commands/effects.py` -- Full implementation of 6 effects commands
- `pr_cli/commands/metadata.py` -- Full implementation of 6 metadata commands
- `pr_cli/main.py` -- Registered effects and metadata sub-apps

### Commit
`53092c0` feat(pr-cli): Phase 4 -- effects and metadata commands

### Open Questions
None. All Phase 4 requirements are satisfied.

---

## Phase 4 Review Findings

**Reviewer:** Claude Opus 4.6 (Phase 4 Reviewer)
**Verdict:** PASS -- 0 blocking issues

### Verified
- All 12 action strings match `pr-mcp.py` character-for-character.
- All camelCase option keys match MCP server expectations exactly.
- `parse_json_arg()` correctly used: `expected_type="list"` for `--properties`, `expected_type="dict"` for `fields_json` and `metadata_json`. Placed before try/except so `typer.BadParameter` exits with code 2.
- `_parse_value()` smart coercion: `json.loads()` first (dicts, lists, numbers, booleans), falls back to raw string. Correct behavior.
- Default values verified: `timeTicks=0`, `trackType="VIDEO"`, `propertyType="Text"`, `duration=1.0`, `clipAlignment=0.5`, `properties="[]"`.
- Error handling: tri-exception pattern (ProxyNotAvailable, PremiereNotConnected, CommandFailed) consistent across all 12 commands.
- `main.py` correctly registers both `effects` and `metadata` sub-apps with appropriate help text.
- 26/26 Phase 4 tests pass, 118/129 total (11 Phase 5 stubs expected).

### Non-blocking observations
1. **Missing `trackType` option on 3 effects commands**: `get-clip-effects`, `get-effect-params`, and `set-effect-param` do not expose a `--track-type` option, while the MCP server accepts `trackType` (defaulting to `"VIDEO"`). The UXP plugin likely defaults on its side as well, so this only affects audio-track effects. Low-priority enhancement for a future pass.
2. **`type` shadows builtin**: `metadata.add_property` uses `type` as a parameter name (line 112), shadowing the Python builtin. No practical impact since it is function-scoped and typer handles it, but renaming to `property_type` would be cleaner. Cosmetic only.
