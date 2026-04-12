// websocket.js — WebSocket connection logic

function connectWS() {{
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${{proto}}//${{location.host}}/ws`);

  ws.onopen = () => {{
    document.getElementById('ws-dot').className = 'status-dot connected';
    document.getElementById('ws-status').textContent = 'Connected';
  }};

  ws.onclose = () => {{
    document.getElementById('ws-dot').className = 'status-dot disconnected';
    document.getElementById('ws-status').textContent = 'Disconnected';
    setTimeout(connectWS, 2000);
  }};

  ws.onmessage = (event) => {{
    try {{
      const msg = JSON.parse(event.data);
      if (msg.type === 'stats') {{
        if (currentOverviewMode === 'live') {{
          statsSnapshot = msg.data;
          updateOverview();
        }}
      }} else if (msg.type === 'reset') {{
        handleReset(msg.data);
      }} else if (msg.type === 'entry') {{
        entries.unshift(msg.data);
        if (entries.length > MAX_TABLE_ENTRIES) entries.pop();
        if (anomalyFocus) {{
          loadEntries();
        }} else {{
          addTableRow(msg.data, true);
        }}
        if (msg.data.anomalies?.length) updateAnomalies(msg.data);
        if (currentOverviewMode === 'historical') scheduleOverviewRefresh();
      }}
    }} catch (e) {{ console.error('WS parse error:', e); }}
  }};
}}
