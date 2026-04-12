// Conformance tab — model scoreboard with expected vs observed comparison

function initConformanceTab() {
  loadConformanceData();
}

async function loadConformanceData() {
  const scoreboard = document.getElementById('conformance-scoreboard');
  const notes = document.getElementById('conformance-notes');

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
      html += '<th>Expected TTFT</th><th>Deviation</th>';
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
      let deviation = '\u2014';
      let deviationColor = 'var(--text-2)';

      if (hasConfig && comp.expected) {
        const expVal = comp.expected.avg_ttft_ms;
        if (expVal != null) {
          expectedTtft = Math.round(expVal) + 'ms';
        }
        if (comp.deviations && comp.deviations.avg_ttft_ms != null) {
          const dev = comp.deviations.avg_ttft_ms;
          deviation = (dev > 0 ? '+' : '') + dev.toFixed(1) + '%';
          deviationColor = Math.abs(dev) <= 20 ? 'var(--green)' : Math.abs(dev) <= 50 ? 'var(--yellow)' : 'var(--red)';
        }
      }

      const statusBadge = profileStatus === 'profiled'
        ? '<span style="color:var(--green);font-size:11px">\u25CF Profiled (' + sampleCount + ')</span>'
        : '<span style="color:var(--yellow);font-size:11px">\u25CF Collecting (' + sampleCount + '/50)</span>';

      html += '<tr>';
      html += '<td style="font-family:var(--mono);font-size:12px">' + esc(m.model) + '</td>';
      html += '<td>' + esc(behaviorClass) + '</td>';
      html += '<td>' + m.request_count + '</td>';
      html += '<td>' + avgTtft + '</td>';
      if (hasConfig) {
        html += '<td>' + expectedTtft + '</td>';
        html += '<td style="color:' + deviationColor + ';font-weight:600">' + deviation + '</td>';
      }
      html += '<td style="color:' + errorRateColor + '">' + errorRate + '%</td>';
      html += '<td>' + statusBadge + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    scoreboard.innerHTML = html;

    const totalRequests = models.reduce((s, m) => s + m.request_count, 0);
    const totalErrors = models.reduce((s, m) => s + m.error_count, 0);
    const overallErrorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(1) : '0.0';
    let notesHtml = '<div style="font-size:12px;color:var(--text-2);line-height:1.6">';
    notesHtml += '<p><strong>' + models.length + '</strong> model(s) observed across <strong>' + totalRequests + '</strong> requests.</p>';
    notesHtml += '<p>Overall error rate: <strong>' + overallErrorRate + '%</strong></p>';
    if (hasConfig) {
      notesHtml += '<p style="margin-top:4px">Config loaded with expected baselines. Deviation: <span style="color:var(--green)">\u25CF \u226420%</span> <span style="color:var(--yellow)">\u25CF 20\u201350%</span> <span style="color:var(--red)">\u25CF >50%</span></p>';
    }
    notesHtml += '<p style="margin-top:8px;font-size:11px">Models are automatically profiled after 50 analyzed requests.</p>';
    notesHtml += '</div>';
    notes.innerHTML = notesHtml;

  } catch (err) {
    scoreboard.innerHTML = '<div class="empty-state" style="padding:20px 12px"><h3 style="font-size:14px">Failed to load</h3><p>' + esc(err.message) + '</p></div>';
  }
}
