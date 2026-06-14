// ╔══════════════════════════════════════════════════════════════╗
// ║  SANTAI RECOVERY SPA — Admin Dashboard                      ║
// ║  Connects to Supabase (polled from Loyverse API)             ║
// ║                                                              ║
// ║  Tables expected:                                            ║
// ║    members      → name, membership_level, membership_status  ║
// ║                   member_since, renewal_due, pause_date      ║
// ║    transactions → customer_type ('member'|'walk_in')         ║
// ║                   product_name, total_money, created_at      ║
// ╚══════════════════════════════════════════════════════════════╝

// ── CONFIG ─────────────────────────────────────────────────────
const SUPABASE_URL = 'https://pzotsmqimlecrgkaajdb.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6b3RzbXFpbWxlY3Jna2FhamRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTg3NjQ4MCwiZXhwIjoyMDk1NDUyNDgwfQ.aB-TlrPfAROmTzXqLtlaf73Asq04Q7Y7kc36zHXwDpc';

// !! Adjust these to match EXACT product names in Loyverse !!
const PRODUCT_SINGLE = 'Single Session';
const PRODUCT_DAYPASS = 'Day Pass';

// ── SUPABASE FETCH ──────────────────────────────────────────────
async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'count=exact'
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  return res.json();
}

// ── DATE STATE ──────────────────────────────────────────────────
let currentPreset = 'today';
let filterFrom    = '';
let filterTo      = '';

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function setPreset(preset, btn) {
  currentPreset = preset;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const now   = new Date();
  const today = todayStr();

  if (preset === 'today') {
    filterFrom = today;
    filterTo   = today;
    document.getElementById('customRange').style.display = 'none';
  } else if (preset === 'week') {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Mon
    filterFrom = monday.toISOString().split('T')[0];
    filterTo   = today;
    document.getElementById('customRange').style.display = 'none';
  } else if (preset === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    filterFrom  = first.toISOString().split('T')[0];
    filterTo    = today;
    document.getElementById('customRange').style.display = 'none';
  } else if (preset === 'custom') {
    document.getElementById('customRange').style.display = 'flex';
    document.getElementById('dateFrom').value = filterFrom || today;
    document.getElementById('dateTo').value   = filterTo   || today;
    return; // wait for user to hit Apply
  }

  updatePeriodLabel();
  loadAll();
}

function applyCustomRange() {
  filterFrom = document.getElementById('dateFrom').value;
  filterTo   = document.getElementById('dateTo').value;
  if (!filterFrom || !filterTo) return showToast('Pick both dates first');
  if (filterFrom > filterTo) return showToast('From date must be before To date');
  updatePeriodLabel();
  loadAll();
}

function updatePeriodLabel() {
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  const from = new Date(filterFrom).toLocaleDateString('en-GB', opts);
  const to   = new Date(filterTo).toLocaleDateString('en-GB', opts);
  const label = filterFrom === filterTo ? from : `${from} — ${to}`;
  document.getElementById('periodLabel').textContent = label;
  document.getElementById('revenue-period-label').textContent = label;
}

// Date range into ISO datetimes (full day coverage)
function rangeTs() {
  return {
    from: `${filterFrom}T00:00:00`,
    to:   `${filterTo}T23:59:59`
  };
}

// ── HELPERS ─────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function fmtTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n) {
  if (!n && n !== 0) return '—';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

function daysLeft(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - new Date(todayStr())) / 86400000);
}

function statusPill(s) {
  const map = { Active: 'pill-active', Paused: 'pill-paused', Inactive: 'pill-inactive', Expired: 'pill-expired' };
  return `<span class="pill ${map[s] || 'pill-inactive'}">${s}</span>`;
}

function showToast(msg, dur = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', dur);
}

