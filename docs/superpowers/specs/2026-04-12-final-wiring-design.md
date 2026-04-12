# Final Wiring: Model Config, Settings History, and Dead Code Cleanup — Design Spec

**Date:** 2026-04-12
**Scope:** Wire all remaining unwired items identified by full codebase audit

---

## Problem

After the wire-up-features round, a codebase audit found 7 remaining unwired items:

1. `--model-config` CLI arg hard-exits if used
2. `ModelConfig` + `resolve_behavior_class()` scaffolded but never called
3. Settings history subsystem (5 CRUD methods + DB table) never called from production
4. `record_unknown_stop_reason()` never called from proxy SSE
5. Dead `sessions` table in store.rs (stats.rs has the real one)
6. `EntryFilter::matches()` dead code in stats.rs
7. `storage_dir` field in StatsStore stored but never read

---

## A. Model Config System

### Sample Config File

Ship `model-config.sample.json` in project root with all 140 fingerprint parameters for three behavior classes: opus, sonnet, haiku. Values are realistic expected baselines.

Structure:

```json
{
  "model_mappings": {
    "claude-opus-4-*": "opus",
    "claude-opus-4-1-*": "opus",
    "claude-sonnet-4-*": "sonnet",
    "claude-sonnet-4-5-*": "sonnet",
    "claude-haiku-3-5-*": "haiku",
    "claude-haiku-4-5-*": "haiku"
  },
  "profiles": {
    "opus": {
      "avg_ttft_ms": 3500,
      "median_ttft_ms": 3200,
      "p95_ttft_ms": 8000,
      "p99_ttft_ms": 12000,
      "min_ttft_ms": 800,
      "max_ttft_ms": 15000,
      "ttft_stddev_ms": 1800,
      "avg_duration_ms": 45000,
      "tokens_per_second": 45,
      "avg_inter_chunk_ms": 22,
      "chunk_timing_variance": 15.0,
      "ttft_vs_context_correlation": 0.6,
      "thinking_frequency": 0.85,
      "avg_thinking_tokens": 4500,
      "median_thinking_tokens": 3800,
      "thinking_token_ratio": 0.35,
      "thinking_depth_by_complexity": 0.7,
      "redacted_thinking_frequency": 0.02,
      "thinking_before_tool_rate": 0.9,
      "thinking_per_turn_variance": 0.3,
      "max_thinking_tokens": 32000,
      "effort_response_correlation": 0.5,
      "avg_input_tokens": 8000,
      "avg_output_tokens": 2500,
      "median_output_tokens": 2000,
      "p95_output_tokens": 8000,
      "output_input_ratio": 0.31,
      "max_tokens_hit_rate": 0.03,
      "cache_creation_rate": 0.15,
      "cache_hit_rate": 0.65,
      "avg_cache_read_tokens": 5000,
      "cache_miss_after_hit_rate": 0.08,
      "total_tokens_per_request": 10500,
      "output_token_consistency": 0.6,
      "token_efficiency": 0.85,
      "context_window_utilization": 0.15,
      "tool_call_rate": 0.7,
      "tools_per_turn": 2.1,
      "max_tools_per_turn": 8,
      "multi_tool_rate": 0.45,
      "unique_tool_diversity": 0.6,
      "tool_preference_distribution": 0.4,
      "tool_chain_depth": 1.8,
      "max_tool_chain_depth": 5,
      "tool_success_rate": 0.92,
      "tool_retry_rate": 0.08,
      "tool_adaptation_rate": 0.15,
      "tool_input_avg_size": 350,
      "tool_call_position": 0.4,
      "text_before_tool_ratio": 0.3,
      "tool_use_after_thinking": 0.85,
      "deferred_tool_usage": 0.05,
      "avg_content_blocks": 4.5,
      "max_content_blocks": 20,
      "text_block_count_avg": 2.0,
      "avg_text_block_length": 1200,
      "block_type_distribution": 0.5,
      "stop_reason_distribution": 0.5,
      "end_turn_rate": 0.88,
      "code_in_response_rate": 0.55,
      "markdown_usage_rate": 0.7,
      "response_structure_variance": 0.35,
      "multi_text_block_rate": 0.4,
      "interleaved_thinking_rate": 0.1,
      "citations_frequency": 0.0,
      "connector_text_frequency": 0.3,
      "stall_rate": 0.02,
      "avg_stall_duration_ms": 1500,
      "max_stall_duration_ms": 5000,
      "stalls_per_request": 0.03,
      "stall_position_distribution": 0.5,
      "stream_completion_rate": 0.97,
      "interrupted_stream_rate": 0.03,
      "ping_frequency": 0.1,
      "avg_chunks_per_response": 180,
      "bytes_per_chunk_avg": 85,
      "first_content_event_ms": 3800,
      "stream_warmup_pattern": 0.5,
      "error_rate": 0.04,
      "server_error_rate": 0.01,
      "rate_limit_rate": 0.02,
      "overload_rate": 0.005,
      "client_error_rate": 0.01,
      "timeout_rate": 0.005,
      "connection_error_rate": 0.002,
      "error_type_distribution": 0.5,
      "refusal_rate": 0.01,
      "error_recovery_rate": 0.9,
      "consecutive_error_max": 3,
      "error_time_clustering": 0.2,
      "avg_requests_per_session": 25,
      "session_duration_avg_ms": 1800000,
      "inter_request_gap_avg_ms": 45000,
      "inter_request_gap_variance": 30000,
      "context_growth_rate": 0.15,
      "conversation_depth_avg": 12,
      "session_error_clustering": 0.1,
      "session_tool_evolution": 0.3,
      "session_ttft_trend": 0.05,
      "session_token_trend": 0.1,
      "system_prompt_frequency": 1.0,
      "system_prompt_avg_size": 4000,
      "avg_message_count": 8,
      "tools_provided_avg": 15,
      "tool_choice_distribution": 0.5,
      "temperature_distribution": 0.5,
      "max_tokens_setting_avg": 16000,
      "image_input_rate": 0.05,
      "document_input_rate": 0.02,
      "request_body_avg_bytes": 25000,
      "effort_param_usage": 0.1,
      "effort_thinking_correlation": 0.7,
      "effort_output_correlation": 0.5,
      "effort_ttft_correlation": 0.4,
      "speed_mode_usage": 0.0,
      "speed_mode_ttft_impact": 0.0,
      "speed_mode_quality_impact": 0.0,
      "task_budget_usage": 0.0,
      "cache_control_usage_rate": 0.2,
      "cache_scope_global_rate": 0.1,
      "cache_ttl_1h_rate": 0.05,
      "cache_edit_usage_rate": 0.0,
      "cache_cost_savings_ratio": 0.3,
      "cache_stability": 0.8,
      "cache_warmup_requests": 3,
      "cache_invalidation_pattern": 0.1,
      "beta_features_count": 0,
      "beta_feature_set": 0.0,
      "custom_headers_present": 0.0,
      "anthropic_version": 1.0,
      "provider_type": 1.0,
      "auth_method": 1.0,
      "request_id_tracking": 1.0,
      "response_request_id": 1.0,
      "unknown_sse_event_types": 0.0,
      "unknown_content_block_types": 0.0,
      "unknown_request_fields": 0.0,
      "unknown_header_patterns": 0.0,
      "unknown_stop_reasons": 0.0,
      "unknown_delta_types": 0.0
    }
  }
}
```

