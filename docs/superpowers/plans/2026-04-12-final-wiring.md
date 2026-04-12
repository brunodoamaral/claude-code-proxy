# Final Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all remaining unwired items: model config loading with 140-parameter profiles, settings history tracking, unknown stop reason recording, and dead code removal.

**Architecture:** Load model config JSON at startup into `Arc<ModelConfig>`, pass to dashboard state and analyzer worker. Wire settings history watcher on 5s tick. Call `record_unknown_stop_reason()` in SSE handler. Remove dead code (sessions table, EntryFilter::matches, storage_dir field).

**Tech Stack:** Rust, Axum, rusqlite, serde_json, SHA-256 (sha2 crate or manual hash)

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `model-config.sample.json` | Sample config with opus/sonnet/haiku profiles (140 params each) | Create |
| `src/model_profile.rs` | ModelConfig loading, behavior class resolution, fingerprint names | Modify: add `load_model_config()`, restore `fingerprint_parameter_names()`, remove `#[allow(dead_code)]` |
| `src/main.rs` | CLI orchestration, config loading, analyzer worker | Modify: load config, pass to dashboard + analyzer, add settings history watcher |
| `src/dashboard.rs` | REST API, dashboard state | Modify: add `Option<Arc<ModelConfig>>` to state, add conformance + settings-history endpoints |
| `src/proxy.rs` | SSE streaming, request forwarding | Modify: call `record_unknown_stop_reason()` |
| `src/types.rs` | Type definitions, forward-compat tracking | Modify: remove `#[allow(dead_code)]` |
| `src/store.rs` | V2 SQLite store | Modify: remove dead `sessions` table |
| `src/stats.rs` | Stats store | Modify: remove `EntryFilter::matches()`, `storage_dir` field |
| `src/dashboard/tabs/conformance.js` | Model scoreboard frontend | Modify: add observed vs expected comparison |
| `src/dashboard/app.js` | Settings editor | Modify: add settings history button and panel |

---

### Task 1: Create sample model config JSON

**Files:**
- Create: `model-config.sample.json`

- [ ] **Step 1: Create the sample config file**

Create `model-config.sample.json` in the project root with all 140 fingerprint parameters for three behavior classes. The `model_mappings` map model name patterns (with `*` wildcards) to behavior class names. The `profiles` map behavior class names to expected baseline values.

