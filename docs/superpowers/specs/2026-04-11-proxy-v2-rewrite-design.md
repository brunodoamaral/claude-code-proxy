# Claude Proxy v2 — Full Rewrite Design Spec

**Date:** 2026-04-11
**Status:** Approved (design phase)

## 1) Objective

Rewrite the Claude Code proxy from a multi-concern observability tool into a focused **proxy-only request analysis platform**. The system intercepts all Claude Code API traffic, persists it with full-text search, detects anomalies with hypothesis generation, and scores model behavioral conformance against a 140-parameter fingerprint.

**What this is:** A developer tool that sits between Claude Code and the Anthropic API, capturing every request/response for analysis, search, and quality monitoring.

**What this is NOT:** A local filesystem scanner, settings editor, or correlation engine. All intelligence derives from proxy wire data only.

## 2) Architecture

### Single Binary, Modular Internals (Monolithic Axum)

One Rust binary with clear module boundaries:

```
src/
├── main.rs           — CLI args, worker spawning, shutdown
├── proxy.rs          — HTTP proxy handler (evolved from current)
├── store.rs          — SQLite persistence, FTS5 search, queries
├── analyzer.rs       — Anomaly detection + conformance engine
├── model_profile.rs  — Model mapping config, auto-tuning logic
├── dashboard.rs      — Axum routes, REST API, WebSocket
├── dashboard.html    — Embedded SPA (complete rewrite)
└── types.rs          — Shared DTOs, enums, serialization
```

### Request Flow

```
Claude Code → proxy.rs (port 8000)
  ├─ Capture request metadata + full body
  ├─ Forward to upstream API (Anthropic / custom)
  ├─ Capture response (SSE streaming or JSON)
  ├─ Compute TTFT, stalls, duration, tokens
  ├─ Parse tool calls, content blocks, stop reason
  └─ store.add_request(entry, bodies, tool_usage)
        ├─ INSERT into requests + request_bodies
        ├─ INSERT parsed tool calls into tool_usage
        ├─ Update FTS5 index
        ├─ Upsert sessions aggregate
        └─ Broadcast to WebSocket subscribers

Background analyzer worker (every 5s):
  ├─ Pick unanalyzed requests
  ├─ Run anomaly detection (thresholds, patterns)
  ├─ Run conformance check against model profiles
  ├─ Generate hypotheses for detected anomalies
  ├─ INSERT into anomalies table
  └─ Update model profile observed statistics (auto-tuning)
```

### What Gets Dropped From Current Codebase

| Removed Module | Reason |
|----------------|--------|
| `local_context.rs` | No local file scanning |
| `correlation_engine.rs` | Replaced by analyzer (proxy-only data) |
| `correlation.rs` | No local event correlation |
| `explainer.rs` | Absorbed into analyzer |
| `settings_admin.rs` | No settings editor |
| `session_admin.rs` | No session deletion management |
| `stats.rs` (7300 lines) | Replaced by focused `store.rs` |

### What Gets Kept

`proxy.rs` — the HTTP proxy handler. It works well (SSE streaming, stall detection, metric capture). Will be evolved to extract additional fields (content block types, tool calls, stop reasons, thinking tokens) but the core proxy-forward-capture flow stays.

## 3) Data Model

### SQLite with FTS5

Single database file. All tables below.

#### `requests` — Every proxied API call

```sql
CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    timestamp_ms INTEGER NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    stream INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER,
    status_kind TEXT NOT NULL DEFAULT 'pending',
    ttft_ms REAL,
    duration_ms REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER,
    thinking_tokens INTEGER,
    request_size_bytes INTEGER,
    response_size_bytes INTEGER,
    stall_count INTEGER NOT NULL DEFAULT 0,
    stall_details_json TEXT NOT NULL DEFAULT '[]',
    error_summary TEXT,
    stop_reason TEXT,
    content_block_types_json TEXT NOT NULL DEFAULT '[]',
    anomalies_json TEXT NOT NULL DEFAULT '[]',
    analyzed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_requests_timestamp ON requests(timestamp_ms DESC);
CREATE INDEX idx_requests_session ON requests(session_id);
CREATE INDEX idx_requests_model ON requests(model);
CREATE INDEX idx_requests_analyzed ON requests(analyzed) WHERE analyzed = 0;
```