// ── KPI & WALK-IN TABLES ────────────────────────────────────────
async function loadWalkinTables() {
  const { from, to } = rangeTs();

  // Fetch all walk-in transactions in period
  const data = await sb(
    `transactions?customer_type=eq.walk_in` +
    `&created_at=gte.${from}&created_at=lte.${to}` +
    `&select=product_name,total_money,created_at,customer_name` +
    `&order=created_at.desc`
  );

  // Split by product_name
  const singles  = data.filter(r => r.product_name === PRODUCT_SINGLE);
  const daypasses = data.filter(r => r.product_name === PRODUCT_DAYPASS);

  // KPI numbers
  document.getElementById('kpi-single').textContent  = singles.length;
  document.getElementById('kpi-daypass').textContent = daypasses.length;
  document.getElementById('single-count').textContent  = singles.length;
  document.getElementById('daypass-count').textContent = daypasses.length;

  // Sub-labels with revenue
  const sRev = singles.reduce((s, r) => s + (r.total_money || 0), 0);
  const dRev = daypasses.reduce((s, r) => s + (r.total_money || 0), 0);
  document.getElementById('kpi-single-sub').textContent  = fmtMoney(sRev);
  document.getElementById('kpi-daypass-sub').textContent = fmtMoney(dRev);

  // Single Session table
  const stb = document.getElementById('single-table');
  stb.innerHTML = singles.length
    ? singles.map(r => `<tr>
        <td>${r.customer_name || '—'}</td>
        <td style="color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${fmtTime(r.created_at)}</td>
        <td style="color:var(--blue);font-family:'DM Mono',monospace">${fmtMoney(r.total_money)}</td>
      </tr>`).join('')
    : '<tr class="loading-row"><td colspan="3">No Single Sessions this period</td></tr>';

  // Day Pass table
  const dtb = document.getElementById('daypass-table');
  dtb.innerHTML = daypasses.length
    ? daypasses.map(r => `<tr>
        <td>${r.customer_name || '—'}</td>
        <td style="color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${fmtTime(r.created_at)}</td>
        <td style="color:var(--teal);font-family:'DM Mono',monospace">${fmtMoney(r.total_money)}</td>
      </tr>`).join('')
    : '<tr class="loading-row"><td colspan="3">No Day Passes this period</td></tr>';
}

// ── NEW MEMBERS (period-aware) ──────────────────────────────────
async function loadNewMembers() {
  const { from, to } = rangeTs();
  // New members = their first paid transaction in period (customer_type = 'member')
  // AND member_since falls within range (most reliable)
  const data = await sb(
    `members?member_since=gte.${filterFrom}&member_since=lte.${filterTo}` +
    `&select=name,membership_level,member_since,renewal_due,membership_status` +
    `&order=member_since.desc`
  );

  document.getElementById('kpi-new').textContent    = data.length;
  document.getElementById('kpi-new-sub').textContent = `Joined ${filterFrom === filterTo ? 'today' : 'this period'}`;
  document.getElementById('new-member-count').textContent = data.length;

  const tb = document.getElementById('new-member-table');
  tb.innerHTML = data.length
    ? data.map(m => `<tr>
        <td style="font-weight:500">${m.name}</td>
        <td><span class="badge badge-gold">${m.membership_level || '—'}</span></td>
        <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--muted)">${fmtDate(m.member_since)}</td>
        <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--green)">${fmtDate(m.renewal_due)}</td>
      </tr>`).join('')
    : '<tr class="loading-row"><td colspan="4">No new members this period</td></tr>';
}

// ── ACTIVE MEMBERS KPI ──────────────────────────────────────────
async function loadKpiActive() {
  const data = await sb(`members?membership_status=eq.Active&select=id`);
  document.getElementById('kpi-active').textContent = data.length;
}

// ── EXPIRING IN 7 DAYS (always live, ignores date filter) ───────
async function loadExpiring() {
  const today = todayStr();
  const in7   = new Date(); in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().split('T')[0];

  const data = await sb(
    `members?renewal_due=gte.${today}&renewal_due=lte.${in7Str}` +
    `&membership_status=eq.Active` +
    `&select=name,membership_level,renewal_due,membership_status` +
    `&order=renewal_due.asc`
  );

  document.getElementById('kpi-expiring').textContent   = data.length;
  document.getElementById('expiring-count').textContent = data.length;

  const tb = document.getElementById('expiring-table');
  if (!data.length) {
    tb.innerHTML = '<tr class="loading-row"><td colspan="4">✓ No members expiring this week</td></tr>';
    return;
  }

  tb.innerHTML = data.map(m => {
    const dl = daysLeft(m.renewal_due);
    const dlClass = dl <= 2 ? 'days-urgent' : dl <= 5 ? 'days-warn' : 'days-ok';
    const dlLabel = dl === 0 ? 'Today!' : dl === 1 ? 'Tomorrow' : `${dl}d`;
    return `<tr>
      <td style="font-weight:500">${m.name}</td>
      <td><span class="badge badge-gold">${m.membership_level || '—'}</span></td>
      <td class="${dlClass}">${dlLabel}</td>
      <td>${statusPill(m.membership_status)}</td>
    </tr>`;
  }).join('');
}