Sonnet and haiku profiles follow same structure with different values (faster TTFT, less thinking, etc.).

### Loading

`main.rs`: Replace the hard-exit block with:
1. Read and parse the JSON file into `ModelConfig`
2. Pass `Arc<ModelConfig>` to analyzer worker and dashboard state
3. If file doesn't exist or is invalid, print error and exit

### Conformance Comparison

The conformance tab currently shows observed-only stats. Add:
- For each model, resolve its behavior class via `resolve_behavior_class()`
- Look up expected values from the config profile
- Compute deviation: `(observed - expected) / expected * 100`
- Color code: green (within 20%), yellow (20-50%), red (>50%)

### API Changes

- `GET /api/models/:name/conformance` — returns `{ model, behavior_class, observed: {...}, expected: {...}, deviations: {...} }`
- `GET /api/model-config` — extend to return the loaded ModelConfig (mappings + profile names)

### Dashboard State

Add `Option<Arc<ModelConfig>>` to `DashboardState`. `None` when no config file provided.

---

## B. Settings History Wiring

### Watcher (main.rs analyzer tick)

On each 5s tick:
1. Read `~/.claude/settings.json` (path from `claude_root`)
2. SHA-256 hash the contents
3. Compare to last known hash (stored in memory)
4. If changed: call `stats_store.insert_settings_history_snapshot()` with the full contents