#### `request_bodies` — Full payloads (separate for query performance)

```sql
CREATE TABLE request_bodies (
    request_id TEXT PRIMARY KEY REFERENCES requests(id),
    request_body TEXT,
    response_body TEXT,
    truncated INTEGER NOT NULL DEFAULT 0
);
```

#### `request_bodies_fts` — Full-text search

```sql
CREATE VIRTUAL TABLE request_bodies_fts USING fts5(
    request_id,
    request_body,
    response_body,
    content=request_bodies,
    content_rowid=rowid
);
```

#### `tool_usage` — Parsed tool calls

```sql
CREATE TABLE tool_usage (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id),
    tool_name TEXT NOT NULL,
    tool_input_json TEXT,
    success INTEGER,
    is_error INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_tool_usage_request ON tool_usage(request_id);
CREATE INDEX idx_tool_usage_name ON tool_usage(tool_name);
```

#### `anomalies` — Detected issues with hypotheses

```sql
CREATE TABLE anomalies (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id),
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    summary TEXT NOT NULL,
    hypothesis TEXT,
    evidence_json TEXT NOT NULL DEFAULT '{}',
    created_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_anomalies_request ON anomalies(request_id);
CREATE INDEX idx_anomalies_kind ON anomalies(kind);
CREATE INDEX idx_anomalies_severity ON anomalies(severity);
```

#### `model_profiles` — Behavioral fingerprint per model

```sql
CREATE TABLE model_profiles (
    model_name TEXT PRIMARY KEY,
    behavior_class TEXT,
    config_json TEXT NOT NULL DEFAULT '{}',
    observed_json TEXT NOT NULL DEFAULT '{}',
    sample_count INTEGER NOT NULL DEFAULT 0,
    last_updated_ms INTEGER
);
```

`config_json` holds the static reference expectations. `observed_json` holds the auto-tuned observed statistics (all 140 parameters). Both are JSON objects keyed by parameter name.

#### `sessions` — Aggregated session state

```sql
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    first_seen_ms INTEGER NOT NULL,
    last_seen_ms INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    total_input_tokens INTEGER NOT NULL DEFAULT 0,
    total_output_tokens INTEGER NOT NULL DEFAULT 0
);
```

## 4) Analysis Engine

### Anomaly Detection

Runs against each unanalyzed request. Checks configurable thresholds:

| Anomaly Kind | Detection Logic | Default Severity |
|-------------|----------------|-----------------|
| `slow_ttft` | TTFT > threshold (configurable, default 3s) | warning (>3s), error (>8s) |
| `stall` | Any streaming gap > stall threshold | warning |
| `timeout` | No response in timeout window | error |
| `api_error` | Status 500-599 | error |
| `client_error` | Status 400-499 (excluding 429) | warning |
| `rate_limited` | Status 429 | info |
| `overload` | Status 529 | warning |
| `high_tokens` | Output tokens > p95 for model | warning |
| `cache_miss` | cache_read=0 when previous request had cache | warning |
| `interrupted_stream` | SSE stream without message_stop | error |
| `max_tokens_hit` | stop_reason=max_tokens | info |

### Hypothesis Generation

For each anomaly, generate a contextual explanation using request data + recent history:

```
Anomaly: slow_ttft (4200ms)
Hypothesis: "TTFT 4.2s exceeds 3s threshold. Model claude-3-5-sonnet 
typically responds in 800-1500ms (observed avg: 920ms over last 50 requests).
Possible causes: large context window (input_tokens: 45,000), rate limiting
backoff (previous request was 429), or API degradation (3 other slow requests
in last 60s)."
```

Hypotheses use: current request metrics, model profile observed averages, recent request history (last N requests), session context (position in conversation).

### Health Score

Composite 0-100 score computed from recent requests (last 100 or last hour, whichever is smaller):

- Start at 100
- `-5` per error (5xx, timeout, connection error)
- `-2` per warning anomaly (slow_ttft, stall, cache_miss)
- `-1` per info anomaly (rate_limited, max_tokens_hit)
- `-10` per critical (consecutive errors > 3, conformance < 50%)
- Floor at 0

Labels: 90-100 Excellent, 75-89 Good, 50-74 Fair, 25-49 Poor, 0-24 Critical.

