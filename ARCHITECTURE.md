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
Request → Bind :8000 → Parse metadata (model, stream, session_id)
→ Forward headers to upstream → Send request → Handle response:

1. ERROR (status ≥ 400): Read body, summarize, record, store
2. SSE STREAMING: Spawn task, detect stalls, extract usage, track unknown events
3. REGULAR JSON: Read body, parse JSON for usage, record, store

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
```

---

## Dashboard Architecture

Single-page app assembled at compile time from `src/dashboard/` files.

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
| `components/websocket.js` | 41 | WebSocket connection |
| `tabs/conformance.js` | 2 | Conformance placeholder |
| `tabs/anomalies.js` | 1 | Anomaly constant |
| **Total** | **2,886** | |

### Tabs

5 tabs: Overview, Requests, Model Conformance, Anomalies, Sessions

### Frontend Stack

- **Vanilla JS** — no framework (no React, no Vue, no Alpine.js)
- **Chart.js 4** (CDN) — TTFT and error timeseries charts
- **WebSocket** — real-time stats streaming from `/ws`

---

## Source Modules

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `stats.rs` | ~7,350 | Stats store, live stats, session aggregation, DB schema |
| `dashboard.rs` | ~2,230 | Axum routes, REST API, WebSocket, HTML assembly |
| `store.rs` | ~870 | V2 SQLite store, FTS5, CRUD |
| `proxy.rs` | ~690 | HTTP proxy, SSE streaming, request forwarding |
| `model_profile.rs` | ~410 | Model config, behavior class resolution, auto-tune |
| `main.rs` | ~430 | CLI, runtime orchestration, analyzer worker, auto-configure, graceful shutdown |
| `types.rs` | ~220 | V2 types, forward-compat tracking |
| `analyzer.rs` | ~110 | Anomaly detection rules, health score |
| `correlation.rs` | ~50 | PayloadPolicy enum |

---

## Analyzer Worker

Runs every 5 seconds:
1. Fetch up to 200 unanalyzed requests
2. For each: detect anomalies against recent model history
3. Persist anomalies atomically (transaction: delete prior → insert new → mark analyzed)
4. At 50-sample boundaries: compute and store model observed stats

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