// ── MEMBERSHIP BREAKDOWN BARS ───────────────────────────────────
async function loadBreakdown() {
  const data = await sb(`members?membership_status=eq.Active&select=membership_level`);
  const counts = {};
  for (const m of data) {
    const lvl = m.membership_level || 'Unknown';
    counts[lvl] = (counts[lvl] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max    = sorted[0]?.[1] || 1;
  const colors = ['var(--gold)','var(--blue)','var(--teal)','var(--purple)','var(--orange)','var(--red)','var(--green)'];

  const el = document.getElementById('breakdown-list');
  if (!sorted.length) { el.innerHTML = '<div class="empty">No data</div>'; return; }
  el.innerHTML = sorted.map(([lvl, cnt], i) => `
    <div class="breakdown-item">
      <div class="breakdown-label" title="${lvl}">${lvl.length > 15 ? lvl.slice(0,14)+'…' : lvl}</div>
      <div class="breakdown-bar-wrap">
        <div class="breakdown-bar" style="width:${Math.round(cnt/max*100)}%;background:${colors[i % colors.length]}"></div>
      </div>
      <div class="breakdown-count">${cnt}</div>
    </div>`).join('');
}

// ── STATUS DONUT ────────────────────────────────────────────────
async function loadDonut() {
  const data = await sb(`members?select=membership_status`);
  const counts = {};
  for (const m of data) {
    const s = m.membership_status || 'Inactive';
    counts[s] = (counts[s] || 0) + 1;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  document.getElementById('donut-center').textContent = total;

  const colors = { Active: '#3fb950', Paused: '#bc8cff', Inactive: '#7d8590', Expired: '#f85149' };
  const r = 42, cx = 55, cy = 55, circ = 2 * Math.PI * r;
  let offset = 0;

  const svg = document.getElementById('donut-svg');
  svg.querySelectorAll('.arc').forEach(e => e.remove());

  for (const [status, count] of Object.entries(counts)) {
    if (!count) continue;
    const dash   = (count / total) * circ;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'arc');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', colors[status] || '#7d8590');
    circle.setAttribute('stroke-width', '16');
    circle.setAttribute('stroke-dasharray', `${dash} ${circ - dash}`);
    circle.setAttribute('stroke-dashoffset', -offset);
    circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    svg.insertBefore(circle, svg.querySelector('text'));
    offset += dash;
  }

  document.getElementById('donut-legend').innerHTML = Object.entries(counts).map(([s, c]) => `
    <div class="legend-item">
      <div class="legend-label">
        <span class="legend-dot" style="background:${colors[s] || '#7d8590'}"></span>${s}
      </div>
      <div class="legend-val">${c}</div>
    </div>`).join('');
}

// ── PAUSED MEMBERS ──────────────────────────────────────────────
async function loadPaused() {
  const data = await sb(
    `members?membership_status=eq.Paused` +
    `&select=name,membership_level,pause_date,renewal_due&order=pause_date.desc`
  );
  document.getElementById('paused-count').textContent = data.length;

  const tb = document.getElementById('paused-table');
  tb.innerHTML = data.length
    ? data.map(m => `<tr>
        <td style="font-weight:500">${m.name}</td>
        <td><span class="badge badge-purple">${m.membership_level || '—'}</span></td>
        <td style="color:var(--muted);font-family:'DM Mono',monospace;font-size:11px">${fmtDate(m.renewal_due)}</td>
      </tr>`).join('')
    : '<tr class="loading-row"><td colspan="3">No paused members</td></tr>';
}

// ── REVENUE SUMMARY ─────────────────────────────────────────────
async function loadRevenue() {
  const { from, to } = rangeTs();

  // All transactions in period
  const data = await sb(
    `transactions?created_at=gte.${from}&created_at=lte.${to}` +
    `&select=customer_type,product_name,total_money,created_at` +
    `&order=created_at.asc`
  );

  // Aggregate by category
  const cats = {
    'Single Session': { count: 0, rev: 0, color: 'var(--blue)' },
    'Day Pass':       { count: 0, rev: 0, color: 'var(--teal)' },
    'Member':         { count: 0, rev: 0, color: 'var(--gold)' },
    'Other':          { count: 0, rev: 0, color: 'var(--muted)' },
  };

  for (const tx of data) {
    if (tx.customer_type === 'walk_in') {
      if (tx.product_name === PRODUCT_SINGLE)  { cats['Single Session'].count++; cats['Single Session'].rev += tx.total_money || 0; }
      else if (tx.product_name === PRODUCT_DAYPASS) { cats['Day Pass'].count++; cats['Day Pass'].rev += tx.total_money || 0; }
      else                                     { cats['Other'].count++; cats['Other'].rev += tx.total_money || 0; }
    } else if (tx.customer_type === 'member') {
      cats['Member'].count++; cats['Member'].rev += tx.total_money || 0;
    } else {
      cats['Other'].count++; cats['Other'].rev += tx.total_money || 0;
    }
  }

  const totalRev = Object.values(cats).reduce((s, c) => s + c.rev, 0);
  const totalCount = Object.values(cats).reduce((s, c) => s + c.count, 0);

  const tb = document.getElementById('revenue-table');
  tb.innerHTML = Object.entries(cats)
    .filter(([, c]) => c.count > 0)
    .map(([name, c]) => `<tr>
      <td>
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c.color};margin-right:8px;vertical-align:middle"></span>
        ${name}
      </td>
      <td style="font-family:'DM Mono',monospace;color:var(--muted)">${c.count}x</td>
      <td style="font-family:'DM Mono',monospace;color:${c.color};font-weight:600">${fmtMoney(c.rev)}</td>
    </tr>`).join('') +
    `<tr class="revenue-total-row">
      <td>Total</td>
      <td style="font-family:'DM Mono',monospace">${totalCount}x</td>
      <td style="font-family:'DM Mono',monospace">${fmtMoney(totalRev)}</td>
    </tr>`;

  // ── Daily breakdown ──
  // Group by date
  const byDate = {};
  for (const tx of data) {
    const d = tx.created_at.split('T')[0];
    if (!byDate[d]) byDate[d] = { total: 0, singles: 0, daypasses: 0, members: 0 };
    byDate[d].total += tx.total_money || 0;
    if (tx.customer_type === 'walk_in') {
      if (tx.product_name === PRODUCT_SINGLE) byDate[d].singles++;
      else if (tx.product_name === PRODUCT_DAYPASS) byDate[d].daypasses++;
    } else if (tx.customer_type === 'member') {
      byDate[d].members++;
    }
  }

  const dates = Object.keys(byDate).sort().reverse();
  const maxRev = Math.max(...Object.values(byDate).map(d => d.total), 1);

  const dbEl = document.getElementById('daily-breakdown');
  if (!dates.length) {
    dbEl.innerHTML = '<div class="empty">No transactions in this period</div>';
    return;
  }

  dbEl.innerHTML = dates.map(date => {
    const d = byDate[date];
    const barW = Math.round((d.total / maxRev) * 100);
    const label = new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const meta = [
      d.singles   ? `${d.singles} Single` : '',
      d.daypasses ? `${d.daypasses} Day Pass` : '',
      d.members   ? `${d.members} Member` : '',
    ].filter(Boolean).join(' · ');

    return `<div class="daily-item">
      <div class="daily-date">${label}</div>
      <div class="daily-bars">
        <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${barW}%;background:var(--gold);border-radius:3px;transition:width .5s"></div>
        </div>
        <div class="daily-meta">${fmtMoney(d.total)}</div>
      </div>
    </div>
    <div style="padding:2px 18px 8px;font-size:10px;font-family:'DM Mono',monospace;color:var(--muted);border-bottom:1px solid var(--border)">${meta}</div>`;
  }).join('');
}

// ── TOPBAR DATE ─────────────────────────────────────────────────
document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-GB', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

// ── LOAD ALL ────────────────────────────────────────────────────
async function loadAll() {
  try {
    await Promise.all([
      loadWalkinTables(),
      loadNewMembers(),
      loadKpiActive(),
      loadExpiring(),
      loadBreakdown(),
      loadDonut(),
      loadPaused(),
      loadRevenue(),
    ]);
  } catch (e) {
    console.error('[Dashboard error]', e);
    showToast('⚠ Error loading data — check console', 4000);
  }
}

// ── INIT ────────────────────────────────────────────────────────
setPreset('today', document.querySelector('[data-preset="today"]'));

// Auto-refresh every 3 minutes
setInterval(loadAll, 3 * 60 * 1000);