### Behavioral Conformance Engine

Compares observed model behavior against reference profiles across 140 parameters in 13 categories.

#### The 13 Fingerprint Categories

**Category 1: Latency & Timing (12 parameters)**

1. `avg_ttft_ms` — Mean time to first token
2. `median_ttft_ms` — P50 TTFT
3. `p95_ttft_ms` — P95 TTFT
4. `p99_ttft_ms` — P99 TTFT
5. `min_ttft_ms` — Fastest response
6. `max_ttft_ms` — Slowest response
7. `ttft_stddev_ms` — TTFT consistency
8. `avg_duration_ms` — Total request wall time
9. `tokens_per_second` — Output generation throughput
10. `avg_inter_chunk_ms` — Mean gap between SSE chunks
11. `chunk_timing_variance` — Regularity of token delivery
12. `ttft_vs_context_correlation` — How latency scales with context size

**Category 2: Thinking Behavior (10 parameters)**

13. `thinking_frequency` — % of responses with thinking blocks
14. `avg_thinking_tokens` — Mean thinking block size
15. `median_thinking_tokens` — P50 thinking size
16. `thinking_token_ratio` — thinking / output_tokens proportion
17. `thinking_depth_by_complexity` — Does thinking scale with input
18. `redacted_thinking_frequency` — % with redacted thinking
19. `thinking_before_tool_rate` — Thinks before calling tools
20. `thinking_per_turn_variance` — Consistency of thinking depth
21. `max_thinking_tokens` — Upper bound observed
22. `effort_response_correlation` — Does thinking change with effort param

**Category 3: Token Economics (14 parameters)**

23. `avg_input_tokens` — Mean context window usage
24. `avg_output_tokens` — Mean response length
25. `median_output_tokens` — P50 response length
26. `p95_output_tokens` — P95 response length
27. `output_input_ratio` — Response density
28. `max_tokens_hit_rate` — % truncated by limit
29. `cache_creation_rate` — How often cache entries created
30. `cache_hit_rate` — Cache efficiency ratio
31. `avg_cache_read_tokens` — Mean cached context reuse
32. `cache_miss_after_hit_rate` — Unexpected cache invalidations
33. `total_tokens_per_request` — Full cost per interaction
34. `output_token_consistency` — Response length variance
35. `token_efficiency` — Useful output / total output
36. `context_window_utilization` — How close to context limit

**Category 4: Tool Usage Behavior (16 parameters)**

37. `tool_call_rate` — % of turns calling tools
38. `tools_per_turn` — Average tool calls per response
39. `max_tools_per_turn` — Peak tool parallelism
40. `multi_tool_rate` — % with 2+ tool calls
41. `unique_tool_diversity` — Distinct tools / available tools
42. `tool_preference_distribution` — Gini coefficient of tool usage
43. `tool_chain_depth` — Sequential tool→result→tool turns
44. `max_tool_chain_depth` — Deepest tool chain observed
45. `tool_success_rate` — Successful results / total calls
46. `tool_retry_rate` — Re-calls same tool after failure
47. `tool_adaptation_rate` — Tries different tool after failure
48. `tool_input_avg_size` — Complexity of tool invocations
49. `tool_call_position` — Where in response tools appear
50. `text_before_tool_ratio` — How much explanation before acting
51. `tool_use_after_thinking` — Thinks then acts pattern
52. `deferred_tool_usage` — Dynamic tool discovery usage

**Category 5: Response Structure (14 parameters)**

53. `avg_content_blocks` — Blocks per response
54. `max_content_blocks` — Peak response complexity
55. `text_block_count_avg` — Mean text segments
56. `avg_text_block_length` — Text segment token count
57. `block_type_distribution` — Content composition frequencies
58. `stop_reason_distribution` — How responses end
59. `end_turn_rate` — % natural completions
60. `code_in_response_rate` — % containing code blocks
61. `markdown_usage_rate` — % using structured formatting
62. `response_structure_variance` — Block pattern variety
63. `multi_text_block_rate` — Segmented vs monolithic
64. `interleaved_thinking_rate` — Thinking between other blocks
65. `citations_frequency` — Citation usage
66. `connector_text_frequency` — Internal connector usage

