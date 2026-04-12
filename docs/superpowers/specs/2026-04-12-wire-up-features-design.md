# Wire Up All Scaffolded Features — Design Spec

**Date:** 2026-04-12
**Scope:** Complete all 16 stub/scaffolded/dead-code items in a single plan

---

## Problem

The ClaudeProxy codebase has significant scaffolding that was built during the v2 rewrite but never wired end-to-end. Of the 5 dashboard tabs, 1 is fully non-functional (Conformance), 1 has a single-line JS stub (Anomalies), and 2 have panels that silently return empty (Requests tab correlations/explanations/tools). Only Overview and Sessions are fully functional. The backend has dead code, unused types, duplicate logic, and 10 of 11 anomaly detection rules unimplemented.

---

## A. Anomaly Detection — All 11 Rules

**File:** `src/analyzer.rs`

Implement all `AnomalyKind` variants in `detect_anomalies()`. The `recent` parameter provides model-average baselines for trend-based rules.

| Rule | Trigger | Severity |
|------|---------|----------|
| `SlowTtft` | TTFT > threshold (existing) | warning |
| `Stall` | stall_count > 0 | warning |
| `Timeout` | duration > 2× model avg AND no successful response | error |
| `ApiError` | status 500-599 | error |
| `ClientError` | status 400-499 (except 429) | warning |
| `RateLimited` | status 429 | warning |
| `Overload` | status 529 | error |
| `HighTokens` | output_tokens > 2× model average (needs ≥10 samples) | info |
| `CacheMiss` | cache_read_tokens = 0 when model avg cache_read > 0 (needs ≥10 samples) | info |
| `InterruptedStream` | stream=true AND (stop_reason is None or error_summary is Some) | warning |
| `MaxTokensHit` | stop_reason = "max_tokens" | info |

The `recent` slice is used to compute model averages for `Timeout`, `HighTokens`, and `CacheMiss`. Minimum 10 recent samples required for trend-based rules.

Remove `#[allow(dead_code)]` from `stall_threshold_s` field in `AnalyzerRules`.

---

## B. Model Conformance Tab

### Backend (`src/store.rs`, `src/dashboard.rs`)

Wire existing `model_profiles` table reads into API:

- `api_model_profile(name)` → call `store.get_model_profile_observed(name)` + `store.get_model_profile_sample_count(name)`. Return `{ model, sample_count, observed: { avg_ttft_ms, sample_count }, last_updated }`.
- `api_model_config` GET → query all distinct models from requests table, return list with counts.
- `api_model_comparison(name)` → return observed stats vs global averages.

The dashboard handler functions need access to `Store` (currently they only have `StatsStore`). Add `Store` to the dashboard app state.

### Frontend (`src/dashboard/tabs/conformance.js`)

Fetch `/api/models` → for each model fetch `/api/models/:name/profile`. Render a table:

| Model | Samples | Avg TTFT | Error Rate | Last Seen |
|-------|---------|----------|------------|-----------|

Show "Collecting data..." when sample_count < 50 (auto-tune boundary).

### Cleanup

Remove from `src/model_profile.rs`: `fingerprint_parameter_names()` (140 params never used), dead scaffolding methods. Keep `should_auto_tune()` and `ModelConfig` struct.

Remove from `src/types.rs`: `ModelProfileAssignment`, `CategoryConformanceScore`, `ModelConformanceSummary` (unused scaffolded types).

---

## C. Tool Usage Extraction

### Proxy (`src/proxy.rs`)

During SSE streaming, detect `content_block_start` events where the content block has `type: "tool_use"`. Extract:
- `tool_name` from `content_block.name`
- `tool_input` accumulated from subsequent `content_block_delta` events with `type: "input_json_delta"`

Collect tool uses in a `Vec<(String, serde_json::Value)>` during streaming. After response completes, write to store.

### Store (`src/store.rs`)

Add production methods (remove `#[cfg(test)]` gate if they exist, or add new):
- `insert_tool_usage(request_id, tool_name, tool_input_json) -> Result`
- `get_tool_usage_for_request(request_id) -> Result<Vec<ToolUsageRow>>`

### API (`src/dashboard.rs`)

Wire `api_request_tools` to call `store.get_tool_usage_for_request()` instead of returning `[]`.

### Frontend

Already wired — the modal fetches `/api/requests/:id/tools` and renders.

---

## D. Correlation Engine

### Engine (`src/correlation.rs`)

Expand from 47-line enum to full correlation engine. Rules:

1. **Timestamp match**: For each request, find `local_events` within ±5 seconds of `request.timestamp`. Link type: `temporal`. Confidence: based on time distance (closer = higher).

2. **Session match**: If request has `session_id`, find `local_events` with matching `session_hint`. Link type: `session`. Confidence: 0.9.

3. **Config drift**: Find `local_events` with `event_kind = "config_change"` within ±60s of request. Link type: `config_drift`. Confidence: 0.7.

### Integration (`src/main.rs`)

Run correlation pass in the analyzer worker (5s tick), after anomaly detection. For each newly analyzed request, call correlation engine, write results via `replace_correlations_for_request()`.

### Frontend

Already wired — `loadCorrelations()` fetches and renders.

---

## E. Explanation Generator

### New module: `src/explain.rs`

Rule-based template engine. For each anomaly on a request, generate a ranked explanation:

