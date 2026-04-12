# Claude Code Proxy — Ultra-Fast API Monitor

A near-zero-latency logging proxy for Claude Code with a real-time web dashboard. Built in Rust for maximum performance.

## What It Does

Sits transparently between Claude Code and the Anthropic API. Logs every request and provides:

- **Real-time anomaly detection** — slow TTFT, stream stalls, error spirals, rate limiting, gateway errors
- **Model profiling** — automatic behavior fingerprinting with 140-parameter profiles, auto-tuning at 50-sample intervals
- **Session tracking** — timelines, conversation drill-down, and session graphs per Claude Code session
- **Forward-compat monitoring** — detects unknown SSE events, stop reasons, and API fields as Anthropic evolves the protocol
- **5-tab dashboard** — overview report card, request browser, model conformance, anomaly feed, session explorer

Adds **< 0.5ms** latency per request (measured on localhost passthrough).

## Quick Setup

### 1. Install Rust (one time)
```powershell
winget install Rustlang.Rust.MSVC
# Or download from https://rustup.rs
```

### 2. Build
```powershell
cd claude-proxy
cargo build --release
# Or use the build script:
build.bat
```

Binary at `target\release\claude-proxy.exe` (~5MB).

### 3. Run
```powershell
# Basic — proxy to Anthropic API:
claude-proxy.exe --target https://api.anthropic.com

# With auto-open dashboard in browser:
claude-proxy.exe --target https://api.anthropic.com --open-browser

# Custom ports:
claude-proxy.exe --target https://api.anthropic.com --port 8001 --dashboard-port 3001
```

This starts:
- **Proxy** on `http://127.0.0.1:8000` (forwards requests to the target API)
- **Dashboard** on `http://127.0.0.1:3000` (open in browser to monitor)

### RustRover IDE

In **Run/Debug Configurations** → **Cargo**, set the Command field to:
```
run --package claude-proxy --bin claude-proxy -- --target https://api.anthropic.com --open-browser
```

### 4. Configure Claude Code

Set `ANTHROPIC_BASE_URL` in Claude Code settings:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8000"
  }
}
```

Start using Claude Code normally — everything shows up in the dashboard.

## Dashboard

5-tab real-time dashboard:

- **Overview** — health score (0-100), stat cards, TTFT/error timeseries, model and error breakdowns
- **Requests** — sortable table with search, filters (error/5xx/4xx/timeout/stall), session filter, request detail modal with body viewer, correlation links, session timeline
- **Model Conformance** — conformance scoreboard (populates as profiling data accumulates)
- **Anomalies** — severity-badged anomaly feed with click-to-focus request filtering
- **Sessions** — split layout browser with session list, detail panel (metrics, timeline, conversation preview)

All data updates via WebSocket in real-time.

## CLI Options

```
claude-proxy --target https://api.anthropic.com   # Required: upstream API URL
             --port 8000                           # Proxy port (default: 8000)
             --dashboard-port 3000                 # Dashboard port (default: 3000)
             --data-dir ~/.claude/api-logs          # Storage directory
             --stall-threshold 0.5                  # Stall detection threshold in seconds (default: 0.5)
             --slow-ttft-threshold 3000             # Slow TTFT threshold in ms (default: 3000)
             --max-body-size 2097152                # Max request/response body to store (default: 2MB)
             --open-browser                         # Auto-open dashboard in browser
```

## API Endpoints

### Core
- `GET /api/health` — health metrics and report card
- `GET /api/stats` — live statistics snapshot
- `GET /api/entries` — request entries with optional filters

### Requests
- `GET /api/requests?limit=&offset=&search=` — paginated request list with FTS search
- `GET /api/requests/:id` — request detail
- `GET /api/requests/:id/body` — request/response bodies
- `GET /api/requests/:id/tools` — tool usage for a request

### Models
- `GET /api/models` — model list with stats
- `GET /api/models/:name/profile` — model behavior profile
- `GET /api/models/:name/comparison` — model comparison data
- `GET /api/model-config` — model configuration
- `PUT /api/model-config` — update model configuration

### Anomalies
- `GET /api/anomalies` — all anomalies
- `GET /api/anomalies/recent` — recent anomalies
- `GET /api/anomalies/:id` — anomaly detail

### Sessions
- `GET /api/sessions` — session list
- `GET /api/sessions/:id` — session detail
- `GET /api/sessions/merged` — merged session data
- `GET /api/session-details?session_id=` — full session with timeline and conversation
- `GET /api/session-graph?session_id=` — session relationship graph
- `GET /api/timeline?session_id=` — chronological session timeline

### Intelligence
- `GET /api/correlations?request_id=` — correlation links
- `GET /api/explanations?request_id=` — ranked explanations

### WebSocket
- `GET /ws` — real-time stats stream

## Persistence

Two SQLite databases in the data directory (default: `~/.claude/api-logs/`):
- `proxy.db` — stats store (requests, bodies, events, correlations)
- `proxy-v2.db` — v2 store (requests, FTS search, anomalies, model profiles, sessions)

## Performance

- **Proxy overhead**: < 0.5ms per request
- **Memory**: ~100MB for 50,000 entries
- **CPU**: negligible (async Rust with tokio)
- **Streaming**: zero-copy SSE passthrough

## Architecture

```
Claude Code  →  Proxy (:8000)  →  Anthropic API
                    │
                    ↓
              Dashboard (:3000)
                    │
                    ↓
              SQLite (proxy.db + proxy-v2.db)
```

Single Rust binary. No Node.js. No npm. No build step beyond `cargo build`.

Dashboard is a vanilla JS SPA (Chart.js for charts, WebSocket for real-time updates) assembled
at compile time from 11 focused files under `src/dashboard/` via Rust's `format!()` + `include_str!()`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for full details.

## License

Private — all rights reserved.