**Category 6: Streaming Quality (12 parameters)**

67. `stall_rate` — Streaming interruption frequency
68. `avg_stall_duration_ms` — Mean stall length
69. `max_stall_duration_ms` — Worst stall
70. `stalls_per_request` — Stall density when stalling
71. `stall_position_distribution` — Where stalls occur in stream
72. `stream_completion_rate` — % with message_stop
73. `interrupted_stream_rate` — Premature terminations
74. `ping_frequency` — Keepalive pattern
75. `avg_chunks_per_response` — Streaming granularity
76. `bytes_per_chunk_avg` — Chunk size distribution
77. `first_content_event_ms` — Time to first content_block_start
78. `stream_warmup_pattern` — Initial streaming acceleration

**Category 7: Error & Resilience (12 parameters)**

79. `error_rate` — Overall error frequency
80. `server_error_rate` — API-side failures (5xx)
81. `rate_limit_rate` — Throttling frequency (429)
82. `overload_rate` — API overload (529)
83. `client_error_rate` — Bad requests (4xx excl 429)
84. `timeout_rate` — Connection timeouts
85. `connection_error_rate` — Network-level failures
86. `error_type_distribution` — Error type breakdown
87. `refusal_rate` — Content policy refusals
88. `error_recovery_rate` — Success after error
89. `consecutive_error_max` — Longest error streak
90. `error_time_clustering` — Do errors cluster in bursts

**Category 8: Session Behavior (10 parameters)**

91. `avg_requests_per_session` — Session length
92. `session_duration_avg_ms` — Session time span
93. `inter_request_gap_avg_ms` — Time between turns
94. `inter_request_gap_variance` — Interaction rhythm consistency
95. `context_growth_rate` — How fast context accumulates
96. `conversation_depth_avg` — Average turns per session
97. `session_error_clustering` — Error distribution across sessions
98. `session_tool_evolution` — Tool diversity over conversation
99. `session_ttft_trend` — Latency change with context growth
100. `session_token_trend` — Response length change over session

**Category 9: Request Composition (10 parameters)**

101. `system_prompt_frequency` — % with system prompts
102. `system_prompt_avg_size` — System prompt token estimate
103. `avg_message_count` — Conversation history depth
104. `tools_provided_avg` — Average tools available
105. `tool_choice_distribution` — auto vs specific tool
106. `temperature_distribution` — Sampling temperature usage
107. `max_tokens_setting_avg` — Token limit configuration
108. `image_input_rate` — Multimodal usage
109. `document_input_rate` — File/PDF input frequency
110. `request_body_avg_bytes` — Request payload size

**Category 10: Effort & Instruction Compliance (8 parameters)**

111. `effort_param_usage` — % using effort control
112. `effort_thinking_correlation` — Thinking depth vs effort level
113. `effort_output_correlation` — Output length vs effort level
114. `effort_ttft_correlation` — Latency vs effort level
115. `speed_mode_usage` — % using fast mode
116. `speed_mode_ttft_impact` — Fast mode latency improvement
117. `speed_mode_quality_impact` — Fast mode thoroughness impact
118. `task_budget_usage` — % using task budgets

**Category 11: Caching Behavior (8 parameters)**

119. `cache_control_usage_rate` — % using prompt caching
120. `cache_scope_global_rate` — % using global scope
121. `cache_ttl_1h_rate` — % using extended TTL
122. `cache_edit_usage_rate` — % using cache editing
123. `cache_cost_savings_ratio` — Cost reduction from caching
124. `cache_stability` — Consecutive hits before miss
125. `cache_warmup_requests` — Requests until first hit
126. `cache_invalidation_pattern` — What triggers misses

**Category 12: Header & Protocol Metadata (8 parameters)**

127. `beta_features_count` — Beta feature adoption
128. `beta_feature_set` — Which betas active
129. `custom_headers_present` — Custom configuration
130. `anthropic_version` — API version
131. `provider_type` — First-party vs Bedrock vs Vertex
132. `auth_method` — OAuth vs API key
133. `request_id_tracking` — Client-side correlation
134. `response_request_id` — Server correlation

**Category 13: Auto-Discovered / Forward-Compatible (6 parameters)**

