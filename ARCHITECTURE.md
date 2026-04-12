# ClaudeProxy: Architecture Document

**Version:** 2.1
**Date:** April 2026
**Language:** Rust (Edition 2021)

---

## Runtime Components

main() starts:
1. **Proxy Server** (Axum on :8000) — intercepts Claude Code API requests
2. **Dashboard Server** (Axum on :3000) — REST API + WebSocket + embedded SPA
3. **Analyzer Worker** (5s tick) — background anomaly detection and model profiling

---

## Proxy Request Flow

```
Request → Bind :8000 → Parse metadata (model, stream, session_id from body + X-Claude-Code-Session-Id header)
→ Forward headers to upstream → Send request → Handle response:

1. ERROR (status ≥ 400): Read body, summarize, record to both stores
2. SSE STREAMING: Spawn task, detect stalls, extract usage, track unknown events, write to both stores
3. REGULAR JSON: Read body, parse JSON for usage, record to both stores

→ Response back to client
```

---

## Database Schemas

### Stats DB (proxy.db in data_dir)

```
requests: id, timestamp_ms, session_id, method, path, model, stream, status,
          ttft_ms, duration_ms, tokens, sizes, error, anomalies

request_bodies: request_id, request_body, response_body, truncated

local_events: id, source_kind, source_path, event_time_ms, session_hint,
              event_kind, payload_json

request_correlations: request_id, local_event_id, link_type, confidence, reason
```

### V2 Store (proxy-v2.db in data_dir)

```
requests: id, session_id, timestamp, method, path, model, stream, status_code,
          status_kind, ttft_ms, duration_ms, tokens, sizes, stalls, error,
          stop_reason, content_block_types, anomalies, analyzed

request_bodies: request_id, request_body, response_body, truncated
request_bodies_fts: FTS5 virtual table synced via triggers

anomalies: id, request_id, kind, severity, summary, hypothesis, detected_at

model_profiles: model, sample_count, last_updated
model_observed: model, observed_json, updated_at

sessions: session_id, first_seen, last_seen, request_count
tool_usage: id, request_id, tool_name, tool_input_json
settings_history: id, saved_at_ms, content_hash, settings_json, source
```

---

## Dashboard Architecture

Single-page app assembled at compile time from `src/dashboard/` files.

**Dashboard State:** `DashboardState { stats: Arc<StatsStore>, store: Arc<Store>, model_config: Option<Arc<ModelConfig>> }` — dual-store
architecture with optional model config giving handlers access to both the real-time stats DB, the V2 analysis DB, and expected baselines for conformance comparison.

### File Structure

```
src/dashboard/
├── shell.html              # HTML skeleton with {placeholders} for format!()
├── styles.css              # All CSS (normal braces — not a format! template)
├── app.js                  # DOMContentLoaded wiring, settings editor
├── utils.js                # Shared helpers: fmt, esc, formatDuration, etc.
├── components/
│   ├── charts.js           # Chart.js lifecycle + chartDefaults config
│   └── websocket.js        # WebSocket connection + reconnect
└── tabs/
    ├── overview.js          # Stat cards, timeseries, breakdowns
    ├── requests.js          # Table, search, filters, modal, correlations
    ├── conformance.js       # Model scoreboard (placeholder)
    ├── anomalies.js         # Anomaly list with severity badges
    └── sessions.js          # Split layout, timeline, conversation
```

### Assembly

`dashboard.rs` calls `assemble_dashboard_html()` which uses Rust's `format!()` macro
with `include_str!()` to inline all 10 files into a single HTML response at compile time:

```rust
format!(include_str!("dashboard/shell.html"),
    css          = include_str!("dashboard/styles.css"),
    utils_js     = include_str!("dashboard/utils.js"),
    charts_js    = include_str!("dashboard/components/charts.js"),
    websocket_js = include_str!("dashboard/components/websocket.js"),
    overview_js  = include_str!("dashboard/tabs/overview.js"),
    requests_js  = include_str!("dashboard/tabs/requests.js"),
    conformance_js = include_str!("dashboard/tabs/conformance.js"),
    anomalies_js = include_str!("dashboard/tabs/anomalies.js"),
    sessions_js  = include_str!("dashboard/tabs/sessions.js"),
    app_js       = include_str!("dashboard/app.js"),
)
```

**Key detail:** `format!()` only interprets `{name}` placeholders in the template string
(shell.html). Named arguments (CSS/JS files) are substituted verbatim — their braces are
NOT interpreted. Only shell.html needs `{{`/`}}` for literal braces.

Result: Single HTML response served at `GET /`.