Pass `claude_root: PathBuf` into the analyzer worker closure.

### API Endpoints (dashboard.rs)

- `GET /api/settings-history` → `state.stats.list_settings_history_desc(50)`
- `GET /api/settings-history/:id` → `state.stats.get_settings_history_item(id)`

### Frontend (app.js)

Add a "History" button next to the settings editor save button. On click:
- Fetch `/api/settings-history`
- Show a dropdown/panel with timestamps
- Clicking a timestamp shows the settings JSON at that point

---

## C. Unknown Stop Reason Tracking

### Proxy (proxy.rs)

In the SSE `message_stop` event handler, after extracting `stop_reason`, call:
```rust
types::record_unknown_stop_reason(stop_reason, &unknown_field_stats);
```

This is the same pattern as the existing `record_unknown_event()` call for unknown SSE event types.

Remove `#[allow(dead_code)]` from `record_unknown_stop_reason()` and `KNOWN_STOP_REASONS` in `types.rs`.

---

## D. Dead Code Removal

| Item | File | Action |
|------|------|--------|
| `sessions` table DDL | `store.rs:143-151` | Remove CREATE TABLE and test assertion |
| `EntryFilter::matches()` | `stats.rs:~3985` | Remove method |
| `storage_dir` field | `stats.rs:368` | Remove field and constructor assignment |
| Blanket `#[allow(dead_code)]` on `mod stats` | `main.rs:7` | Remove, add targeted suppressions where needed |

---

## Files Modified

| File | Changes |
|------|---------|
| `model-config.sample.json` | **New** — sample config with opus/sonnet/haiku profiles (140 params each) |
| `src/main.rs` | Load model config, pass to dashboard + analyzer, settings history watcher |
| `src/model_profile.rs` | Remove `#[allow(dead_code)]`, restore `fingerprint_parameter_names()` |
| `src/dashboard.rs` | Add `Option<Arc<ModelConfig>>` to state, conformance endpoint, settings-history endpoints |
| `src/proxy.rs` | Call `record_unknown_stop_reason()` in SSE handler |
| `src/types.rs` | Remove dead_code annotations from stop reason tracking |
| `src/store.rs` | Remove dead `sessions` table |
| `src/stats.rs` | Remove `EntryFilter::matches()`, `storage_dir` field |
| `src/dashboard/tabs/conformance.js` | Add observed vs expected comparison view |
| `src/dashboard/app.js` | Add settings history button and panel |

---

## Verification

1. `cargo test` — all tests pass
2. Run with `--model-config model-config.sample.json` — loads without error
3. Run without `--model-config` — falls back to observed-only (no regression)
4. Conformance tab shows observed vs expected columns when config loaded
5. Settings history: modify settings.json, see snapshot appear in history
6. No `#[allow(dead_code)]` on items that are now wired
7. No remaining "not wired" messages in the codebase