135. `unknown_sse_event_types` — New streaming events
136. `unknown_content_block_types` — New content formats
137. `unknown_request_fields` — New API parameters
138. `unknown_header_patterns` — New protocol signals
139. `unknown_stop_reasons` — New completion modes
140. `unknown_delta_types` — New streaming delta formats

#### Conformance Scoring

Each category is scored independently (0-100%) by comparing observed values against reference profile expectations. Overall conformance is a weighted average.

Output format: `"Your model matches opus-class at 78% — strong in tool usage (92%) and thinking (85%), weak in streaming quality (54%) and effort compliance (41%)"`

#### Model Profile Configuration

Stored in `model-profiles.json`, loaded at startup, editable via API:

```json
{
  "profiles": {
    "opus": {
      "expected_ttft_range_ms": [1000, 8000],
      "expected_thinking_ratio": [0.15, 0.40],
      "expected_tool_usage_rate": [0.50, 0.70],
      "expected_output_input_ratio": [0.20, 0.50]
    },
    "sonnet": {
      "expected_ttft_range_ms": [300, 3000],
      "expected_thinking_ratio": [0.03, 0.15],
      "expected_tool_usage_rate": [0.30, 0.50],
      "expected_output_input_ratio": [0.15, 0.35]
    },
    "haiku": {
      "expected_ttft_range_ms": [100, 1000],
      "expected_thinking_ratio": [0.0, 0.05],
      "expected_tool_usage_rate": [0.20, 0.40],
      "expected_output_input_ratio": [0.10, 0.25]
    }
  },
  "model_mappings": {
    "claude-opus-4-*": "opus",
    "claude-sonnet-4-*": "sonnet",
    "claude-haiku-3-*": "haiku",
    "my-custom-model": "opus"
  }
}
```

Auto-tuning: after every 50 requests for a model, recalculate observed statistics and adjust expected ranges to reduce false positives while preserving sensitivity to real deviations.

#### Forward Compatibility

The proxy is protocol-agnostic by design:
- Raw request/response bodies are always stored verbatim
- Known fields are parsed opportunistically — unknown fields are preserved, not rejected
- Category 13 automatically detects and logs new SSE event types, content block types, request fields, headers, stop reasons, and delta types
- Model profiles are built from observation, not hardcoded expectations
- If Claude Code updates its wire protocol, the proxy continues to work and captures the new data for future analysis

## 5) Dashboard

### Layout: Single-Page Report Card (Overview) + 4 Detail Tabs

**5 tabs total:** Overview | Requests | Model Conformance | Anomalies | Sessions

### Tab: Overview (Report Card)

Single scrollable page with sections:

1. **Health Score Banner** — 0-100 score with label (Critical/Poor/Fair/Good/Excellent), request count, issue count, critical count
2. **Issues Summary** — grouped anomaly counts with severity badges
3. **Model Conformance Scoreboard** — each observed model with conformance %, weak categories flagged
4. **Key Metrics Row** — TTFT avg, total tokens, error count, stall count, cache hit rate
5. **Recent Anomalies** — timestamped list with severity, kind, summary, affected request link

### Tab: Requests

- Sortable, paginated table: Time | Status | TTFT | Duration | Model | Tokens | Tools | Stalls | Session
- **Full-text search** across request/response bodies via FTS5
- **Filters**: model, status kind, session, anomaly type, date range
- **Request detail panel** (click to expand): full request/response bodies with syntax highlighting, parsed tool calls, content block breakdown, token usage, anomalies for this request

### Tab: Model Conformance

- **Model list** with conformance % and behavior class mapping
- **Profile detail view**: 13-category breakdown with per-category scores
- **Parameter-by-parameter table**: observed value vs expected range, pass/fail
- **Trend over time**: conformance score chart as more requests are observed
- **Config editor**: edit model mappings and reference profiles

### Tab: Anomalies & Hypotheses

- **Timeline view**: anomalies in chronological order
- **Severity filter**: critical / error / warning / info
- **Kind filter**: slow_ttft, stall, cache_miss, etc.
- **Each anomaly shows**: timestamp, severity badge, kind, summary, hypothesis text, link to affected request
- **Pattern grouping**: cluster anomalies by root cause when multiple share a common pattern

### Tab: Sessions