### Dashboard File Sizes

| File | Lines | Role |
|------|-------|------|
| `tabs/requests.js` | 791 | Request table, filters, modal, correlations |
| `tabs/sessions.js` | 456 | Session explorer, timeline, conversation |
| `app.js` | 458 | Init wiring, settings editor, tab switching |
| `styles.css` | 375 | All CSS styles |
| `shell.html` | 294 | HTML skeleton |
| `tabs/overview.js` | 247 | Stat cards, charts, breakdowns |
| `utils.js` | 147 | Shared helpers and constants |
| `components/charts.js` | 74 | Chart.js wrappers |
| `components/websocket.js` | 42 | WebSocket connection + anomaly render trigger |
| `tabs/conformance.js` | 68 | Model scoreboard with profiles |
| `tabs/anomalies.js` | 46 | Anomaly list with severity badges |
| **Total** | **2,999** | |

### Tabs

5 tabs (all fully functional):
- **Overview** — health score, stat cards, timeseries charts, model/error breakdowns
- **Requests** — sortable table, search, filters, modal with body viewer, explanations, tool usage
- **Model Conformance** — model scoreboard with request counts, avg TTFT, error rates, expected vs observed baselines with deviation colors, profiling status
- **Anomalies** — severity-badged anomaly feed with click-to-focus request filtering
- **Sessions** — split layout browser with session list, detail panel, timeline, conversation preview

### Frontend Stack

- **Vanilla JS** — no framework (no React, no Vue, no Alpine.js)
- **Chart.js 4** (CDN) — TTFT and error timeseries charts
- **WebSocket** — real-time stats streaming from `/ws`

---

## Source Modules

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `stats.rs` | ~7,350 | Stats store, live stats, session aggregation, DB schema |
| `dashboard.rs` | ~2,300 | Axum routes, REST API, WebSocket, HTML assembly, dual-store state |
| `store.rs` | ~1,000 | V2 SQLite store, FTS5, CRUD, tool usage, anomaly lookup |
| `proxy.rs` | ~870 | HTTP proxy, SSE streaming, request forwarding, tool extraction, V2 store wiring |
| `main.rs` | ~580 | CLI, runtime orchestration, analyzer worker, explanation integration, auto-configure, graceful shutdown |
| `analyzer.rs` | ~383 | All 11 anomaly detection rules (SlowTtft, Stall, Timeout, ApiError, ClientError, RateLimited, Overload, HighTokens, CacheMiss, InterruptedStream, MaxTokensHit) |
| `explain.rs` | ~240 | Rule-based explanation generator for anomalies |
| `correlation.rs` | ~218 | Correlation engine: temporal, session, config-drift linking |
| `types.rs` | ~206 | V2 types, forward-compat tracking |
| `model_profile.rs` | ~190 | Model config loading, behavior class resolution, fingerprint parameter names, auto-tune |

---

## Analyzer Worker

Runs every 5 seconds:
1. Fetch up to 200 unanalyzed requests from V2 store
2. For each: detect anomalies (all 11 rules) against recent model history
3. Persist anomalies atomically (transaction: delete prior → insert new → mark analyzed)
4. At 50-sample boundaries: compute and store model observed stats
5. Generate explanations for requests with anomalies → write to Stats store
6. Run correlation engine (temporal, session, config-drift) → write to Stats store
7. Check `~/.claude/settings.json` for changes → snapshot to settings history if hash changed

---

## Key Metrics Per Request

RequestEntry captures:
- Identification: id, timestamp, session_id, method, path, model, stream
- Status: status, duration_ms, ttft_ms
- Tokens: input, output, cache_read, cache_creation, thinking
- Sizes: request_size_bytes, response_size_bytes
- Quality: stalls (array), error message, anomalies (array), stop_reason

---

## Build

### Windows
```
build.bat          # → target\release\claude-proxy.exe
```

### Cross-platform
```
cargo build --release
```

Release profile: LTO enabled, single codegen unit, symbols stripped.

---

## Dependencies

Runtime: tokio, axum, hyper, reqwest (proxy), rusqlite (SQLite)
Serialization: serde, serde_json, chrono
CLI: clap, uuid, dirs, parking_lot
Streaming: futures-util, tokio-stream
Frontend: Chart.js (CDN)

---

## CI/CD

GitHub Actions workflow (`.github/workflows/release.yml`):
- **Trigger:** Push a `v*` tag
- **Runner:** `windows-latest`
- **Steps:** checkout → install Rust → cache cargo → run tests → build release → create GitHub Release
- **Assets:** `claude-proxy.exe`, `model-config.sample.json`, `README.md`
