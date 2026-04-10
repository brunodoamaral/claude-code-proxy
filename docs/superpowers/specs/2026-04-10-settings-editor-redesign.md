# Settings Editor Redesign — Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Overview

Replace the current complex Settings tab (two-panel layout with history, tags, revision preview, mismatch detection) with a single full-width JSON editor. Modern, clean, syntax-highlighted, with inline error detection.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Full-width single editor | Maximum space for JSON content |
| History UI | Removed entirely | Simplicity — backend still records history silently |
| Mismatch detection UI | Removed | Editor always loads from disk; no DB comparison surfaced |
| Backups | Silent auto-backups on save (backend unchanged) | Safety net without UI clutter |
| Syntax highlighting | Custom textarea + pre overlay | Zero dependencies, matches dashboard's single-file philosophy |
| Color scheme | Catppuccin (match existing dashboard theme) | Visual consistency |
| Validation | Inline on every keystroke (debounced 150ms) | Immediate feedback, easy to detect issues |
| Error display | Red line highlight in gutter + error bar below editor | Clear, non-intrusive |
| Save | Button + Ctrl+S shortcut | Standard UX |
| Dirty state | Yellow "Unsaved changes" indicator + beforeunload warning | Prevent accidental data loss |

## Editor Architecture

### Visual Structure

```
┌─────────────────────────────────────┐
│ ~/.claude/settings.json    ● Saved  │  ← header bar
├────┬────────────────────────────────┤
│ 1  │ {                              │  ← gutter + overlay editor
│ 2  │   "effortLevel": "high",       │
│ 3  │   "env": {                     │
│ …  │   …                            │
├────┴────────────────────────────────┤
│ ⚠ Line 4: Expected comma           │  ← error bar (only when invalid)
├─────────────────────────────────────┤
│ [Save]  Ctrl+S     Last saved 2m…   │  ← footer
└─────────────────────────────────────┘
```

### Overlay Technique

A `<textarea>` with transparent text sits on top of a `<pre>` that renders syntax-highlighted content. Both share identical font, size, padding, and scroll position. The textarea handles all input; the pre handles all rendering.

- **textarea**: `color: transparent; caret-color: var(--text-0);` — invisible text, visible cursor
- **pre**: positioned behind textarea, receives highlighted HTML on every input
- **gutter**: separate div with line numbers, scroll-synced with editor

### Components

1. **Header bar** — file path (`~/.claude/settings.json`), status indicator
   - `● Saved` (green) when content matches last save
   - `● Unsaved changes` (yellow) when dirty

2. **Gutter** — line numbers, right-aligned, scroll-synced
   - Normal: `--text-2` color
   - Error line: `--red` color, bold

3. **Editor surface** — textarea (input layer) + pre (render layer)
   - Scroll-synced via `textarea.onscroll` → mirror scrollTop/scrollLeft on pre and gutter

4. **Error bar** — only visible when JSON is invalid
   - Left red border accent, red-tinted background
   - Shows: `⚠ Line N: <error message>`
   - When valid: hidden entirely

5. **Footer** — save button, shortcut hint, last-saved timestamp
   - Save button: cyan (`--cyan`) when enabled, muted when JSON is invalid
   - Last saved: relative time ("2 minutes ago"), updates on interval

## Syntax Highlighting

Regex-based JSON tokenizer. Runs on every input event to re-render the `<pre>` content.

