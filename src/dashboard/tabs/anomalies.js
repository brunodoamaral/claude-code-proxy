const EMPTY_ANOMALIES_HTML = '<div class="empty-state"><h3>No anomalies detected</h3><p>Issues will appear here in real-time</p></div>';

function renderAnomalies() {
  const container = document.getElementById('anomaly-list');
  if (!statsSnapshot || !statsSnapshot.stats || !statsSnapshot.stats.anomalies || statsSnapshot.stats.anomalies.length === 0) {
    if (!container.querySelector('.anomaly-item')) {
      container.innerHTML = EMPTY_ANOMALIES_HTML;
    }
    return;
  }

  const anomalies = statsSnapshot.stats.anomalies;
  let html = '';

  for (const a of anomalies) {
    const severityClass = a.severity === 'error' || a.severity === 'critical' ? 'red'
      : a.severity === 'warning' ? 'yellow' : 'blue';
    const severityColor = 'var(--' + severityClass + ')';
    const time = a.detected_at ? new Date(a.detected_at).toLocaleTimeString() : '';
    const kind = a.kind || 'unknown';

    html += '<div class="card" style="margin-bottom:8px;padding:12px;cursor:pointer" onclick="focusAnomalyRequest(\'' + esc(a.request_id || '') + '\')">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
    html += '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;background:' + severityColor + '20;color:' + severityColor + ';border:1px solid ' + severityColor + '40">' + esc(a.severity || 'info') + '</span>';
    html += '<span style="font-family:var(--mono);font-size:11px;color:var(--text-2)">' + esc(kind) + '</span>';
    html += '<span style="margin-left:auto;font-size:11px;color:var(--text-2)">' + esc(time) + '</span>';
    html += '</div>';
    html += '<div style="font-size:13px;color:var(--text-1)">' + esc(a.summary || '') + '</div>';
    if (a.hypothesis) {
      html += '<div style="font-size:11px;color:var(--text-2);margin-top:4px">' + esc(a.hypothesis) + '</div>';
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

function focusAnomalyRequest(requestId) {
  if (!requestId) return;
  document.querySelector('[data-tab="requests"]').click();
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = requestId;
    searchInput.dispatchEvent(new Event('input'));
  }
}