```json
{
  "model_mappings": {
    "claude-opus-4-*": "opus",
    "claude-opus-4-0-*": "opus",
    "claude-opus-4-1-*": "opus",
    "claude-opus-4-5-*": "opus",
    "claude-opus-4-6-*": "opus",
    "claude-sonnet-4-*": "sonnet",
    "claude-sonnet-4-0-*": "sonnet",
    "claude-sonnet-4-5-*": "sonnet",
    "claude-sonnet-4-6-*": "sonnet",
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
    },
    "sonnet": {
      "avg_ttft_ms": 1800,
      "median_ttft_ms": 1500,
      "p95_ttft_ms": 4500,
      "p99_ttft_ms": 7000,
      "min_ttft_ms": 400,
      "max_ttft_ms": 10000,
      "ttft_stddev_ms": 1200,
      "avg_duration_ms": 25000,
      "tokens_per_second": 80,
      "avg_inter_chunk_ms": 12,
      "chunk_timing_variance": 8.0,
      "ttft_vs_context_correlation": 0.5,
      "thinking_frequency": 0.6,
      "avg_thinking_tokens": 2000,
      "median_thinking_tokens": 1500,
      "thinking_token_ratio": 0.2,
      "thinking_depth_by_complexity": 0.5,
      "redacted_thinking_frequency": 0.01,
      "thinking_before_tool_rate": 0.75,
      "thinking_per_turn_variance": 0.25,
      "max_thinking_tokens": 16000,
      "effort_response_correlation": 0.4,
      "avg_input_tokens": 6000,
      "avg_output_tokens": 1800,
      "median_output_tokens": 1400,
      "p95_output_tokens": 6000,
      "output_input_ratio": 0.3,
      "max_tokens_hit_rate": 0.04,
      "cache_creation_rate": 0.12,
      "cache_hit_rate": 0.6,
      "avg_cache_read_tokens": 4000,
      "cache_miss_after_hit_rate": 0.1,
      "total_tokens_per_request": 7800,
      "output_token_consistency": 0.55,
      "token_efficiency": 0.8,
      "context_window_utilization": 0.12,
      "tool_call_rate": 0.65,
      "tools_per_turn": 1.8,
      "max_tools_per_turn": 6,
      "multi_tool_rate": 0.35,
      "unique_tool_diversity": 0.55,
      "tool_preference_distribution": 0.4,
      "tool_chain_depth": 1.5,
      "max_tool_chain_depth": 4,
      "tool_success_rate": 0.9,
      "tool_retry_rate": 0.1,
      "tool_adaptation_rate": 0.12,
      "tool_input_avg_size": 300,
      "tool_call_position": 0.35,
      "text_before_tool_ratio": 0.35,
      "tool_use_after_thinking": 0.7,
      "deferred_tool_usage": 0.03,
      "avg_content_blocks": 3.5,
      "max_content_blocks": 15,
      "text_block_count_avg": 1.8,
      "avg_text_block_length": 900,
      "block_type_distribution": 0.5,
      "stop_reason_distribution": 0.5,
      "end_turn_rate": 0.9,
      "code_in_response_rate": 0.5,
      "markdown_usage_rate": 0.65,
      "response_structure_variance": 0.3,
      "multi_text_block_rate": 0.35,
      "interleaved_thinking_rate": 0.08,
      "citations_frequency": 0.0,
      "connector_text_frequency": 0.25,
      "stall_rate": 0.015,
      "avg_stall_duration_ms": 1200,
      "max_stall_duration_ms": 4000,
      "stalls_per_request": 0.02,
      "stall_position_distribution": 0.5,
      "stream_completion_rate": 0.98,
      "interrupted_stream_rate": 0.02,
      "ping_frequency": 0.1,
      "avg_chunks_per_response": 140,
      "bytes_per_chunk_avg": 90,
      "first_content_event_ms": 2000,
      "stream_warmup_pattern": 0.5,
      "error_rate": 0.03,
      "server_error_rate": 0.008,
      "rate_limit_rate": 0.015,
      "overload_rate": 0.003,
      "client_error_rate": 0.008,
      "timeout_rate": 0.003,
      "connection_error_rate": 0.001,
      "error_type_distribution": 0.5,
      "refusal_rate": 0.008,
      "error_recovery_rate": 0.92,
      "consecutive_error_max": 2,
      "error_time_clustering": 0.15,
      "avg_requests_per_session": 30,
      "session_duration_avg_ms": 1500000,
      "inter_request_gap_avg_ms": 35000,
      "inter_request_gap_variance": 25000,
      "context_growth_rate": 0.12,
      "conversation_depth_avg": 15,
      "session_error_clustering": 0.08,
      "session_tool_evolution": 0.25,
      "session_ttft_trend": 0.03,
      "session_token_trend": 0.08,
      "system_prompt_frequency": 1.0,
      "system_prompt_avg_size": 3500,
      "avg_message_count": 10,
      "tools_provided_avg": 12,
      "tool_choice_distribution": 0.5,
      "temperature_distribution": 0.5,
      "max_tokens_setting_avg": 16000,
      "image_input_rate": 0.04,
      "document_input_rate": 0.02,
      "request_body_avg_bytes": 20000,
      "effort_param_usage": 0.08,
      "effort_thinking_correlation": 0.6,
      "effort_output_correlation": 0.45,
      "effort_ttft_correlation": 0.35,
      "speed_mode_usage": 0.0,
      "speed_mode_ttft_impact": 0.0,
      "speed_mode_quality_impact": 0.0,
      "task_budget_usage": 0.0,
      "cache_control_usage_rate": 0.18,
      "cache_scope_global_rate": 0.08,
      "cache_ttl_1h_rate": 0.04,
      "cache_edit_usage_rate": 0.0,
      "cache_cost_savings_ratio": 0.25,
      "cache_stability": 0.75,
      "cache_warmup_requests": 2,
      "cache_invalidation_pattern": 0.08,
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
    },
    "haiku": {
      "avg_ttft_ms": 800,
      "median_ttft_ms": 600,
      "p95_ttft_ms": 2000,
      "p99_ttft_ms": 3500,
      "min_ttft_ms": 200,
      "max_ttft_ms": 5000,
      "ttft_stddev_ms": 600,
      "avg_duration_ms": 8000,
      "tokens_per_second": 150,
      "avg_inter_chunk_ms": 7,
      "chunk_timing_variance": 4.0,
      "ttft_vs_context_correlation": 0.4,
      "thinking_frequency": 0.3,
      "avg_thinking_tokens": 800,
      "median_thinking_tokens": 500,
      "thinking_token_ratio": 0.1,
      "thinking_depth_by_complexity": 0.3,
      "redacted_thinking_frequency": 0.005,
      "thinking_before_tool_rate": 0.5,
      "thinking_per_turn_variance": 0.2,
      "max_thinking_tokens": 8000,
      "effort_response_correlation": 0.3,
      "avg_input_tokens": 3000,
      "avg_output_tokens": 800,
      "median_output_tokens": 600,
      "p95_output_tokens": 2500,
      "output_input_ratio": 0.27,
      "max_tokens_hit_rate": 0.05,
      "cache_creation_rate": 0.1,
      "cache_hit_rate": 0.55,
      "avg_cache_read_tokens": 2500,
      "cache_miss_after_hit_rate": 0.12,
      "total_tokens_per_request": 3800,
      "output_token_consistency": 0.5,
      "token_efficiency": 0.75,
      "context_window_utilization": 0.08,
      "tool_call_rate": 0.5,
      "tools_per_turn": 1.3,
      "max_tools_per_turn": 4,
      "multi_tool_rate": 0.2,
      "unique_tool_diversity": 0.4,
      "tool_preference_distribution": 0.35,
      "tool_chain_depth": 1.2,
      "max_tool_chain_depth": 3,
      "tool_success_rate": 0.85,
      "tool_retry_rate": 0.12,
      "tool_adaptation_rate": 0.08,
      "tool_input_avg_size": 200,
      "tool_call_position": 0.3,
      "text_before_tool_ratio": 0.4,
      "tool_use_after_thinking": 0.5,
      "deferred_tool_usage": 0.02,
      "avg_content_blocks": 2.5,
      "max_content_blocks": 10,
      "text_block_count_avg": 1.5,
      "avg_text_block_length": 500,
      "block_type_distribution": 0.5,
      "stop_reason_distribution": 0.5,
      "end_turn_rate": 0.92,
      "code_in_response_rate": 0.4,
      "markdown_usage_rate": 0.5,
      "response_structure_variance": 0.25,
      "multi_text_block_rate": 0.25,
      "interleaved_thinking_rate": 0.05,
      "citations_frequency": 0.0,
      "connector_text_frequency": 0.2,
      "stall_rate": 0.01,
      "avg_stall_duration_ms": 800,
      "max_stall_duration_ms": 3000,
      "stalls_per_request": 0.01,
      "stall_position_distribution": 0.5,
      "stream_completion_rate": 0.99,
      "interrupted_stream_rate": 0.01,
      "ping_frequency": 0.1,
      "avg_chunks_per_response": 80,
      "bytes_per_chunk_avg": 60,
      "first_content_event_ms": 900,
      "stream_warmup_pattern": 0.5,
      "error_rate": 0.02,
      "server_error_rate": 0.005,
      "rate_limit_rate": 0.01,
      "overload_rate": 0.002,
      "client_error_rate": 0.005,
      "timeout_rate": 0.002,
      "connection_error_rate": 0.001,
      "error_type_distribution": 0.5,
      "refusal_rate": 0.005,
      "error_recovery_rate": 0.95,
      "consecutive_error_max": 2,
      "error_time_clustering": 0.1,
      "avg_requests_per_session": 40,
      "session_duration_avg_ms": 1200000,
      "inter_request_gap_avg_ms": 20000,
      "inter_request_gap_variance": 15000,
      "context_growth_rate": 0.1,
      "conversation_depth_avg": 20,
      "session_error_clustering": 0.05,
      "session_tool_evolution": 0.2,
      "session_ttft_trend": 0.02,
      "session_token_trend": 0.05,
      "system_prompt_frequency": 1.0,
      "system_prompt_avg_size": 2500,
      "avg_message_count": 12,
      "tools_provided_avg": 8,
      "tool_choice_distribution": 0.5,
      "temperature_distribution": 0.5,
      "max_tokens_setting_avg": 8000,
      "image_input_rate": 0.02,
      "document_input_rate": 0.01,
      "request_body_avg_bytes": 10000,
      "effort_param_usage": 0.05,
      "effort_thinking_correlation": 0.4,
      "effort_output_correlation": 0.3,
      "effort_ttft_correlation": 0.25,
      "speed_mode_usage": 0.0,
      "speed_mode_ttft_impact": 0.0,
      "speed_mode_quality_impact": 0.0,
      "task_budget_usage": 0.0,
      "cache_control_usage_rate": 0.15,
      "cache_scope_global_rate": 0.05,
      "cache_ttl_1h_rate": 0.03,
      "cache_edit_usage_rate": 0.0,
      "cache_cost_savings_ratio": 0.2,
      "cache_stability": 0.7,
      "cache_warmup_requests": 2,
      "cache_invalidation_pattern": 0.06,
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

- [ ] **Step 2: Verify it parses as valid JSON**

Run: `python -c "import json; json.load(open('model-config.sample.json')); print('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add model-config.sample.json
git commit -m "feat: add sample model config with opus/sonnet/haiku profiles (140 params)"
```

---

### Task 2: Wire model config loading in model_profile.rs

**Files:**
- Modify: `src/model_profile.rs`

- [ ] **Step 1: Write the failing test for load_model_config**

Add this test to the existing `mod tests` block in `src/model_profile.rs`:

```rust
#[test]
fn load_model_config_parses_valid_json() {
    let json = r#"{
        "model_mappings": { "claude-opus-4-*": "opus" },
        "profiles": { "opus": { "avg_ttft_ms": 3500 } }
    }"#;
    let tmp = std::env::temp_dir().join(format!("test-config-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, json).unwrap();
    let config = load_model_config(&tmp).unwrap();
    assert_eq!(config.model_mappings.get("claude-opus-4-*").unwrap(), "opus");
    assert_eq!(config.profiles.get("opus").unwrap()["avg_ttft_ms"], 3500.0);
    let _ = std::fs::remove_file(&tmp);
}

#[test]
fn load_model_config_returns_error_for_missing_file() {
    let result = load_model_config(std::path::Path::new("/nonexistent/config.json"));
    assert!(result.is_err());
}

#[test]
fn fingerprint_parameter_names_returns_140_entries() {
    let names = fingerprint_parameter_names();
    assert_eq!(names.len(), 140);
    assert!(names.contains(&"avg_ttft_ms"));
    assert!(names.contains(&"unknown_delta_types"));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib model_profile::tests::load_model_config`
Expected: FAIL — `load_model_config` not found

- [ ] **Step 3: Implement load_model_config and restore fingerprint_parameter_names**

Replace the entire contents of `src/model_profile.rs` with:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub profiles: HashMap<String, serde_json::Value>,
    pub model_mappings: HashMap<String, String>,
}

/// Load a model config JSON file from disk.
pub fn load_model_config(path: &Path) -> Result<ModelConfig, String> {
    let contents = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let config: ModelConfig = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;
    Ok(config)
}

pub fn resolve_behavior_class(config: &ModelConfig, model_name: &str) -> Option<String> {
    if let Some(class) = config.model_mappings.get(model_name) {
        return Some(class.clone());
    }

    config
        .model_mappings
        .iter()
        .filter_map(|(pattern, class)| {
            let prefix = pattern.strip_suffix('*')?;
            if model_name.starts_with(prefix) {
                Some((prefix.len(), class))
            } else {
                None
            }
        })
        .max_by_key(|(prefix_len, _)| *prefix_len)
        .map(|(_, class)| class.clone())
}

pub fn should_auto_tune(sample_count: u64) -> bool {
    sample_count >= 50 && sample_count.is_multiple_of(50)
}

pub fn fingerprint_parameter_names() -> Vec<&'static str> {
    vec![
        "avg_ttft_ms",
        "median_ttft_ms",
        "p95_ttft_ms",
        "p99_ttft_ms",
        "min_ttft_ms",
        "max_ttft_ms",
        "ttft_stddev_ms",
        "avg_duration_ms",
        "tokens_per_second",
        "avg_inter_chunk_ms",
        "chunk_timing_variance",
        "ttft_vs_context_correlation",
        "thinking_frequency",
        "avg_thinking_tokens",
        "median_thinking_tokens",
        "thinking_token_ratio",
        "thinking_depth_by_complexity",
        "redacted_thinking_frequency",
        "thinking_before_tool_rate",
        "thinking_per_turn_variance",
        "max_thinking_tokens",
        "effort_response_correlation",
        "avg_input_tokens",
        "avg_output_tokens",
        "median_output_tokens",
        "p95_output_tokens",
        "output_input_ratio",
        "max_tokens_hit_rate",
        "cache_creation_rate",
        "cache_hit_rate",
        "avg_cache_read_tokens",
        "cache_miss_after_hit_rate",
        "total_tokens_per_request",
        "output_token_consistency",
        "token_efficiency",
        "context_window_utilization",
        "tool_call_rate",
        "tools_per_turn",
        "max_tools_per_turn",
        "multi_tool_rate",
        "unique_tool_diversity",
        "tool_preference_distribution",
        "tool_chain_depth",
        "max_tool_chain_depth",
        "tool_success_rate",
        "tool_retry_rate",
        "tool_adaptation_rate",
        "tool_input_avg_size",
        "tool_call_position",
        "text_before_tool_ratio",
        "tool_use_after_thinking",
        "deferred_tool_usage",
        "avg_content_blocks",
        "max_content_blocks",
        "text_block_count_avg",
        "avg_text_block_length",
        "block_type_distribution",
        "stop_reason_distribution",
        "end_turn_rate",
        "code_in_response_rate",
        "markdown_usage_rate",
        "response_structure_variance",
        "multi_text_block_rate",
        "interleaved_thinking_rate",
        "citations_frequency",
        "connector_text_frequency",
        "stall_rate",
        "avg_stall_duration_ms",
        "max_stall_duration_ms",
        "stalls_per_request",
        "stall_position_distribution",
        "stream_completion_rate",
        "interrupted_stream_rate",
        "ping_frequency",
        "avg_chunks_per_response",
        "bytes_per_chunk_avg",
        "first_content_event_ms",
        "stream_warmup_pattern",
        "error_rate",
        "server_error_rate",
        "rate_limit_rate",
        "overload_rate",
        "client_error_rate",
        "timeout_rate",
        "connection_error_rate",
        "error_type_distribution",
        "refusal_rate",
        "error_recovery_rate",
        "consecutive_error_max",
        "error_time_clustering",
        "avg_requests_per_session",
        "session_duration_avg_ms",
        "inter_request_gap_avg_ms",
        "inter_request_gap_variance",
        "context_growth_rate",
        "conversation_depth_avg",
        "session_error_clustering",
        "session_tool_evolution",
        "session_ttft_trend",
        "session_token_trend",
        "system_prompt_frequency",
        "system_prompt_avg_size",
        "avg_message_count",
        "tools_provided_avg",
        "tool_choice_distribution",
        "temperature_distribution",
        "max_tokens_setting_avg",
        "image_input_rate",
        "document_input_rate",
        "request_body_avg_bytes",
        "effort_param_usage",
        "effort_thinking_correlation",
        "effort_output_correlation",
        "effort_ttft_correlation",
        "speed_mode_usage",
        "speed_mode_ttft_impact",
        "speed_mode_quality_impact",
        "task_budget_usage",
        "cache_control_usage_rate",
        "cache_scope_global_rate",
        "cache_ttl_1h_rate",
        "cache_edit_usage_rate",
        "cache_cost_savings_ratio",
        "cache_stability",
        "cache_warmup_requests",
        "cache_invalidation_pattern",
        "beta_features_count",
        "beta_feature_set",
        "custom_headers_present",
        "anthropic_version",
        "provider_type",
        "auth_method",
        "request_id_tracking",
        "response_request_id",
        "unknown_sse_event_types",
        "unknown_content_block_types",
        "unknown_request_fields",
        "unknown_header_patterns",
        "unknown_stop_reasons",
        "unknown_delta_types",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_model_config_parses_valid_json() {
        let json = r#"{
            "model_mappings": { "claude-opus-4-*": "opus" },
            "profiles": { "opus": { "avg_ttft_ms": 3500 } }
        }"#;
        let tmp = std::env::temp_dir().join(format!("test-config-{}.json", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, json).unwrap();
        let config = load_model_config(&tmp).unwrap();
        assert_eq!(config.model_mappings.get("claude-opus-4-*").unwrap(), "opus");
        assert_eq!(config.profiles.get("opus").unwrap()["avg_ttft_ms"], 3500.0);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn load_model_config_returns_error_for_missing_file() {
        let result = load_model_config(std::path::Path::new("/nonexistent/config.json"));
        assert!(result.is_err());
    }

    #[test]
    fn fingerprint_parameter_names_returns_140_entries() {
        let names = fingerprint_parameter_names();
        assert_eq!(names.len(), 140);
        assert!(names.contains(&"avg_ttft_ms"));
        assert!(names.contains(&"unknown_delta_types"));
    }

    #[test]
    fn resolve_behavior_class_uses_wildcard_mapping() {
        let config = ModelConfig {
            profiles: std::collections::HashMap::new(),
            model_mappings: std::collections::HashMap::from([(
                "claude-opus-4-*".to_string(),
                "opus".to_string(),
            )]),
        };
        let class = resolve_behavior_class(&config, "claude-opus-4-20260301");
        assert_eq!(class.as_deref(), Some("opus"));
    }

    #[test]
    fn resolve_behavior_class_prefers_exact_match_over_wildcard() {
        let config = ModelConfig {
            profiles: std::collections::HashMap::new(),
            model_mappings: std::collections::HashMap::from([
                ("claude-opus-4-*".to_string(), "wildcard-opus".to_string()),
                ("claude-opus-4-20260301".to_string(), "exact-opus".to_string()),
            ]),
        };
        let class = resolve_behavior_class(&config, "claude-opus-4-20260301");
        assert_eq!(class.as_deref(), Some("exact-opus"));
    }

    #[test]
    fn resolve_behavior_class_prefers_most_specific_wildcard_prefix() {
        let config = ModelConfig {
            profiles: std::collections::HashMap::new(),
            model_mappings: std::collections::HashMap::from([
                ("claude-*".to_string(), "generic".to_string()),
                ("claude-opus-*".to_string(), "opus-generic".to_string()),
                ("claude-opus-4-*".to_string(), "opus-v4-specific".to_string()),
            ]),
        };
        let class = resolve_behavior_class(&config, "claude-opus-4-20260301");
        assert_eq!(class.as_deref(), Some("opus-v4-specific"));
    }

    #[test]
    fn resolve_behavior_class_returns_none_when_no_match_exists() {
        let config = ModelConfig {
            profiles: std::collections::HashMap::new(),
            model_mappings: std::collections::HashMap::from([
                ("claude-opus-4-*".to_string(), "opus".to_string()),
                ("gpt-4-*".to_string(), "gpt".to_string()),
            ]),
        };
        let class = resolve_behavior_class(&config, "llama-3-70b");
        assert_eq!(class, None);
    }

    #[test]
    fn should_auto_tune_boundary_values() {
        assert!(!should_auto_tune(49));
        assert!(should_auto_tune(50));
        assert!(!should_auto_tune(51));
        assert!(should_auto_tune(100));
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib model_profile`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/model_profile.rs
git commit -m "feat: add load_model_config and restore fingerprint_parameter_names"
```

---

### Task 3: Wire model config loading in main.rs and dashboard state

**Files:**
- Modify: `src/main.rs`
- Modify: `src/dashboard.rs`

- [ ] **Step 1: Update main.rs to load model config**

In `src/main.rs`, replace lines 95–103 (the hard-exit block) with:

```rust
    let model_config = if let Some(model_config_path) = &args.model_config {
        match model_profile::load_model_config(model_config_path) {
            Ok(config) => {
                let msg = format!(
                    "Loaded model config from {} ({} mappings, {} profiles)",
                    model_config_path.display(),
                    config.model_mappings.len(),
                    config.profiles.len()
                );
                eprintln!("  \x1b[92m✓\x1b[0m {msg}");
                write_log(&msg);
                Some(Arc::new(config))
            }
            Err(err) => {
                let msg = format!("Failed to load model config: {err}");
                eprintln!("{msg}");
                write_log(&msg);
                std::process::exit(2);
            }
        }
    } else {
        None
    };
```

Add `use model_profile::ModelConfig;` near the top of main.rs if not already imported.

- [ ] **Step 2: Update DashboardState in dashboard.rs**

In `src/dashboard.rs`, change the `DashboardState` struct (line 16–19) to:

```rust
#[derive(Clone)]
struct DashboardState {
    stats: Arc<StatsStore>,
    store: Arc<Store>,
    model_config: Option<Arc<crate::model_profile::ModelConfig>>,
}
```

- [ ] **Step 3: Update run_dashboard and build_dashboard_app signatures**

Change `run_dashboard` (line 21) to:

```rust
pub async fn run_dashboard(
    stats: Arc<StatsStore>,
    store: Arc<Store>,
    model_config: Option<Arc<crate::model_profile::ModelConfig>>,
    port: u16,
) -> Result<(), String> {
    let app = build_dashboard_app(stats, store, model_config);
    // ... rest unchanged
```

Change `build_dashboard_app` (line 46) to:

```rust
fn build_dashboard_app(
    stats: Arc<StatsStore>,
    store: Arc<Store>,
    model_config: Option<Arc<crate::model_profile::ModelConfig>>,
) -> Router {
    let state = DashboardState { stats, store, model_config };
    // ... rest unchanged
```

- [ ] **Step 4: Update main.rs dashboard spawn to pass model_config**

In `src/main.rs`, update the dashboard spawn (around line 168–175) to:

```rust
    let store_dash = store.clone();
    let v2_dash = v2_store.clone();
    let model_config_dash = model_config.clone();
    let dash_port = args.dashboard_port;
    tokio::spawn(async move {
        if let Err(err) = dashboard::run_dashboard(store_dash, v2_dash, model_config_dash, dash_port).await {
            eprintln!("Dashboard startup failed: {err}");
        }
    });
```

- [ ] **Step 5: Run cargo check**

Run: `cargo check`
Expected: Clean compilation (no errors)

- [ ] **Step 6: Commit**

```bash
git add src/main.rs src/dashboard.rs
git commit -m "feat: wire model config loading from CLI into dashboard state"
```

---

### Task 4: Wire conformance API endpoint with expected vs observed

**Files:**
- Modify: `src/dashboard.rs`

- [ ] **Step 1: Update api_model_config to include config data**

Replace the `api_model_config` handler with:

```rust
async fn api_model_config(State(state): State<DashboardState>) -> impl IntoResponse {
    let models = state.store.list_all_model_stats().unwrap_or_default();
    let config_info = state.model_config.as_ref().map(|c| {
        serde_json::json!({
            "mappings": c.model_mappings,
            "profile_names": c.profiles.keys().collect::<Vec<_>>(),
        })
    });
    Json(serde_json::json!({
        "models": models,
        "config": config_info,
    }))
}
```

- [ ] **Step 2: Update api_model_comparison to include expected baselines**

Replace the `api_model_comparison` handler with:

```rust
async fn api_model_comparison(
    Path(name): Path<String>,
    State(state): State<DashboardState>,
) -> impl IntoResponse {
    let observed = state.store.get_model_profile_observed(&name).ok().flatten();

    let (behavior_class, expected) = if let Some(ref config) = state.model_config {
        let class = crate::model_profile::resolve_behavior_class(config, &name);
        let profile = class.as_ref().and_then(|c| config.profiles.get(c).cloned());
        (class, profile)
    } else {
        (None, None)
    };

    let deviations = if let (Some(ref obs), Some(ref exp)) = (&observed, &expected) {
        if let (Some(obs_obj), Some(exp_obj)) = (obs.as_object(), exp.as_object()) {
            let mut devs = serde_json::Map::new();
            for (key, exp_val) in exp_obj {
                if let (Some(e), Some(o)) = (exp_val.as_f64(), obs_obj.get(key).and_then(|v| v.as_f64())) {
                    if e != 0.0 {
                        devs.insert(key.clone(), serde_json::json!((o - e) / e * 100.0));
                    }
                }
            }
            Some(serde_json::Value::Object(devs))
        } else {
            None
        }
    } else {
        None
    };

    Json(serde_json::json!({
        "model": name,
        "behavior_class": behavior_class,
        "observed": observed,
        "expected": expected,
        "deviations": deviations,
    }))
}
```

- [ ] **Step 3: Run cargo check**

Run: `cargo check`
Expected: Clean compilation

- [ ] **Step 4: Commit**

```bash
git add src/dashboard.rs
git commit -m "feat: wire conformance API with expected vs observed comparison"
```

---

### Task 5: Update conformance tab frontend for expected vs observed

**Files:**
- Modify: `src/dashboard/tabs/conformance.js`

- [ ] **Step 1: Replace conformance.js with full implementation**

Replace the entire contents of `src/dashboard/tabs/conformance.js` with:

```javascript
function initConformanceTab() {
    loadConformanceData();
}

async function loadConformanceData() {
    const container = document.getElementById('conformance-content');
    if (!container) return;

    try {
        const configResp = await fetch('/api/model-config');
        const configData = await configResp.json();
        const models = configData.models || [];
        const hasConfig = !!configData.config;

        if (models.length === 0) {
            container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-secondary)">No model data yet. Make some API requests through the proxy.</div>';
            return;
        }

        // Fetch comparison data for each model
        const comparisons = await Promise.all(
            models.map(async (m) => {
                try {
                    const resp = await fetch('/api/models/' + encodeURIComponent(m.model) + '/comparison');
                    return await resp.json();
                } catch { return { model: m.model }; }
            })
        );

        let html = '<div style="padding:1rem">';
        html += '<table class="data-table" style="width:100%"><thead><tr>';
        html += '<th>Model</th><th>Class</th><th>Requests</th><th>Avg TTFT</th>';
        if (hasConfig) {
            html += '<th>Expected TTFT</th><th>Deviation</th>';
        }
        html += '<th>Error Rate</th><th>Status</th>';
        html += '</tr></thead><tbody>';

        for (const m of models) {
            const comp = comparisons.find(c => c.model === m.model) || {};
            const profile = await fetchProfile(m.model);
            const sampleCount = profile.sample_count || 0;
            const profiled = sampleCount >= 50;

            const errorRate = m.request_count > 0 ? ((m.error_count / m.request_count) * 100).toFixed(1) : '0.0';
            const errorColor = parseFloat(errorRate) > 5 ? 'var(--error)' : parseFloat(errorRate) > 2 ? 'var(--warning)' : 'var(--success)';

            const behaviorClass = comp.behavior_class || '-';

            let expectedTtft = '-';
            let deviation = '-';
            let deviationColor = 'var(--text-secondary)';

            if (hasConfig && comp.expected) {
                const expVal = comp.expected.avg_ttft_ms;
                if (expVal != null) {
                    expectedTtft = Math.round(expVal) + 'ms';
                }
                if (comp.deviations && comp.deviations.avg_ttft_ms != null) {
                    const dev = comp.deviations.avg_ttft_ms;
                    deviation = (dev > 0 ? '+' : '') + dev.toFixed(1) + '%';
                    deviationColor = Math.abs(dev) <= 20 ? 'var(--success)' : Math.abs(dev) <= 50 ? 'var(--warning)' : 'var(--error)';
                }
            }

            html += '<tr>';
            html += '<td><strong>' + esc(m.model) + '</strong></td>';
            html += '<td>' + esc(behaviorClass) + '</td>';
            html += '<td>' + (m.request_count || 0) + '</td>';
            html += '<td>' + (m.avg_ttft_ms != null ? Math.round(m.avg_ttft_ms) + 'ms' : '-') + '</td>';
            if (hasConfig) {
                html += '<td>' + expectedTtft + '</td>';
                html += '<td style="color:' + deviationColor + ';font-weight:600">' + deviation + '</td>';
            }
            html += '<td style="color:' + errorColor + '">' + errorRate + '%</td>';
            html += '<td>' + (profiled
                ? '<span style="color:var(--success)">Profiled (' + sampleCount + ')</span>'
                : '<span style="color:var(--warning)">Collecting... (' + sampleCount + '/50)</span>') + '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';

        // Summary
        const totalRequests = models.reduce((s, m) => s + (m.request_count || 0), 0);
        const totalErrors = models.reduce((s, m) => s + (m.error_count || 0), 0);
        const overallErrorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(1) : '0.0';
        html += '<div style="margin-top:1rem;color:var(--text-secondary);font-size:0.85rem">';
        html += models.length + ' model(s), ' + totalRequests + ' total requests, ' + overallErrorRate + '% overall error rate';
        if (hasConfig) html += ' | Config loaded with expected baselines';
        html += '</div>';

        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = '<div style="padding:2rem;color:var(--error)">Failed to load conformance data: ' + esc(err.message) + '</div>';
    }
}

async function fetchProfile(modelName) {
    try {
        const resp = await fetch('/api/models/' + encodeURIComponent(modelName) + '/profile');
        return await resp.json();
    } catch { return {}; }
}
```

- [ ] **Step 2: Run cargo check (ensures no format! issues in shell.html)**

Run: `cargo check`
Expected: Clean compilation

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/tabs/conformance.js
git commit -m "feat: conformance tab shows expected vs observed with deviation colors"
```

---

### Task 6: Wire settings history watcher and API endpoints

**Files:**
- Modify: `src/main.rs`
- Modify: `src/dashboard.rs`

- [ ] **Step 1: Add settings history watcher to analyzer tick in main.rs**

In `src/main.rs`, add a `check_settings_changed` function before `main()`:

```rust
fn check_settings_changed(
    stats_store: &StatsStore,
    claude_root: &std::path::Path,
    last_hash: &mut Option<String>,
) {
    let settings_path = claude_root.join("settings.json");
    if !settings_path.exists() {
        return;
    }
    let contents = match std::fs::read_to_string(&settings_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    contents.hash(&mut hasher);
    let current_hash = format!("{:016x}", hasher.finish());

    if last_hash.as_ref() == Some(&current_hash) {
        return;
    }
    *last_hash = Some(current_hash.clone());

    stats_store.insert_settings_history_snapshot(
        &current_hash,
        &contents,
        "file_watch",
    );
}
```

- [ ] **Step 2: Call the watcher in the analyzer worker loop**

In the analyzer worker spawn block in `main()` (around line 137–156), add settings checking. Update the closure to capture `claude_root` and add a `last_settings_hash`:

```rust
    {
        let analyzer_store = v2_store.clone();
        let stats_for_worker = store.clone();
        let worker_rules = analyzer_rules.clone();
        let worker_claude_root = claude_root.clone();
        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(5));
            let mut last_settings_hash: Option<String> = None;
            loop {
                ticker.tick().await;
                if let Err(err) = run_analyzer_tick_with_rules(
                    analyzer_store.clone(),
                    Some(stats_for_worker.clone()),
                    &worker_rules,
                )
                .await
                {
                    eprintln!("Analyzer tick failed: {err}");
                }
                check_settings_changed(&stats_for_worker, &worker_claude_root, &mut last_settings_hash);
            }
        });
    }
```

- [ ] **Step 3: Add settings history API endpoints in dashboard.rs**

Add these two route registrations in `build_dashboard_app` (after the existing routes, before `.with_state(state)`):

```rust
        .route("/api/settings-history", get(api_settings_history))
        .route("/api/settings-history/:id", get(api_settings_history_item))
```

Add the handler functions:

```rust
async fn api_settings_history(State(state): State<DashboardState>) -> impl IntoResponse {
    let items = state.stats.list_settings_history_desc(50);
    let entries: Vec<serde_json::Value> = items
        .iter()
        .map(|item| {
            serde_json::json!({
                "id": item.id,
                "saved_at_ms": item.saved_at_ms,
                "content_hash": item.content_hash,
                "source": item.source,
            })
        })
        .collect();
    Json(serde_json::json!(entries))
}

async fn api_settings_history_item(
    Path(id): Path<String>,
    State(state): State<DashboardState>,
) -> impl IntoResponse {
    match state.stats.get_settings_history_item(&id) {
        Some(item) => Json(serde_json::json!({
            "id": item.id,
            "saved_at_ms": item.saved_at_ms,
            "content_hash": item.content_hash,
            "settings_json": item.settings_json,
            "source": item.source,
        })),
        None => Json(serde_json::json!({"error": "not found"})),
    }
}
```

- [ ] **Step 4: Remove #[allow(dead_code)] from settings history methods in stats.rs**

In `src/stats.rs`, remove the `#[allow(dead_code)]` annotations from:
- `insert_settings_history_snapshot` (line ~2414)
- `list_settings_history_desc` (line ~2443)
- `get_settings_history_item` (line ~2490)

Keep `delete_settings_history_item` and `clear_settings_history` as dead_code since they are test-only utilities.

- [ ] **Step 5: Run cargo check**

Run: `cargo check`
Expected: Clean compilation

- [ ] **Step 6: Commit**

```bash
git add src/main.rs src/dashboard.rs src/stats.rs
git commit -m "feat: wire settings history watcher and API endpoints"
```

---

### Task 7: Add settings history UI to app.js

**Files:**
- Modify: `src/dashboard/app.js`

- [ ] **Step 1: Add settings history button and panel**

In `src/dashboard/app.js`, find the DOMContentLoaded section that binds the settings editor buttons (around line 432–455). Add a click handler for a history button. First, add the helper functions anywhere before the DOMContentLoaded block:

```javascript
async function loadSettingsHistory() {
    const panel = document.getElementById('settings-history-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'none') return;

    try {
        const resp = await fetch('/api/settings-history');
        const items = await resp.json();
        if (items.length === 0) {
            panel.innerHTML = '<div style="padding:0.5rem;color:var(--text-secondary)">No history yet.</div>';
            return;
        }
        let html = '<div style="max-height:200px;overflow-y:auto">';
        for (const item of items) {
            const date = new Date(item.saved_at_ms).toLocaleString();
            html += '<div class="settings-history-entry" data-id="' + esc(item.id) + '" '
                + 'style="padding:0.4rem 0.6rem;cursor:pointer;border-bottom:1px solid var(--border)">'
                + '<span style="font-size:0.85rem">' + esc(date) + '</span> '
                + '<span style="font-size:0.75rem;color:var(--text-secondary)">' + esc(item.source) + '</span>'
                + '</div>';
        }
        html += '</div>';
        panel.innerHTML = html;
        panel.querySelectorAll('.settings-history-entry').forEach(el => {
            el.addEventListener('click', () => loadSettingsHistoryItem(el.dataset.id));
        });
    } catch (err) {
        panel.innerHTML = '<div style="padding:0.5rem;color:var(--error)">Error: ' + esc(err.message) + '</div>';
    }
}

async function loadSettingsHistoryItem(id) {
    try {
        const resp = await fetch('/api/settings-history/' + encodeURIComponent(id));
        const item = await resp.json();
        if (item.settings_json) {
            const editor = document.getElementById('settings-editor');
            if (editor) {
                editor.value = JSON.stringify(JSON.parse(item.settings_json), null, 2);
                renderSettingsEditor();
            }
        }
    } catch (err) {
        console.error('Failed to load settings history item:', err);
    }
}
```

- [ ] **Step 2: Add the history button to shell.html**

In `src/dashboard/shell.html`, find the settings editor button area (near the Apply/Format/Reset buttons). Add after the last button:

```html
<button id="settings-history-btn" title="View settings change history" style="margin-left:0.5rem">History</button>
<div id="settings-history-panel" style="display:none;margin-top:0.5rem;border:1px solid var(--border);border-radius:4px;background:var(--bg-secondary)"></div>
```

- [ ] **Step 3: Wire the click handler in app.js DOMContentLoaded**

In the DOMContentLoaded block of `src/dashboard/app.js`, add:

```javascript
    const historyBtn = document.getElementById('settings-history-btn');
    if (historyBtn) historyBtn.addEventListener('click', loadSettingsHistory);
```

- [ ] **Step 4: Run cargo check**

Run: `cargo check`
Expected: Clean compilation

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/app.js src/dashboard/shell.html
git commit -m "feat: add settings history button and panel to dashboard"
```

---

### Task 8: Wire unknown stop reason tracking in proxy

**Files:**
- Modify: `src/proxy.rs`
- Modify: `src/types.rs`

- [ ] **Step 1: Remove #[allow(dead_code)] from types.rs**

In `src/types.rs`, remove these two `#[allow(dead_code)]` annotations:

Line 99: Remove `#[allow(dead_code)] // Used in tests; will be wired when stop-reason tracking lands` before `KNOWN_STOP_REASONS`.

Line 127: Remove `#[allow(dead_code)] // Used in tests; will be wired when stop-reason tracking lands` before `record_unknown_stop_reason`.

- [ ] **Step 2: Call record_unknown_stop_reason in proxy.rs**

In `src/proxy.rs`, in the `process_sse_line` function (around line 496–498), after the `stop_reason` extraction:

```rust
if let Some(reason) = data.get("stop_reason").and_then(|v| v.as_str()) {
    *stop_reason = Some(reason.to_string());
    unknown_fields.record_unknown_stop_reason(reason);
}
```

The `unknown_fields` parameter is already available in `process_sse_line` as a mutable reference — check the function signature. It's threaded through the SSE processing chain the same way `tool_uses` is.

If `unknown_fields` is not already a parameter of `process_sse_line`, find where `record_unknown_event` is called in the same function — `unknown_fields` is available at that scope. Add the `record_unknown_stop_reason` call right after the stop_reason extraction using the same reference.

- [ ] **Step 3: Run cargo check and tests**

Run: `cargo check && cargo test --lib types::tests`
Expected: Clean compilation, all types tests pass

- [ ] **Step 4: Commit**

```bash
git add src/proxy.rs src/types.rs
git commit -m "feat: wire unknown stop reason tracking in SSE handler"
```

---

### Task 9: Dead code cleanup

**Files:**
- Modify: `src/store.rs`
- Modify: `src/stats.rs`
- Modify: `src/main.rs`

- [ ] **Step 1: Remove dead sessions table from store.rs**

In `src/store.rs`, in `initialize_schema()` (line 143–151), remove the `CREATE TABLE IF NOT EXISTS sessions (...)` block:

```sql
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                first_seen_ms INTEGER NOT NULL,
                last_seen_ms INTEGER NOT NULL,
                request_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                total_input_tokens INTEGER NOT NULL DEFAULT 0,
                total_output_tokens INTEGER NOT NULL DEFAULT 0
            );
```

- [ ] **Step 2: Update the test that asserts sessions table exists**

In `src/store.rs` tests, find the test that asserts `sessions` is in the table list (around line 685). Remove `"sessions"` from the expected tables list. The test should check for: `requests`, `request_bodies`, `request_bodies_fts`, `tool_usage`, `anomalies`, `model_profiles`.

- [ ] **Step 3: Remove EntryFilter::matches() from stats.rs**

In `src/stats.rs`, find and remove the `EntryFilter::matches()` method (around line 3986–4040). It has `#[allow(dead_code)]` and is never called in production.

- [ ] **Step 4: Remove storage_dir field from StatsStore in stats.rs**

In `src/stats.rs`:
- Remove `storage_dir: PathBuf` from the `StatsStore` struct (line ~369)
- Remove `storage_dir,` from the `Self { ... }` block in `new()` (line ~399)
- Keep `let _ = std::fs::create_dir_all(&storage_dir);` (line ~392) — it still creates the dir
- Remove the `storage_dir: PathBuf` parameter from `new()` (line ~386) — but WAIT: check if any callers pass it. In `main.rs` line 116–123, `StatsStore::new()` is called with `data_dir.clone()` as a parameter. We need to remove that argument from the call site too.

Actually, looking more carefully: `storage_dir` is a constructor parameter, not just a field. We need to:
1. Remove the field from the struct
2. Keep the `let _ = std::fs::create_dir_all(&storage_dir);` line but make `storage_dir` a local only
3. Remove `storage_dir` from the `Self { ... }` return
4. The constructor signature stays the same (it still receives the path for dir creation)

Wait — looking again at the constructor, `storage_dir` is a named parameter that flows into the struct field. The simplest fix: keep the parameter but don't store it:

In the constructor `new()`, change the `Self { ... }` block to remove `storage_dir,` but keep everything else. The `storage_dir` parameter is still used for `create_dir_all` and `db_path` computation before the struct construction.

- [ ] **Step 5: Remove blanket #[allow(dead_code)] from main.rs**

In `src/main.rs` line 7, remove:
```rust
#[allow(dead_code)] // Many methods are test infrastructure or scaffolded for future wiring
```

After removing this, run `cargo check` to see what warnings appear. Add targeted `#[allow(dead_code)]` only on items that are genuinely test-only infrastructure in stats.rs (like `delete_settings_history_item`, `clear_settings_history`, `persisted_entry_count`).

- [ ] **Step 6: Run cargo check and fix any warnings**

Run: `cargo check 2>&1 | grep "warning\[dead_code\]"`

For each warning, decide:
- If the item is test infrastructure → add targeted `#[allow(dead_code)]`
- If the item should be wired → investigate (shouldn't happen at this point)

- [ ] **Step 7: Run full test suite**

Run: `cargo test`
Expected: All tests pass (164+)

- [ ] **Step 8: Commit**

```bash
git add src/store.rs src/stats.rs src/main.rs
git commit -m "chore: remove dead code - sessions table, EntryFilter::matches, storage_dir field, blanket allow"
```

---

### Task 10: Final verification and format

**Files:**
- All modified files

- [ ] **Step 1: Run cargo fmt**

Run: `cargo fmt`

- [ ] **Step 2: Run cargo clippy**

Run: `cargo clippy -- -D warnings 2>&1 | head -50`

Fix any clippy warnings.

- [ ] **Step 3: Run full test suite**

Run: `cargo test`
Expected: All tests pass

- [ ] **Step 4: Verify model config loads**

Run: `cargo run -- --target https://api.anthropic.com --model-config model-config.sample.json 2>&1 | head -20`
Expected: See "Loaded model config from model-config.sample.json (11 mappings, 3 profiles)" in output, then the normal banner.

Press Ctrl+C to stop.

- [ ] **Step 5: Verify no "not wired" messages remain**

Run: `grep -r "not wired" src/`
Expected: No matches

- [ ] **Step 6: Verify no stale allow(dead_code) on wired items**

Run: `grep -n "allow(dead_code)" src/model_profile.rs src/types.rs`
Expected: No matches (all items now wired)

- [ ] **Step 7: Commit any formatting/clippy fixes**

```bash
git add -A
git commit -m "chore: fmt, clippy, final verification"
```

- [ ] **Step 8: Push**

```bash
git push origin master
```