| Anomaly Kind | Template |
|-------------|----------|
| `SlowTtft` | "TTFT was {value}ms, {pct}% above model average of {avg}ms. Common causes: large context window, API congestion, cold model start." |
| `Stall` | "Stream stalled {count} times totaling {duration}s. May indicate network instability or upstream throttling." |
| `ApiError` | "Server returned {status}. Error: {summary}. This typically indicates upstream service issues." |
| `RateLimited` | "Rate limited (429). You've exceeded the API rate limit. Consider spacing requests or upgrading your plan." |
| `Overload` | "API overloaded (529). The upstream service is temporarily unavailable." |
| `HighTokens` | "Output was {tokens} tokens, {pct}% above model average of {avg}. May indicate verbose responses or insufficient constraints." |
| `MaxTokensHit` | "Response hit max_tokens limit. The model's output was truncated." |
| `InterruptedStream` | "Stream was interrupted before completion. stop_reason: {reason}." |
| `CacheMiss` | "No prompt cache hits. {pct}% of recent requests for this model had cache hits." |
| `Timeout` | "Request took {duration}ms with no response. {pct}% above model average." |
| `ClientError` | "Client error {status}: {summary}." |

Each explanation includes: `rank`, `anomaly_kind`, `summary`, `evidence_json` (raw values used).

### Integration

Run in analyzer worker after anomaly detection. For each request with anomalies, generate explanations and write via `replace_explanations_for_request()`.

### Frontend

Already wired — `loadExplanations()` fetches and renders.

---

## F. Remaining Wiring

### F1. Anomaly Detail View

- **API**: Wire `api_anomaly_detail` in `dashboard.rs` to query `store.get_anomaly_by_id()` (add method to store.rs if missing).
- **Frontend**: `anomalies.js` — add click handler on anomaly cards to fetch detail. Already has the anomaly list rendering from the WebSocket stats snapshot.

### F2. Anomalies Tab JS

The tab currently has a single constant. Wire it to render anomalies from the WebSocket `statsSnapshot.anomalies` data that already flows through. Add severity badges, timestamps, click-to-focus (jump to requests tab filtered by anomaly).

### F3. FTS Search

- Wire `store.rs::search_request_ids()` into the existing `/api/requests` endpoint as an optional `?search=` parameter. When `search` is provided, use FTS5 instead of in-memory filtering.

### F4. Settings History

- Add API endpoints: `GET /api/settings-history`, `GET /api/settings-history/:id`
- Add a watcher: on the 5s analyzer tick, hash current `~/.claude/settings.json` and compare to last snapshot. If changed, call `insert_settings_history_snapshot()`.
- Frontend: Add a small "History" button in the settings editor panel that shows a timeline of changes.

### F5. Unknown Field Stats

- **Proxy**: Persist unknown SSE event types and unknown stop reasons to a new `unknown_fields` table or to the request's `anomalies_json`.
- **Frontend**: Add a small "Forward Compatibility" widget to the conformance tab showing any unknown fields detected.

---

## G. Dead Code Cleanup

| Item | Action |
|------|--------|
| `analyzer.rs::compute_health_score()` | Remove (stats.rs has the used version) |
| `store.rs::increment_model_sample_count()` | Remove (redundant with `persist_analyzed_request`) |
| `stats.rs::EntryFilter::matches()` | Remove (unused, SQL filtering is used) |
| `store.rs` `sessions` table | Remove schema + creation (stats.rs handles sessions) |
| `model_profile.rs` dead scaffolding | Remove `fingerprint_parameter_names()`, keep `should_auto_tune()` and `ModelConfig` |
| `types.rs` unused types | Remove `ModelProfileAssignment`, `CategoryConformanceScore`, `ModelConformanceSummary` |
| `#[allow(dead_code)]` annotations | Remove from items that are now wired |

---

## Dashboard State Change

Currently `dashboard.rs` handlers only receive `Arc<StatsStore>`. Several features (conformance, tools, anomaly detail, FTS search) need `Arc<Store>`. Add `Store` to the Axum app state alongside `StatsStore`.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/analyzer.rs` | Implement 10 new anomaly rules, remove dead `compute_health_score()` |
| `src/correlation.rs` | Expand from enum to full correlation engine |
| `src/explain.rs` | **New** — rule-based explanation generator |
| `src/main.rs` | Wire correlation + explanation into analyzer worker, add `Store` to dashboard state |
| `src/dashboard.rs` | Wire stub endpoints to real data, add `Store` to state, add settings-history endpoints |
| `src/store.rs` | Add tool_usage read/write, anomaly-by-id lookup, remove dead code |
| `src/model_profile.rs` | Remove dead fingerprint scaffolding |
| `src/types.rs` | Remove unused types |
| `src/proxy.rs` | Extract tool_use from SSE, persist unknown fields |
| `src/dashboard/tabs/conformance.js` | Full implementation — model scoreboard |
| `src/dashboard/tabs/anomalies.js` | Full implementation — anomaly list rendering |

---

## Verification

1. `cargo test` — all existing + new tests pass
2. Run proxy with `--auto-configure --open-browser`, make API requests
3. Verify: anomalies appear with all severity types
4. Verify: conformance tab shows model stats after 50+ requests
5. Verify: clicking a request shows correlations and explanations (if Claude Code is the client)
6. Verify: tool usage appears in request modal
7. Verify: anomaly detail view works when clicking an anomaly
8. Verify: FTS search works in requests tab
9. Verify: no console errors in browser
