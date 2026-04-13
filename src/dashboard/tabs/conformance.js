// Conformance tab — model scoreboard with detailed deviation breakdown

let _selectedConformanceModel = null;

function initConformanceTab() {
  loadConformanceData();
}

async function loadConformanceData() {
  const scoreboard = document.getElementById('conformance-scoreboard');
  const notes = document.getElementById('conformance-notes');
  const detail = document.getElementById('conformance-detail');

  try {
    const res = await fetch('/api/model-config');
    const data = await res.json();
    const models = data.models || [];
    const hasConfig = !!data.config;

    if (models.length === 0) {
      scoreboard.innerHTML = '<div class="empty-state" style="padding:20px 12px"><h3 style="font-size:14px">No model data yet</h3><p>Model statistics appear after requests are proxied and analyzed</p></div>';
      return;
    }

    // Fetch comparison data for each model
    const comparisons = await Promise.all(
      models.map(async (m) => {
        try {
          const resp = await fetch('/api/models/' + encodeURIComponent(m.model) + '/comparison');
          return await resp.json();
        } catch (e) { return { model: m.model }; }
      })
    );

    let html = '<table><thead><tr>';
    html += '<th>Model</th><th>Class</th><th>Requests</th><th>Avg TTFT</th>';
    if (hasConfig) {
      html += '<th>Expected TTFT</th><th>Conformance</th>';
    }
    html += '<th>Error Rate</th><th>Status</th>';
    html += '</tr></thead><tbody>';

    for (const m of models) {
      const comp = comparisons.find(c => c.model === m.model) || {};

      let sampleCount = 0;
      let profileStatus = 'collecting';
      try {
        const profileRes = await fetch('/api/models/' + encodeURIComponent(m.model) + '/profile');
        const profile = await profileRes.json();
        sampleCount = profile.sample_count || 0;
        if (sampleCount >= 50) profileStatus = 'profiled';
      } catch (e) { /* ignore */ }

      const errorRate = m.request_count > 0 ? ((m.error_count / m.request_count) * 100).toFixed(1) : '0.0';
      const errorRateColor = parseFloat(errorRate) > 10 ? 'var(--red)' : parseFloat(errorRate) > 5 ? 'var(--yellow)' : 'var(--green)';
      const avgTtft = m.avg_ttft_ms != null ? m.avg_ttft_ms.toFixed(0) + 'ms' : '\u2014';

      const behaviorClass = comp.behavior_class || '\u2014';

      let expectedTtft = '\u2014';
      let conformanceHtml = '\u2014';

      if (hasConfig && comp.deviation_summary) {
        const ds = comp.deviation_summary;
        const avgDev = ds.avg_absolute_deviation;
        const statusColor = ds.overall_status === 'healthy' ? 'var(--green)'
          : ds.overall_status === 'warning' ? 'var(--yellow)' : 'var(--red)';
        const statusIcon = ds.overall_status === 'healthy' ? '\u2713'
          : ds.overall_status === 'warning' ? '\u26A0' : '\u2717';
        conformanceHtml = '<span style="color:' + statusColor + ';font-weight:600;cursor:pointer" title="Click for details">'
          + statusIcon + ' ' + avgDev.toFixed(1) + '% avg dev'
          + ' <span style="font-weight:400;font-size:10px">(' + ds.healthy_count + '\u2713 '
          + ds.warning_count + '\u26A0 ' + ds.critical_count + '\u2717)</span></span>';
      } else if (hasConfig && comp.expected) {
        // Fallback to simple TTFT deviation
        const expVal = comp.expected.avg_ttft_ms;
        if (expVal != null) expectedTtft = Math.round(expVal) + 'ms';
        if (comp.deviations && comp.deviations.avg_ttft_ms != null) {
          const dev = comp.deviations.avg_ttft_ms;
          const color = Math.abs(dev) <= 20 ? 'var(--green)' : Math.abs(dev) <= 50 ? 'var(--yellow)' : 'var(--red)';
          conformanceHtml = '<span style="color:' + color + ';font-weight:600">' + (dev > 0 ? '+' : '') + dev.toFixed(1) + '%</span>';
        }
      }

      if (hasConfig && comp.expected && comp.expected.avg_ttft_ms != null) {
        expectedTtft = Math.round(comp.expected.avg_ttft_ms) + 'ms';
      }

      const statusBadge = profileStatus === 'profiled'
        ? '<span style="color:var(--green);font-size:11px">\u25CF Profiled (' + sampleCount + ')</span>'
        : '<span style="color:var(--yellow);font-size:11px">\u25CF Collecting (' + sampleCount + '/50)</span>';

      const isSelected = _selectedConformanceModel === m.model;
      const rowStyle = isSelected ? 'background:var(--bg-3);cursor:pointer' : 'cursor:pointer';

      html += '<tr style="' + rowStyle + '" onclick="showConformanceDetail(\'' + esc(m.model).replace(/'/g, "\\'") + '\')">';
      html += '<td style="font-family:var(--mono);font-size:12px">' + esc(m.model) + '</td>';
      html += '<td>' + esc(behaviorClass) + '</td>';
      html += '<td>' + m.request_count + '</td>';
      html += '<td>' + avgTtft + '</td>';
      if (hasConfig) {
        html += '<td>' + expectedTtft + '</td>';
        html += '<td>' + conformanceHtml + '</td>';
      }
      html += '<td style="color:' + errorRateColor + '">' + errorRate + '%</td>';
      html += '<td>' + statusBadge + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    scoreboard.innerHTML = html;

    // Notes
    const totalRequests = models.reduce((s, m) => s + m.request_count, 0);
    const totalErrors = models.reduce((s, m) => s + m.error_count, 0);
    const overallErrorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(1) : '0.0';
    let notesHtml = '<div style="font-size:12px;color:var(--text-2);line-height:1.6">';
    notesHtml += '<p><strong>' + models.length + '</strong> model(s) observed across <strong>' + totalRequests + '</strong> requests.</p>';
    notesHtml += '<p>Overall error rate: <strong>' + overallErrorRate + '%</strong></p>';
    if (hasConfig) {
      notesHtml += '<p style="margin-top:4px">Config loaded with expected baselines. Deviation: <span style="color:var(--green)">\u25CF \u226420%</span> <span style="color:var(--yellow)">\u25CF 20\u201350%</span> <span style="color:var(--red)">\u25CF >50%</span></p>';
    }
    notesHtml += '<p style="margin-top:4px;font-size:11px">Click a model row to see full conformance breakdown.</p>';
    notesHtml += '<p style="margin-top:4px;font-size:11px">Models are automatically profiled after 50 analyzed requests.</p>';
    notesHtml += '</div>';
    notes.innerHTML = notesHtml;

    // Re-show detail if model was previously selected
    if (_selectedConformanceModel) {
      const comp = comparisons.find(c => c.model === _selectedConformanceModel);
      if (comp && comp.metrics) {
        renderConformanceDetail(comp);
      }
    }

  } catch (err) {
    scoreboard.innerHTML = '<div class="empty-state" style="padding:20px 12px"><h3 style="font-size:14px">Failed to load</h3><p>' + esc(err.message) + '</p></div>';
  }
}

async function showConformanceDetail(modelName) {
  _selectedConformanceModel = modelName;
  const detail = document.getElementById('conformance-detail');

  try {
    const resp = await fetch('/api/models/' + encodeURIComponent(modelName) + '/comparison');
    const comp = await resp.json();

    if (!comp.metrics || comp.metrics.length === 0) {
      detail.style.display = 'block';
      detail.innerHTML = '<div class="card" style="padding:16px"><p style="color:var(--text-2);font-size:12px">No detailed metrics available for <strong>' + esc(modelName) + '</strong>. Ensure a model config with baselines is loaded and the model has been profiled (50+ requests).</p></div>';
      return;
    }

    renderConformanceDetail(comp);
  } catch (err) {
    detail.style.display = 'block';
    detail.innerHTML = '<div class="card" style="padding:16px"><p style="color:var(--red);font-size:12px">Failed to load details: ' + esc(err.message) + '</p></div>';
  }

  // Refresh scoreboard to highlight selected row
  loadConformanceData();
}

function renderConformanceDetail(comp) {
  const detail = document.getElementById('conformance-detail');
  const metrics = comp.metrics || [];
  const summary = comp.deviation_summary;
  const modelName = comp.model;
  const behaviorClass = comp.behavior_class || 'unknown';

  // Group metrics by category
  const categories = {};
  for (const m of metrics) {
    if (!categories[m.category]) categories[m.category] = [];
    categories[m.category].push(m);
  }

  let html = '<div class="card" style="padding:16px">';

  // Header
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">';
  html += '<div>';
  html += '<h3 style="font-size:14px;font-weight:600">' + esc(modelName) + '</h3>';
  html += '<span style="font-size:11px;color:var(--text-2)">Behavior class: <strong>' + esc(behaviorClass) + '</strong></span>';
  html += '</div>';

  if (summary) {
    const statusColor = summary.overall_status === 'healthy' ? 'var(--green)'
      : summary.overall_status === 'warning' ? 'var(--yellow)' : 'var(--red)';
    html += '<div style="text-align:right">';
    html += '<div style="font-size:24px;font-weight:700;color:' + statusColor + '">'
      + summary.avg_absolute_deviation.toFixed(1) + '%</div>';
    html += '<div style="font-size:11px;color:var(--text-2)">avg absolute deviation across ' + summary.total_metrics + ' metrics</div>';
    html += '<div style="font-size:11px;margin-top:4px">'
      + '<span style="color:var(--green)">' + summary.healthy_count + ' healthy</span> '
      + '<span style="color:var(--yellow)">' + summary.warning_count + ' warning</span> '
      + '<span style="color:var(--red)">' + summary.critical_count + ' critical</span>'
      + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // Close button
  html += '<div style="position:absolute;top:12px;right:16px;cursor:pointer;color:var(--text-2);font-size:16px" onclick="closeConformanceDetail()">\u2715</div>';

  // Category sections
  const categoryOrder = ['Timing', 'Tokens', 'Cache', 'Errors', 'Streaming'];
  for (const cat of categoryOrder) {
    const catMetrics = categories[cat];
    if (!catMetrics || catMetrics.length === 0) continue;

    const catCritical = catMetrics.filter(m => m.status === 'critical').length;
    const catWarning = catMetrics.filter(m => m.status === 'warning').length;
    const catHealthy = catMetrics.filter(m => m.status === 'healthy').length;
    const catStatusColor = catCritical > 0 ? 'var(--red)' : catWarning > 0 ? 'var(--yellow)' : 'var(--green)';

    html += '<div style="margin-bottom:16px">';
    html += '<h4 style="font-size:11px;color:' + catStatusColor + ';text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;border-bottom:1px solid var(--border);padding-bottom:6px">'
      + esc(cat)
      + ' <span style="color:var(--text-2);font-weight:400">(' + catHealthy + '/' + catMetrics.length + ' healthy)</span>'
      + '</h4>';

    html += '<table style="width:100%;font-size:12px">';
    html += '<thead><tr>';
    html += '<th style="text-align:left;padding:4px 8px;color:var(--text-2);font-weight:500">Metric</th>';
    html += '<th style="text-align:right;padding:4px 8px;color:var(--text-2);font-weight:500">Observed</th>';
    html += '<th style="text-align:right;padding:4px 8px;color:var(--text-2);font-weight:500">Expected</th>';
    html += '<th style="text-align:right;padding:4px 8px;color:var(--text-2);font-weight:500">Deviation</th>';
    html += '<th style="text-align:left;padding:4px 8px;color:var(--text-2);font-weight:500">Assessment</th>';
    html += '</tr></thead><tbody>';

    for (const m of catMetrics) {
      const statusColor = m.status === 'healthy' ? 'var(--green)'
        : m.status === 'warning' ? 'var(--yellow)' : 'var(--red)';
      const arrow = m.deviation_pct > 0 ? '\u2191' : m.deviation_pct < 0 ? '\u2193' : '\u2192';
      const favorableIcon = m.favorable ? '\u2713' : '\u2717';
      const favorableColor = m.favorable ? 'var(--green)' : statusColor;

      const assessment = buildAssessment(m);

      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:6px 8px;font-family:var(--mono);font-size:11px">' + esc(m.name) + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono)">' + formatMetricValue(m.observed, m.unit) + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-family:var(--mono);color:var(--text-2)">' + formatMetricValue(m.expected, m.unit) + '</td>';
      html += '<td style="padding:6px 8px;text-align:right;font-weight:600;color:' + statusColor + '">'
        + arrow + ' ' + (m.deviation_pct > 0 ? '+' : '') + m.deviation_pct.toFixed(1) + '%'
        + ' <span style="font-size:10px;color:' + favorableColor + '">' + favorableIcon + '</span></td>';
      html += '<td style="padding:6px 8px;font-size:11px;color:var(--text-1);max-width:280px">' + assessment + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    html += '</div>';
  }

  html += '</div>';
  detail.style.display = 'block';
  detail.innerHTML = html;
}

function closeConformanceDetail() {
  _selectedConformanceModel = null;
  document.getElementById('conformance-detail').style.display = 'none';
  loadConformanceData();
}

function formatMetricValue(value, unit) {
  if (value == null) return '\u2014';
  if (unit === 'ms') return Math.round(value).toLocaleString() + 'ms';
  if (unit === 'tokens') return Math.round(value).toLocaleString();
  if (unit === '%') return (value * 100).toFixed(1) + '%';
  if (unit === 'ratio') return value.toFixed(3);
  return value.toFixed(2);
}

function buildAssessment(m) {
  const dev = m.deviation_pct;
  const absDev = Math.abs(dev);
  const name = m.name;
  const favorable = m.favorable;
  const lowerBetter = m.lower_is_better;

  if (absDev <= 5) return '<span style="color:var(--green)">Within normal range</span>';

  // Timing metrics
  if (m.category === 'Timing') {
    if (dev < 0) {
      if (absDev <= 20) return '<span style="color:var(--green)">Faster than baseline \u2014 healthy performance</span>';
      if (absDev <= 50) return '<span style="color:var(--green)">Significantly faster than expected \u2014 verify baseline is current</span>';
      return '<span style="color:var(--yellow)">Dramatically faster \u2014 baseline may be outdated or conditions differ significantly</span>';
    } else {
      if (absDev <= 20) return '<span style="color:var(--yellow)">Slightly slower than expected \u2014 monitor for trends</span>';
      if (absDev <= 50) return '<span style="color:var(--yellow)">Elevated latency \u2014 check context sizes, upstream load, and network conditions</span>';
      return '<span style="color:var(--red)">Severe latency spike \u2014 investigate API congestion, large prompts, or throttling</span>';
    }
  }

  // Error metrics
  if (m.category === 'Errors') {
    if (dev <= 0 || m.observed === 0) return '<span style="color:var(--green)">At or below expected error rate</span>';
    if (absDev <= 50) return '<span style="color:var(--yellow)">Elevated error rate \u2014 check for transient API issues</span>';
    return '<span style="color:var(--red)">Error rate well above baseline \u2014 investigate rate limits, API health, or request errors</span>';
  }

  // Cache metrics
  if (m.category === 'Cache') {
    if (m.key === 'cache_hit_rate') {
      if (dev < -20) return '<span style="color:var(--yellow)">Lower cache hits \u2014 prompt structure may have changed, cache TTL expired, or new conversations</span>';
      if (dev > 20) return '<span style="color:var(--green)">Higher cache hits than expected \u2014 efficient prompt reuse</span>';
    }
    if (favorable) return '<span style="color:var(--green)">Within acceptable range</span>';
    return '<span style="color:var(--yellow)">Deviating from expected cache behavior</span>';
  }

  // Token metrics
  if (m.category === 'Tokens') {
    if (m.key === 'thinking_frequency' || m.key === 'thinking_token_ratio' || m.key === 'avg_thinking_tokens') {
      if (absDev > 50) return '<span style="color:var(--yellow)">Thinking behavior differs significantly \u2014 task complexity or model behavior may have shifted</span>';
      return '<span style="color:var(--text-1)">Thinking pattern variation \u2014 depends on task mix</span>';
    }
    if (dev > 50) return '<span style="color:var(--yellow)">Token usage well above baseline \u2014 check for verbose outputs or prompt bloat</span>';
    if (dev < -30) return '<span style="color:var(--yellow)">Token usage below expected \u2014 outputs may be truncated or tasks simpler than baseline</span>';
    return '<span style="color:var(--text-1)">Token usage variation within typical range</span>';
  }

  // Streaming metrics
  if (m.category === 'Streaming') {
    if (m.key === 'stream_completion_rate' && dev < -10) {
      return '<span style="color:var(--red)">More streams failing to complete \u2014 check connection stability and timeouts</span>';
    }
    if (m.key === 'stall_rate' && dev > 30) {
      return '<span style="color:var(--yellow)">More stalls than expected \u2014 possible upstream congestion</span>';
    }
    if (favorable) return '<span style="color:var(--green)">Streaming behavior healthy</span>';
    return '<span style="color:var(--yellow)">Streaming metric deviating from baseline</span>';
  }

  // Generic fallback
  if (favorable) return '<span style="color:var(--green)">Deviation is in favorable direction</span>';
  if (absDev <= 20) return '<span style="color:var(--text-1)">Minor deviation \u2014 likely within normal variance</span>';
  if (absDev <= 50) return '<span style="color:var(--yellow)">Notable deviation \u2014 review if this metric matters for your use case</span>';
  return '<span style="color:var(--red)">Significant deviation \u2014 investigate underlying cause</span>';
}