- **Session list**: session ID, request count, error count, duration, total tokens
- **Session detail**: request timeline, tool usage progression, token accumulation, per-session anomalies
- **TTFT trend chart**: latency over the session lifetime (shows context growth impact)

## 6) API Endpoints

### Overview
- `GET /api/health` — health score, key metrics, issue count, conformance summary
- `GET /api/anomalies/recent?limit=N` — latest anomalies with hypotheses

### Requests
- `GET /api/requests?limit=&offset=&session=&model=&status=&q=` — paginated, filterable, FTS5 search
- `GET /api/requests/:id` — full detail with parsed body
- `GET /api/requests/:id/body` — raw request/response bodies
- `GET /api/requests/:id/tools` — parsed tool usage

### Model Conformance
- `GET /api/models` — all observed models with conformance scores
- `GET /api/models/:name/profile` — full 140-parameter fingerprint
- `GET /api/models/:name/comparison` — side-by-side vs reference class
- `GET /api/model-config` — current model mappings config
- `PUT /api/model-config` — update model mappings

### Anomalies
- `GET /api/anomalies?limit=&offset=&kind=&severity=&model=` — paginated list
- `GET /api/anomalies/:id` — detail with hypothesis and affected request

### Sessions
- `GET /api/sessions?limit=&offset=` — session list with aggregates
- `GET /api/sessions/:id` — session detail with request timeline

### WebSocket
- `WS /ws` — real-time push: new requests, anomalies, health score updates

## 7) Implementation Phases

**Phase 1 — Foundation**
- New `types.rs` with all DTOs and enums
- New `store.rs` with SQLite schema, FTS5, CRUD operations
- Refactor `proxy.rs` to use new store, extract additional fields (content blocks, tool calls, stop reason, thinking tokens)
- Remove all dropped modules
- Basic test suite for store operations

**Phase 2 — Analysis Engine**
- `analyzer.rs`: anomaly detection with configurable thresholds, hypothesis generation
- `model_profile.rs`: config loading, conformance scoring across 13 categories, auto-tuning
- Background worker integration in `main.rs`
- Tests for anomaly detection and conformance scoring

**Phase 3 — Dashboard API**
- New `dashboard.rs` with all REST endpoints
- WebSocket real-time push
- Health score computation
- Tests for all endpoints

**Phase 4 — Frontend**
- Complete `dashboard.html` rewrite
- Overview report card
- Request explorer with FTS search
- Model conformance scoreboard with parameter detail
- Anomaly timeline with hypotheses
- Session viewer
- WebSocket integration for live updates

**Phase 5 — Polish**
- Enhanced proxy field extraction (SSE event parsing for all block types)
- Forward-compatibility logging (unknown fields)
- Documentation
- Integration tests

## 8) Tech Stack

- **Runtime**: Rust, Tokio async
- **Web**: Axum (HTTP + WebSocket), Tower-HTTP (CORS)
- **Proxy**: Reqwest HTTP client
- **Storage**: Rusqlite (bundled SQLite) with FTS5
- **Serialization**: Serde, serde_json
- **Frontend**: Vanilla HTML/CSS/JS embedded SPA (no build step)
- **Charts**: Chart.js (CDN)

## 9) CLI Arguments

```
claude-proxy
  --target <url>              Upstream API URL (required)
  --port <port>               Proxy port (default: 8000)
  --dashboard-port <port>     Dashboard port (default: 3000)
  --data-dir <path>           Storage directory (default: ~/.claude-proxy)
  --model-config <path>       Model profiles config (default: data-dir/model-profiles.json)
  --stall-threshold <secs>    Stall detection threshold (default: 0.5)
  --slow-ttft-threshold <ms>  TTFT anomaly threshold (default: 3000)
  --max-body-size <bytes>     Max stored body size (default: 2MB)
  --open-browser              Auto-open dashboard on start
```

## 10) Success Criteria

1. All Claude Code API traffic is captured transparently with zero impact on latency
2. Full-text search across request/response bodies returns results in <100ms
3. Anomalies are detected and hypothesized within 5s of request completion
4. Model conformance scores update incrementally with each new request
5. Dashboard overview loads in <200ms with a complete health report
6. Unknown/new API fields are preserved and logged, not rejected
7. The proxy works with any model provider reachable via ANTHROPIC_BASE_URL
