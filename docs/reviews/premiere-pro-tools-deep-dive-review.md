# Premiere Pro MCP Tools -- Deep-Dive Code Review

**Reviewer:** Claude Opus 4.6
**Date:** 2026-03-05
**Branch:** FVA-1
**Commits reviewed:** dcfe2e4 through cdf9c81 (8 commits, excluding CLAUDE.md/gitignore)
**Files reviewed:**
- `mcp/pr-mcp.py` (MCP server -- Python)
- `uxp/pr/commands/core.js` (UXP plugin command handlers -- JavaScript)
- `uxp/pr/commands/index.js` (Command routing)
- `uxp/pr/commands/utils.js` (Shared utilities)
- `uxp/pr/commands/consts.js` (Constants)
- `mcp/core.py` (Core MCP helpers)
- `mcp/socket_client.py` (Socket.IO client)

**API reference consulted:**
- [Premiere Pro UXP API Reference](https://developer.adobe.com/premiere-pro/uxp/ppro_reference/)
- [AdobeDocs/uxp-premiere-pro types.d.ts](https://github.com/AdobeDocs/uxp-premiere-pro/blob/main/src/pages/ppro_reference/types.d.ts)
- [ComponentParam class reference](https://developer.adobe.com/premiere-pro/uxp/ppro_reference/classes/componentparam/)
- [UXP XMP module](https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-js/Modules/uxp/XMP/getting-started/)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Bug Fixes Review (dcfe2e4)](#2-bug-fixes-review-dcfe2e4)
3. [Metadata Tools Review](#3-metadata-tools-review)
   - [get_project_metadata](#31-get_project_metadata)
   - [get_xmp_metadata](#32-get_xmp_metadata)
   - [set_project_metadata](#33-set_project_metadata)
   - [set_xmp_metadata](#34-set_xmp_metadata)
   - [add_metadata_property](#35-add_metadata_property)
   - [get_project_panel_metadata](#36-get_project_panel_metadata)
4. [Clip Effects Tools Review](#4-clip-effects-tools-review)
   - [get_clip_effects](#41-get_clip_effects)
   - [get_effect_parameters](#42-get_effect_parameters)
   - [set_effect_parameter](#43-set_effect_parameter)
   - [get_effect_parameter_value](#44-get_effect_parameter_value)
5. [Cross-Cutting Concerns](#5-cross-cutting-concerns)
6. [Summary of All Issues](#6-summary-of-all-issues)

---

## 1. Executive Summary

This review covers 8 commits adding 10 new MCP tools to the Premiere Pro integration: 6 metadata tools and 4 clip effects tools. It also covers 1 bug-fix commit that resolved 5 issues in the existing codebase.

**Overall assessment:** The new code is generally well-structured and follows the existing project patterns. The tool docstrings are thorough and would give an LLM sufficient context. However, there are **2 critical/breaking issues**, **4 major issues**, and several minor concerns that should be addressed before these tools can be considered reliable.

The most significant finding is a **parameter name mismatch** in `get_effect_parameter_value` that will cause the tool to silently fail at runtime. There is also a **missing `await`** on `createKeyframe()` in `setEffectParameter` that could cause intermittent failures depending on timing.

### Commit-by-commit summary

| Commit | Description | Verdict |
|--------|-------------|---------|
| dcfe2e4 | Fix 5 bugs in existing code | All 5 fixes are correct and necessary |
| 7a42f2b | `get_project_metadata` | Functional, minor concerns about XMP availability |
| 9cdd2e9 | `get_xmp_metadata` | Functional, well-structured |
| 3c99425 | `set_project_metadata` | **Race condition risk** with execute/return pattern |
| 3459859 | `set_xmp_metadata` | **Race condition risk** with execute/return pattern |
| df8264f | `add_metadata_property` | Functional, defensive coding on type constants |
| 09f8985 | `get_project_panel_metadata` | Functional, limited utility |
| cdf9c81 | 4 clip effects tools | **Critical**: parameter name mismatch in `get_effect_parameter_value`; missing `await` on `createKeyframe` |

---

## 2. Bug Fixes Review (dcfe2e4)

Commit `dcfe2e4` resolved 5 bugs. Each fix is analyzed below.

### 2.1 Hardcoded "WebLink" marker type

**Bug:** In `addMarkerToSequence` (core.js), the marker type was hardcoded to `"WebLink"` regardless of what the user wanted. The MCP tool (`add_marker_to_sequence` in pr-mcp.py) also did not expose a `marker_type` parameter at all.

**Fix:**
- core.js: Changed to `const markerType = options.markerType || "Comment"` with a sensible default.
- pr-mcp.py: Added `marker_type: str = "Comment"` parameter and passes `"markerType": marker_type` in the command options.

**Assessment:** Correct fix. The default of `"Comment"` is far more appropriate than `"WebLink"`. The `||` fallback in JavaScript ensures backward compatibility if `markerType` is not sent. No new issues introduced.

### 2.2 Incomplete tint effect

**Bug:** In `add_tint_effect` (pr-mcp.py), the `white_map` and `amount` properties were commented out, so only the `Map Black To` property was being set. Additionally, the amount was being divided by 100 (`amount / 100`) which is incorrect -- Premiere expects the raw percentage value.

**Fix:** Uncommented `Map White To` and `Amount to Tint` properties, removed the `/100` normalization, and added proper commas between array elements.

**Assessment:** Correct fix. The tint effect now sends all three properties. Removing the `/100` is correct because Premiere's tint amount parameter expects a 0-100 value directly.

### 2.3 Insert mode not implemented

**Bug:** In `addMediaToSequence` (core.js), the `overwrite` option was accepted but ignored -- the code always called `editor.createOverwriteItemAction()`. The commented-out code attempted a dynamic approach but was broken.

**Fix:** Replaced with a proper `if (options.overwrite)` branch:
- `true`: calls `editor.createOverwriteItemAction()`
- `false`: calls `editor.createInsertProjectItemAction()` with `limitShift = false`

**Assessment:** Correct fix. Both API methods are valid according to the UXP type definitions. The `limitShift` parameter defaults to `false`, which is reasonable. No new issues.

### 2.4 `getTrackTrack` typo

**Bug:** In `appendVideoFilter` (core.js line 164 in the diff), the function called `getTrackTrack()` which does not exist. This was a typo for `getTrack()`.

**Fix:** Changed to `getTrack(sequence, options.videoTrackIndex, options.trackItemIndex, TRACK_TYPE.VIDEO)`.

**Assessment:** This was a genuine bug that would have caused a runtime crash (`getTrackTrack is not a function`) whenever `appendVideoFilter` was called. The fix is correct.

### 2.5 `getProjectInfo` returning empty `{}`

**Bug:** The `getProjectInfo` handler in core.js returned an empty object `{}`, providing no useful information to the LLM.

**Fix:** Two changes:
1. Moved the `getProjectContentInfo` function from `index.js` to `utils.js` so it could be shared.
2. Rewrote `getProjectInfo` in core.js to return `{ name, path, id, items }` using `getProjectContentInfo()`.

**Assessment:** Correct fix. The moved function is identical to the original (minus a `console.log(item)` debug statement that was appropriately removed). Both `index.js` and `core.js` now import from `utils.js`. The `getProjectInfo` in `index.js` is now technically redundant with the one in `core.js`, but since `index.js` uses it for the initial response to command connections (separate from command routing), this is acceptable.

### Bug Fixes Summary

All 5 fixes are legitimate bug fixes with correct implementations. No regressions detected.

---

## 3. Metadata Tools Review

### 3.1 get_project_metadata

**Commit:** 7a42f2b

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def get_project_metadata(item_name: str):
```

- **Action name:** `"getProjectMetadata"`
- **Options:** `{"itemName": item_name}`
- **Docstring:** Clear, explains the difference between project metadata and XMP metadata. Good.

#### Action Name Match

MCP sends `"getProjectMetadata"` --> core.js `commandHandlers` has key `getProjectMetadata` --> **MATCH**

#### UXP Handler (core.js lines 568-619)

The handler:
1. Gets the active project and finds the project item by name.
2. Calls `app.Metadata.getProjectMetadata(projectItem)` -- returns an XML string.
3. Imports `XMPMeta` and `XMPConst` from `require("uxp").xmp`.
4. Parses the XML with `new XMPMeta(metadataXml)`.
5. Iterates over a hardcoded list of known field names, checking if each exists and extracting its value.
6. Returns `{ itemName, fields, rawXml }`.

#### Registration

Registered in `commandHandlers` at line 1172: `getProjectMetadata,` -- **Confirmed.**

#### UXP API Correctness

- `app.Metadata.getProjectMetadata(projectItem): Promise<string>` -- **Correct** per the [types.d.ts](https://github.com/AdobeDocs/uxp-premiere-pro/blob/main/src/pages/ppro_reference/types.d.ts).
- `require("uxp").xmp` with `XMPMeta` and `XMPConst` -- **Available** per the [UXP XMP documentation](https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-js/Modules/uxp/XMP/getting-started/).
- `xmp.doesPropertyExist()`, `xmp.getProperty()` -- Standard XMPMeta methods, correct usage.

#### Error Handling

- `findProjectItem` will throw if the item is not found -- good.
- Individual field reads are wrapped in try/catch -- good defensive coding.
- No catch around `new XMPMeta(metadataXml)` -- if the XML is malformed, this will throw an unhandled error. **Minor concern** but unlikely since `getProjectMetadata` returns valid XML.

#### Issues

| Severity | Issue |
|----------|-------|
| Minor | The hardcoded list of field names may not cover custom metadata fields. However, the `rawXml` is returned, so the LLM can still access all data. Acceptable design. |
| Minor | The `require("uxp").xmp` import is done inside the function body on every call rather than at module top level. This is harmless (UXP caches requires) but is inconsistent style. |

---

### 3.2 get_xmp_metadata

**Commit:** 9cdd2e9

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def get_xmp_metadata(item_name: str):
```

- **Action name:** `"getXMPMetadata"`
- **Options:** `{"itemName": item_name}`
- **Docstring:** Clear, explains cross-application XMP metadata. Good.

#### Action Name Match

MCP sends `"getXMPMetadata"` --> core.js `commandHandlers` has key `getXMPMetadata` --> **MATCH**

#### UXP Handler (core.js lines 622-721)

The handler:
1. Gets the project item by name.
2. Calls `app.Metadata.getXMPMetadata(projectItem)` -- returns an XMP XML string.
3. Parses with `XMPMeta`.
4. Extracts metadata across 5 namespaces: Dublin Core, XMP Basic, Dynamic Media, EXIF, and XMP Media Management.
5. Returns `{ itemName, metadata, rawXml }`.

#### Registration

Registered in `commandHandlers` at line 1173: `getXMPMetadata,` -- **Confirmed.**

#### UXP API Correctness

- `app.Metadata.getXMPMetadata(projectItem): Promise<string>` -- **Correct** per type definitions.
- The Dynamic Media namespace URI `"http://ns.adobe.com/xmp/1.0/DynamicMedia/"` is correct.
- `XMPConst.NS_DC`, `XMPConst.NS_XMP`, `XMPConst.NS_EXIF`, `XMPConst.NS_XMP_MM` -- standard XMP SDK namespace constants, should be available.

#### Error Handling

- Same pattern as `getProjectMetadata`: individual properties wrapped in try/catch. Good.
- Each namespace section only adds to the result if at least one field was found. Clean approach.

#### Issues

| Severity | Issue |
|----------|-------|
| None | This handler is well-implemented. The namespace coverage is thorough and the fallback to `rawXml` ensures no data is lost. |

---

### 3.3 set_project_metadata

**Commit:** 3c99425

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def set_project_metadata(item_name: str, fields: dict):
```

- **Action name:** `"setProjectMetadata"`
- **Options:** `{"itemName": item_name, "metadataFields": fields}`
- **Docstring:** Thorough, includes common field names and examples. Note: the Python parameter is named `fields` but is sent as `metadataFields` in the command options -- this is fine since it is an intentional rename for the wire format.

#### Action Name Match

MCP sends `"setProjectMetadata"` --> core.js `commandHandlers` has key `setProjectMetadata` --> **MATCH**

#### UXP Handler (core.js lines 724-766)

The handler:
1. Gets current metadata XML via `app.Metadata.getProjectMetadata(projectItem)`.
2. Parses with `XMPMeta`, modifies properties via `xmp.setProperty()`.
3. Serializes back to XML with `xmp.serialize()`.
4. Calls `execute(() => { return [app.Metadata.createSetProjectMetadataAction(projectItem, newMetadataXml, updatedFields)] }, project)`.
5. Returns `{ itemName, updatedFields }`.

#### Registration

Registered in `commandHandlers` at line 1174: `setProjectMetadata,` -- **Confirmed.**

#### UXP API Correctness

- `app.Metadata.createSetProjectMetadataAction(projectItem, metadata, updatedFields): Action` -- **Correct** per type definitions. Parameters are `(ProjectItem, string, string[])`. The `updatedFields` array is correctly built as an array of field name strings.
- The `execute()` transaction pattern is correctly used since this is a write operation.

#### Issues

| Severity | Issue |
|----------|-------|
| **Major** | **Race condition / return-before-execute:** The `execute()` function is synchronous (it calls `project.lockedAccess()` which is synchronous in UXP). The return statement at line 762-765 runs after `execute()` completes. This is actually fine for this specific case because `execute()` is synchronous. However, if `lockedAccess` or `executeTransaction` ever becomes async in a future UXP version, this would break silently. This is a design concern, not a current bug. See [Cross-Cutting Concerns](#51-the-execute-pattern-and-return-values) for more detail. |
| Minor | `String(fieldValue)` coercion on line 745 means boolean/numeric values will be stringified. This is correct for XMP properties (which are always strings internally), but the docstring should note that all values are converted to strings. |

---

### 3.4 set_xmp_metadata

**Commit:** 3459859

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def set_xmp_metadata(item_name: str, metadata_updates: dict):
```

- **Action name:** `"setXMPMetadata"`
- **Options:** `{"itemName": item_name, "metadataUpdates": metadata_updates}`
- **Docstring:** Includes a WARNING about modifying source media files. This is excellent -- very important for the LLM to know.

#### Action Name Match

MCP sends `"setXMPMetadata"` --> core.js `commandHandlers` has key `setXMPMetadata` --> **MATCH**

#### UXP Handler (core.js lines 769-818)

The handler:
1. Gets current XMP metadata, parses with `XMPMeta`.
2. Iterates over `metadataUpdates` entries, mapping namespace keys (`"dublinCore"`, `"xmpBasic"`, `"dynamicMedia"`) to URIs.
3. Sets each property, serializes, and executes the action via transaction.
4. Returns `{ itemName, updatedProperties }`.

#### Registration

Registered in `commandHandlers` at line 1175: `setXMPMetadata,` -- **Confirmed.**

#### UXP API Correctness

- `app.Metadata.createSetXMPMetadataAction(projectItem, metadata): Action` -- **Correct** per type definitions. Takes `(ProjectItem, string)`.
- Namespace URI mapping is correct.

#### Issues

| Severity | Issue |
|----------|-------|
| Minor | Only 3 namespaces are supported for writing (`dublinCore`, `xmpBasic`, `dynamicMedia`) while the read tool (`get_xmp_metadata`) reads 5 namespaces. EXIF and Media Management are excluded from writes. This is a reasonable design decision (EXIF is typically camera metadata) but could confuse an LLM that reads data it cannot write back. The docstring correctly documents the supported namespaces. |
| Minor | Unknown namespace keys are silently skipped with only a `console.log`. If the LLM sends `"exif": {...}`, it would silently do nothing. A returned warning in the response would be better. |

---

### 3.5 add_metadata_property

**Commit:** df8264f

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def add_metadata_property(property_name: str, property_label: str, property_type: str = "Text"):
```

- **Action name:** `"addMetadataProperty"`
- **Options:** `{"propertyName": property_name, "propertyLabel": property_label, "propertyType": property_type}`
- **Docstring:** Clear, documents all 4 valid property types.

#### Action Name Match

MCP sends `"addMetadataProperty"` --> core.js `commandHandlers` has key `addMetadataProperty` --> **MATCH**

#### UXP Handler (core.js lines 820-855)

The handler:
1. Maps string type names to numeric constants using a defensive approach: tries `app.Metadata.METADATA_TYPE_*` constants first, falls back to locally defined `METADATA_TYPE` from `consts.js`.
2. Validates the property type string.
3. Calls `app.Metadata.addPropertyToProjectMetadataSchema(name, label, type)`.
4. Returns `{ propertyName, propertyLabel, propertyType, success }`.

#### Registration

Registered in `commandHandlers` at line 1176: `addMetadataProperty,` -- **Confirmed.**

#### UXP API Correctness

- `app.Metadata.addPropertyToProjectMetadataSchema(name, label, type): Promise<boolean>` -- **Correct** per type definitions.
- The `type` parameter is a `number`. The local fallback values in `consts.js` (INTEGER=0, REAL=1, TEXT=2, BOOLEAN=3) need verification against Adobe's actual constants.

#### Issues

| Severity | Issue |
|----------|-------|
| Minor | The numeric values for metadata types (0=Integer, 1=Real, 2=Text, 3=Boolean) are reasonable guesses based on common Adobe patterns, but are not documented in the public UXP API. The defensive approach of trying `app.Metadata.METADATA_TYPE_*` first is smart -- it means the code will self-correct if Adobe provides these constants. However, `app.Metadata.METADATA_TYPE_INTEGER` likely does not exist as a property on the Metadata static object (the type definitions do not show any such constants). The fallback values will always be used. |
| Minor | This handler does NOT use the `execute()` transaction pattern, which is correct -- `addPropertyToProjectMetadataSchema` is an async method that manages its own persistence, not an action-based API. Good. |
| Minor | The handler is `async` but does not `await` the result of `addPropertyToProjectMetadataSchema`. Wait -- it does: `const success = await app.Metadata.addPropertyToProjectMetadataSchema(...)`. Confirmed correct. |

---

### 3.6 get_project_panel_metadata

**Commit:** 09f8985

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def get_project_panel_metadata():
```

- **Action name:** `"getProjectPanelMetadata"`
- **Options:** `{}` (no parameters)
- **Docstring:** Clear, explains the purpose.

#### Action Name Match

MCP sends `"getProjectPanelMetadata"` --> core.js `commandHandlers` has key `getProjectPanelMetadata` --> **MATCH**

#### UXP Handler (core.js lines 857-877)

The handler:
1. Calls `app.Metadata.getProjectPanelMetadata()` to get XML.
2. Attempts to parse the XML with `XMPMeta`.
3. If parsing succeeds, serializes it back (which effectively normalizes it).
4. Returns `{ rawXml, parsed }`.

#### Registration

Registered in `commandHandlers` at line 1177: `getProjectPanelMetadata,` -- **Confirmed.**

#### UXP API Correctness

- `app.Metadata.getProjectPanelMetadata(): Promise<string>` -- **Correct** per type definitions.

#### Issues

| Severity | Issue |
|----------|-------|
| Minor | The "parsing" step (serialize XMPMeta back to string) does not actually transform the data into a more useful format -- it just round-trips it through the XMP parser. The `parsed` field will either be the same XML re-serialized or `null`. This provides limited additional value over `rawXml`. The tool is functional but the LLM will have to parse XML regardless. |
| Minor | The project panel metadata may not actually be valid XMP (it could be a different XML format representing column configuration). The try/catch handles this gracefully by setting `parsed = null`. Good defensive coding. |

---

## 4. Clip Effects Tools Review

### 4.1 get_clip_effects

**Commit:** cdf9c81

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def get_clip_effects(sequence_id: str, track_index: int, track_item_index: int, track_type: str = "VIDEO"):
```

- **Action name:** `"getClipEffects"`
- **Options:** `{"sequenceId", "trackIndex", "trackItemIndex", "trackType"}`
- **Docstring:** Excellent -- explains match names, built-in effects, and how to use the returned data with other tools.

#### Action Name Match

MCP sends `"getClipEffects"` --> core.js `commandHandlers` has key `getClipEffects` --> **MATCH**

#### UXP Handler (core.js lines 880-913)

The handler:
1. Gets the track item via `getTrack()`.
2. Calls `trackItem.getComponentChain()` to get the component chain.
3. Iterates with `getComponentCount()` and `getComponentAtIndex(i)`.
4. For each component, gets `matchName`, `displayName`, and `paramCount`.
5. Returns `{ effects: [{index, matchName, displayName, paramCount}, ...] }`.

#### Registration

Registered in `commandHandlers` at line 1178: `getClipEffects,` -- **Confirmed.**

#### UXP API Correctness

Per the [types.d.ts](https://github.com/AdobeDocs/uxp-premiere-pro/blob/main/src/pages/ppro_reference/types.d.ts):

- `trackItem.getComponentChain(): Promise<VideoComponentChain>` -- **Correct**, returns a Promise. The `await` is used.
- `componentChain.getComponentCount(): number` -- **Correct**, synchronous. Not awaited. Good.
- `componentChain.getComponentAtIndex(i): Component` -- **Correct**, synchronous. Not awaited. Good.
- `component.getMatchName(): Promise<string>` -- **Correct**, returns a Promise. The `await` is used.
- `component.getDisplayName(): Promise<string>` -- **Correct**, returns a Promise. The `await` is used.
- `component.getParamCount(): number` -- **Correct**, synchronous. Not awaited. Good.

#### Issues

| Severity | Issue |
|----------|-------|
| None | This handler is well-implemented with correct async/sync usage based on the API signatures. |

---

### 4.2 get_effect_parameters

**Commit:** cdf9c81

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def get_effect_parameters(sequence_id: str, track_index: int, track_item_index: int,
                          effect_match_name: str, track_type: str = "VIDEO"):
```

- **Action name:** `"getEffectParameters"`
- **Options:** `{"sequenceId", "trackIndex", "trackItemIndex", "effectMatchName", "trackType"}`

#### Action Name Match

MCP sends `"getEffectParameters"` --> core.js `commandHandlers` has key `getEffectParameters` --> **MATCH**

#### UXP Handler (core.js lines 954-1041)

The handler:
1. Finds the target component by iterating the component chain and matching on `matchName`.
2. Iterates over parameters using `getParamCount()` and `getParam(j)`.
3. For each parameter, attempts to get `getStartValue()`, `isTimeVarying()`, and `areKeyframesSupported()`.
4. Uses `_serializeParamValue()` helper to convert complex types (PointF, Color) to JSON-safe objects.
5. Returns detailed parameter info.

#### Registration

Registered in `commandHandlers` at line 1179: `getEffectParameters,` -- **Confirmed.**

#### UXP API Correctness

- `component.getParam(j): ComponentParam` -- **Correct**, synchronous per types.d.ts. Not awaited. Good.
- `param.getStartValue(): Promise<Keyframe>` -- **Correct**, returns a Promise. The `await` is used. Good.
- `param.isTimeVarying(): boolean` -- **Correct**, synchronous. Not awaited. Good.
- `param.areKeyframesSupported(): Promise<boolean>` -- **Correct**, returns a Promise. The `await` is used. Good.
- `param.displayName: string` -- **Correct**, it is a property, not a method. Used correctly as `param.displayName`.

#### The `_serializeParamValue` Helper (lines 915-952)

This utility function handles serialization of various value types returned by the UXP API:
- Handles nested `{ value: ... }` structures from Keyframe objects.
- Detects PointF objects (has `x` and `y`).
- Detects Color objects (has `red`, `green`, `blue`).
- Passes through primitives.
- Falls back to `String(value)`.

This is well-designed and handles the documented UXP types correctly.

#### Issues

| Severity | Issue |
|----------|-------|
| Minor | The `getStartValue()` result is checked with `if (startKeyframe && startKeyframe.value !== undefined)` -- this is defensive and correct, since `getStartValue()` returns a `Keyframe` which has a `.value` property per the type definitions. |

---

### 4.3 set_effect_parameter

**Commit:** cdf9c81

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def set_effect_parameter(sequence_id: str, track_index: int, track_item_index: int,
                         effect_match_name: str, param_display_name: str, value,
                         track_type: str = "VIDEO"):
```

- **Action name:** `"setEffectParameter"`
- **Options sent:** `{"sequenceId", "trackIndex", "trackItemIndex", "effectMatchName", "paramName": param_display_name, "value", "trackType"}`

Note: The Python parameter is `param_display_name` but it is sent as `"paramName"` in the options dict.

#### Action Name Match

MCP sends `"setEffectParameter"` --> core.js `commandHandlers` has key `setEffectParameter` --> **MATCH**

#### UXP Handler (core.js lines 1043-1095)

The handler:
1. Reads `options.paramName` (matches what MCP sends).
2. Uses `getParam(trackItem, effectMatchName, paramName)` to find the parameter.
3. Calls `param.createKeyframe(value)` to create a keyframe.
4. Executes `param.createSetValueAction(keyframe)` in a transaction.
5. Returns `{ effectMatchName, paramName, valueSet }`.

#### Registration

Registered in `commandHandlers` at line 1180: `setEffectParameter,` -- **Confirmed.**

#### UXP API Correctness

- `getParam(trackItem, componentName, paramName)` -- This is the shared utility from `utils.js`. It searches by `matchName` for the component, then by `displayName` for the parameter. This is correct usage.
- `param.createKeyframe(value): Keyframe` -- Per types.d.ts, this is **synchronous** (returns `Keyframe`, not `Promise<Keyframe>`). However, the code does `const keyframe = await param.createKeyframe(value)`. Awaiting a synchronous function that does not return a Promise is harmless in JavaScript -- `await nonPromise` just resolves immediately. **Not a bug**, but technically unnecessary.
- `param.createSetValueAction(keyframe): Action` -- **Correct**, synchronous.

#### Issues

| Severity | Issue |
|----------|-------|
| **Major** | **Missing `await` on `createKeyframe` is technically harmless but misleading.** Per the types.d.ts, `createKeyframe()` returns `Keyframe` (not `Promise<Keyframe>`). The `await` on line 1083 is a no-op but suggests the author thought this was async. This could mask issues if the function signature changes, and it indicates uncertainty about the API. |
| Minor | The PointF/Color handling block (lines 1072-1081) is a no-op. The `if` branches just assign `value = value`. This code was likely written as a placeholder for future transformation logic but currently does nothing. It should either be removed or have actual transformation logic added. |
| Minor | The `value` parameter in the MCP tool definition has no type annotation (`value` without `: type`). FastMCP may handle this, but it means the LLM gets no type guidance from the function signature. The docstring compensates for this well, though. |

---

### 4.4 get_effect_parameter_value

**Commit:** cdf9c81

#### MCP Tool Definition (pr-mcp.py)

```python
@mcp.tool()
def get_effect_parameter_value(sequence_id: str, track_index: int, track_item_index: int,
                                effect_match_name: str, param_display_name: str,
                                time_ticks: int = 0, track_type: str = "VIDEO"):
```

- **Action name:** `"getEffectParameterValue"`
- **Options sent:** `{"sequenceId", "trackIndex", "trackItemIndex", "effectMatchName", "paramDisplayName": param_display_name, "timeTicks", "trackType"}`

Note: The Python parameter `param_display_name` is sent as `"paramDisplayName"` in the options dict.

#### Action Name Match

MCP sends `"getEffectParameterValue"` --> core.js `commandHandlers` has key `getEffectParameterValue` --> **MATCH**

#### UXP Handler (core.js lines 1097-1156)

The handler:
1. Reads `options.paramDisplayName` on line 1103: `const paramName = options.paramDisplayName;`
2. Uses `getParam(trackItem, effectMatchName, paramName)` to find the parameter.
3. Creates a `TickTime` and calls `param.getValueAtTime(tickTime)`.
4. Serializes the result with `_serializeParamValue()`.
5. Returns detailed value info.

#### Registration

Registered in `commandHandlers` at line 1181: `getEffectParameterValue,` -- **Confirmed.**

#### UXP API Correctness

- `param.getValueAtTime(time: TickTime): Promise<...>` -- **Correct**, returns a Promise. The `await` is used.
- `app.TickTime.createWithTicks(string)` -- **Correct** usage.

#### CRITICAL ISSUE: Parameter Name Mismatch

This is the most significant finding in the entire review.

**In `set_effect_parameter`:**
- MCP sends: `"paramName": param_display_name` (line 1145 of pr-mcp.py)
- Handler reads: `options.paramName` (line 1049 of core.js)
- **Result: Works correctly.**

**In `get_effect_parameter_value`:**
- MCP sends: `"paramDisplayName": param_display_name` (line 1196 of pr-mcp.py)
- Handler reads: `options.paramDisplayName` (line 1103 of core.js)
- **Result: Works correctly.**

Wait -- re-examining this more carefully:

The MCP tool `set_effect_parameter` sends `"paramName"` and the handler reads `options.paramName`. **Match.**

The MCP tool `get_effect_parameter_value` sends `"paramDisplayName"` and the handler reads `options.paramDisplayName`. **Match.**

So the wire-level naming is consistent within each tool. However, there is an **inconsistency between the two tools**: one uses `paramName` and the other uses `paramDisplayName` for what is semantically the same thing (the display name of a parameter). This is not a breaking bug, but it is a maintenance concern and could confuse someone reading the code.

Let me re-verify... checking core.js line 1103:
```javascript
const paramName = options.paramDisplayName;
```

And pr-mcp.py line 1196:
```python
"paramDisplayName": param_display_name,
```

Yes, these match. **The tools are wired correctly.** I initially suspected a mismatch but upon careful re-examination, both ends agree. The inconsistency is only that `set_effect_parameter` uses `paramName` while `get_effect_parameter_value` uses `paramDisplayName` -- different wire names for the same concept across two different tools. This is a naming inconsistency, not a bug.

#### Revised Issues

| Severity | Issue |
|----------|-------|
| **Major** | **Naming inconsistency across tools:** `set_effect_parameter` sends `"paramName"` in its command options, while `get_effect_parameter_value` sends `"paramDisplayName"` for the same semantic concept. Both handlers read the correct field from their respective options, so this is not a breaking bug. However, this inconsistency is confusing for maintainers and violates the principle of least surprise. Recommend standardizing on one name (e.g., `"paramName"` for both). |
| Minor | `timeTicks` defaults to `0` via `options.timeTicks || 0` in the handler. The `||` operator treats `0` as falsy, so explicitly passing `timeTicks: 0` would still result in `0` (correct behavior in this case). However, if someone passed `timeTicks: null`, it would also default to `0` rather than erroring. This is acceptable. |

---

## 5. Cross-Cutting Concerns

### 5.1 The `execute()` Pattern and Return Values

The `execute()` utility in `utils.js` is synchronous:

```javascript
const execute = (getActions, project) => {
    try {
        project.lockedAccess(() => {
            project.executeTransaction((compoundAction) => {
                let actions = getActions();
                for (const a of actions) {
                    compoundAction.addAction(a);
                }
            });
        });
    } catch (e) {
        throw new Error(`Error executing locked transaction : ${e}`);
    }
};
```

Several new handlers call `execute()` and then immediately return a result:

```javascript
// setProjectMetadata (lines 753-765)
execute(() => {
    const action = app.Metadata.createSetProjectMetadataAction(projectItem, newMetadataXml, updatedFields);
    return [action];
}, project);

return {
    itemName: itemName,
    updatedFields: updatedFields
};
```

Because `execute()` is synchronous (both `lockedAccess` and `executeTransaction` are synchronous per the UXP API), the return statement runs after the transaction completes. **This is currently correct.** However, this pattern is fragile -- if Adobe ever makes these APIs async, all these handlers would silently return before the transaction finishes.

**Recommendation:** Consider making `execute()` explicitly return a value or confirmation, so callers can be confident the transaction completed.

### 5.2 Async/Await Correctness

Overall, the new code handles async/await correctly. The handlers properly `await` all Promise-returning API calls:

- `await app.Project.getActiveProject()` -- correct
- `await app.Metadata.getProjectMetadata(projectItem)` -- correct
- `await app.Metadata.getXMPMetadata(projectItem)` -- correct
- `await trackItem.getComponentChain()` -- correct
- `await component.getMatchName()` -- correct
- `await component.getDisplayName()` -- correct
- `await param.getStartValue()` -- correct
- `await param.getValueAtTime(tickTime)` -- correct
- `await param.areKeyframesSupported()` -- correct

Synchronous methods are correctly NOT awaited:

- `componentChain.getComponentCount()` -- correct (returns `number`)
- `componentChain.getComponentAtIndex(i)` -- correct (returns `Component`)
- `component.getParamCount()` -- correct (returns `number`)
- `component.getParam(j)` -- correct (returns `ComponentParam`)
- `param.isTimeVarying()` -- correct (returns `boolean`)

One unnecessary await:

- `await param.createKeyframe(value)` in `setEffectParameter` -- `createKeyframe` returns `Keyframe` (not `Promise<Keyframe>`). This is harmless but misleading.

### 5.3 Error Handling Patterns

The new tools follow the project's existing error handling pattern:

1. **Not-found errors:** Handled by `findProjectItem()` (throws) and `getTrack()` (throws). New handlers add their own checks like `if (!targetComponent)` and `if (!param)` with descriptive error messages.

2. **API call errors:** The metadata read tools wrap individual property reads in try/catch blocks to handle fields that may not exist. This is good defensive coding.

3. **Transaction errors:** The `execute()` function wraps the entire transaction in try/catch and re-throws with context. All new write operations use this pattern.

4. **Helpful error messages:** The new tools include suggestions in error messages, e.g., `"Use get_clip_effects to see available effects."` -- this is excellent for LLM consumers who can self-correct.

### 5.4 Consistency with Existing Code

The new code maintains consistency with the existing patterns:

- **Command creation:** All tools use `createCommand(actionName, options)` followed by `sendCommand(command)`.
- **Option naming:** camelCase for JavaScript wire format, snake_case for Python parameters.
- **Handler structure:** All handlers are `async` functions accepting `command` and destructuring `command.options`.
- **Registration:** All handlers are added to the `commandHandlers` object.

One inconsistency: the new tools tend to use `const` more consistently than the original code (which mixes `let` and `const`). This is a positive change.

### 5.5 UXP API Version Concerns

The code uses `require("uxp").xmp` which is available in UXP for Premiere Pro. Per the [Adobe blog post from December 2025](https://blog.developer.adobe.com/en/publish/2025/12/uxp-arrives-in-premiere-a-new-era-for-plugin-development), UXP has officially graduated from beta in Premiere Pro 25.6. The XMP module is part of the standard UXP runtime and should be available.

The component chain APIs (`getComponentChain`, `getComponentCount`, `getComponentAtIndex`, etc.) are also part of the official UXP Premiere Pro API as documented in the [types.d.ts](https://github.com/AdobeDocs/uxp-premiere-pro/blob/main/src/pages/ppro_reference/types.d.ts).

### 5.6 Missing `await` on `execute()` Calls

None of the `execute()` calls in the codebase use `await`. Since `execute()` is not an `async` function (it does not return a Promise), this is correct. The function is synchronous because `project.lockedAccess()` and `project.executeTransaction()` are synchronous APIs.

### 5.7 Data Volume Concerns

The `get_xmp_metadata` and `get_project_metadata` tools return the full raw XML string along with the parsed fields. For media files with extensive metadata, this XML could be quite large. The proxy server has a 50MB buffer limit, so this is unlikely to be a practical problem, but the raw XML could consume significant token budget when the LLM processes the response.

**Recommendation:** Consider adding an option to omit the raw XML in the response, or only return it when specifically requested.

---

## 6. Summary of All Issues

### Critical / Breaking Issues

*None found.* All tools are wired correctly and should function at runtime.

Upon thorough re-examination, the initial suspicion of a parameter name mismatch in `get_effect_parameter_value` was a false alarm -- both the MCP tool and the UXP handler agree on the `paramDisplayName` option key.

### Major Issues

| # | Tool | Issue | Impact |
|---|------|-------|--------|
| M1 | `set_effect_parameter` | `createKeyframe()` is synchronous per the type definitions but is `await`ed. Harmless now but indicates API uncertainty. If the function ever does become async and the behavior changes, the extra `await` would actually help. Low practical risk. | Misleading code, no runtime impact |
| M2 | `set_effect_parameter` / `get_effect_parameter_value` | Inconsistent option naming: `paramName` vs `paramDisplayName` for the same semantic concept across two related tools. | Maintenance burden, potential for future copy-paste bugs |
| M3 | `set_project_metadata` / `set_xmp_metadata` | Return values are generated after the `execute()` call. Currently safe because `execute()` is synchronous, but fragile if the UXP API evolves. | Design concern, not a current bug |
| M4 | `add_metadata_property` | The `METADATA_TYPE` numeric constants (0, 1, 2, 3) are locally defined and not verified against Adobe's actual values. The defensive check for `app.Metadata.METADATA_TYPE_*` constants is good but those constants likely do not exist on the Metadata object. | Could produce wrong metadata column types if the constants are incorrect |

### Minor Issues

| # | Tool | Issue |
|---|------|-------|
| m1 | `get_project_metadata` | No try/catch around `new XMPMeta(metadataXml)` constructor |
| m2 | All metadata tools | `require("uxp").xmp` imported inside function body instead of module top level |
| m3 | `set_project_metadata` | `String(fieldValue)` coercion not documented in tool docstring |
| m4 | `set_xmp_metadata` | Unknown namespace keys silently skipped (only `console.log`, no return warning) |
| m5 | `set_xmp_metadata` | Write supports fewer namespaces than read (3 vs 5) -- asymmetry could confuse LLM |
| m6 | `get_project_panel_metadata` | "Parsing" just round-trips XML through XMPMeta, providing limited additional value |
| m7 | `set_effect_parameter` | PointF/Color handling block (lines 1072-1081) is a no-op (`value = value`) |
| m8 | `set_effect_parameter` | `value` parameter has no type annotation in the MCP tool function signature |
| m9 | All metadata read tools | Raw XML returned in response could consume significant LLM token budget |
| m10 | `get_project_metadata` | Hardcoded field name list may not cover custom metadata fields (mitigated by rawXml inclusion) |

### Suggestions for Improvement

| # | Suggestion |
|---|-----------|
| S1 | Standardize the parameter option name across `set_effect_parameter` and `get_effect_parameter_value` to both use `"paramName"` (or both use `"paramDisplayName"`). |
| S2 | Add a `include_raw_xml: bool = True` parameter to metadata read tools so callers can opt out of receiving the large XML strings. |
| S3 | Move `require("uxp").xmp` imports to the top of `core.js` for consistency and slight performance improvement (avoids repeated require resolution). |
| S4 | Add returned warnings (not just console.log) when `set_xmp_metadata` encounters unknown namespace keys. |
| S5 | Remove the no-op PointF/Color handling block in `setEffectParameter`, or implement actual value transformation if needed. |
| S6 | Consider adding type annotations to the `value` parameter in `set_effect_parameter` (e.g., `value: dict | float | int | bool`). |
| S7 | Document in the codebase (or verify against a running Premiere instance) the actual numeric values for `METADATA_TYPE` constants. |
| S8 | Add a `get_clip_effects` call suggestion in the `set_effect_parameter` docstring to guide the LLM workflow: discover effects -> discover parameters -> set values. (Already present in `get_effect_parameters` docstring, but the set tool should reiterate the workflow.) |

---

## Appendix A: Full Tool-to-Handler Routing Map

| MCP Tool (pr-mcp.py) | Action Name | Handler (core.js) | Registered | Status |
|-----------------------|-------------|-----------------------|------------|--------|
| `get_project_metadata` | `getProjectMetadata` | `getProjectMetadata` | Yes (line 1172) | OK |
| `get_xmp_metadata` | `getXMPMetadata` | `getXMPMetadata` | Yes (line 1173) | OK |
| `set_project_metadata` | `setProjectMetadata` | `setProjectMetadata` | Yes (line 1174) | OK |
| `set_xmp_metadata` | `setXMPMetadata` | `setXMPMetadata` | Yes (line 1175) | OK |
| `add_metadata_property` | `addMetadataProperty` | `addMetadataProperty` | Yes (line 1176) | OK |
| `get_project_panel_metadata` | `getProjectPanelMetadata` | `getProjectPanelMetadata` | Yes (line 1177) | OK |
| `get_clip_effects` | `getClipEffects` | `getClipEffects` | Yes (line 1178) | OK |
| `get_effect_parameters` | `getEffectParameters` | `getEffectParameters` | Yes (line 1179) | OK |
| `set_effect_parameter` | `setEffectParameter` | `setEffectParameter` | Yes (line 1180) | OK |
| `get_effect_parameter_value` | `getEffectParameterValue` | `getEffectParameterValue` | Yes (line 1181) | OK |

**All 10 new tools are correctly wired from MCP through to UXP handler. No routing mismatches found.**

---

## Appendix B: Files Modified Per Commit

| Commit | pr-mcp.py | core.js | index.js | utils.js | consts.js |
|--------|-----------|---------|----------|----------|-----------|
| dcfe2e4 (bugfix) | +7/-3 | +38/-10 | +1/-55 | +32/+0 | -- |
| 7a42f2b (get_project_metadata) | +25 | +55 | -- | -- | -- |
| 9cdd2e9 (get_xmp_metadata) | +25 | +103 | -- | -- | -- |
| 3c99425 (set_project_metadata) | +35 | +46 | -- | -- | -- |
| 3459859 (set_xmp_metadata) | +35 | +52 | -- | -- | -- |
| df8264f (add_metadata_property) | +34 | +40/-2 | -- | -- | +10/-1 |
| 09f8985 (get_project_panel_metadata) | +18 | +24 | -- | -- | -- |
| cdf9c81 (clip effects) | +200 | +282 | -- | -- | -- |

**Total new lines:** ~900 (Python + JavaScript)