| Token | Color | CSS Variable |
|-------|-------|-------------|
| Keys (`"effortLevel"`) | Blue | `--blue` (#89b4fa) |
| String values (`"high"`) | Green | `--green` (#a6e3a1) |
| Numbers (`256`, `8192`) | Peach | `--peach` (#fab387) |
| Booleans (`true`, `false`) | Red | `--red` (#f38ba8) |
| Null (`null`) | Mauve | `--mauve` (#cba6f7) |
| Brackets/braces (`{}`, `[]`) | Mauve | `--mauve` (#cba6f7) |
| Colons, commas | Muted | `--text-2` (#6c7086) |

Key vs string differentiation: a quoted string preceded by a newline/whitespace and followed by `:` is a key; all other quoted strings are values.

## Error Detection

On every `input` event (debounced 150ms):

1. `JSON.parse(textarea.value)` in try/catch
2. If error: extract line number from error message, highlight gutter line red, show error bar
3. If valid: hide error bar, reset gutter colors
4. Error line: gutter number turns `--red` + bold; that line in the pre gets a subtle red background tint (`rgba(243,139,168,0.1)`)

Save button is **disabled** (muted, `cursor: not-allowed`) when JSON is invalid. Ctrl+S is a no-op when invalid.

## Data Flow

### Load (on tab activation)

1. `GET /api/settings/current`
2. Extract `data.claude_settings.raw_json`
3. `JSON.stringify(raw_json, null, 2)` → set textarea value
4. Render highlighted pre
5. Set `lastSavedContent = textarea.value`
6. Set `lastSavedAt = Date.now()`
7. Show `● Saved`

### Save (button click or Ctrl+S)

1. Validate: `JSON.parse(textarea.value)` — if invalid, shake error bar, abort
2. Set button to loading state
3. `POST /api/settings/apply` with body: `{ "settings": <parsed JSON> }`
4. On success:
   - `lastSavedContent = textarea.value`
   - `lastSavedAt = Date.now()`
   - Show `● Saved` (green)
   - Flash success briefly in footer
5. On error:
   - Show error message in footer for 5 seconds
   - Keep `● Unsaved changes`

### Dirty Detection

- On every input: compare `textarea.value !== lastSavedContent`
- If dirty: header shows `● Unsaved changes` (yellow), register `beforeunload` handler
- If clean: header shows `● Saved` (green), remove `beforeunload` handler

## What Gets Removed

### HTML (~40 lines deleted)

- `settings-history-panel` — entire left column
- `settings-history-search` input
- `settings-history-clear-all-btn`
- `settings-history-list`
- `settings-mismatch-callout` + keep-disk/keep-db buttons
- `settings-history-preview-json` + load-into-editor button
- `settings-quick-tags-input` + hint
- `grid grid-2` wrapper on the settings tab

### JS State Variables (~10 deleted)

- `settingsHistorySearchQuery`, `settingsHistoryRequestToken`
- `selectedSettingsHistoryId`, `selectedSettingsPreviewId`
- `settingsHistoryById` (Map)
- `settingsMismatchActive`, `settingsDiskLoadedSnapshot`, `settingsDbSnapshotCandidate`
- `settingsApplyInFlight`, `settingsMismatchActionTaken`

### JS Functions (~200 lines deleted)

- `renderSettingsHistory()`, `loadSettingsHistory()`
- `clearAllSettingsHistory()`
- `renderSettingsMismatchCallout()`
- History row render/select/preview/delete handlers
- Tag patch handlers
- Keep-disk/keep-db-snapshot handlers

### What Gets Added (~200 lines)

- New editor HTML structure
- `highlightJSON(text)` — tokenizer, returns highlighted HTML
- `syncEditorScroll()` — keeps textarea/pre/gutter aligned
- `validateJSON()` — debounced error detection
- `saveSettings()` — save handler (button + Ctrl+S)
- `renderEditorStatus()` — dirty/saved/error state management
- CSS for editor components (~40 lines)

## Dashboard Tests

### Tests to Remove (assert removed HTML elements)

- `dashboard_html_settings_mismatch_callout_has_keep_actions`
- `dashboard_html_settings_mismatch_tracks_disk_and_db_snapshots`
- `dashboard_html_settings_keep_disk_reuses_apply_helper`
- `dashboard_html_settings_keep_db_snapshot_is_editor_only`
- `dashboard_html_settings_keep_disk_applies_immediately`
- `dashboard_html_settings_mismatch_actions_are_wired`

### Tests to Add (assert new editor elements)

- `dashboard_html_settings_editor_has_overlay_structure` — asserts header bar, gutter, textarea, pre, footer exist
- `dashboard_html_settings_editor_has_syntax_highlighter` — asserts `highlightJSON` function exists
- `dashboard_html_settings_editor_has_save_shortcut` — asserts Ctrl+S handler wiring
- `dashboard_html_settings_editor_has_error_bar` — asserts error bar element exists

### Tests Unchanged (backend integration)

- `settings_current_mismatch_persists_until_apply_reconciliation` — tests backend logic, not UI
- `settings_current_file_recreated_from_db_when_file_missing` — tests backend logic, not UI

## Backend

**No changes.** All existing endpoints and logic remain untouched:
- `GET /api/settings/current` — still computes mismatch fields (just not surfaced in UI)
- `POST /api/settings/apply` — still creates backups + writes history
- History, revision, backup tables continue to accumulate data silently

## Out of Scope

- Code folding
- Search/replace within editor
- Undo/redo beyond browser-native textarea behavior
- JSON schema validation (only syntax validation)
- Settings key autocomplete
- Multi-file editing
