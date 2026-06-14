// ╔══════════════════════════════════════════════════════════════╗
// ║  SANTAI RECOVERY SPA — Admin Dashboard                      ║
// ║  Data: Loyverse (receipts) + Supabase (members)             ║
// ║  Client Engine Integration System                           ║
// ╚══════════════════════════════════════════════════════════════╝

const BASE_URL = 'https://santai-seacrh-engine-production.up.railway.app';

// Config nama produk dari POS Loyverse
const PRODUCT_SINGLE  = 'Single Session';
const PRODUCT_DAYPASS = 'Day Pass';

// State Filter & Cache Chart Global
let currentPreset = 'today';
let filterFrom    = '';
let filterTo      = '';

let revenueChartInstance = null;

// ── HELPER API ──
async function apiGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ── HANDLER FILTER TANGGAL ──
function setPreset(preset, btn) {
  currentPreset = preset;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const today = new Date();
  if (preset === 'today') {
    filterFrom = todayStr();
    filterTo   = todayStr();
  } else if (preset === 'yesterday') {
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    const yStr = yest.toISOString().split('T')[0];
    filterFrom = yStr;
    filterTo   = yStr;
  } else if (preset === '7d') {
    const past = new Date();
    past.setDate(today.getDate() - 7);
    filterFrom = past.toISOString().split('T')[0];
    filterTo   = todayStr();
  } else if (preset === '30d') {
    const past = new Date();
    past.setDate(today.getDate() - 30);
    filterFrom = past.toISOString().split('T')[0];
    filterTo   = todayStr();
  } else if (preset === 'thisMonth') {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    // Tambah offset timezone lokal agar aman
    const offset = firstDay.getTimezoneOffset() * 60000;
    filterFrom = new Date(firstDay.getTime() - offset).toISOString().split('T')[0];
    filterTo   = todayStr();
  }
  loadAll();
}

// ── FORMATTER HELPERS ──
function fmtMoney(v) {
  return 'Rp ' + Math.round(v).toLocaleString('id-ID');
}
function fmtDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}
function daysLeft(dueStr) {
  if (!dueStr) return 0;
  const diff = new Date(dueStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ── UTAMA: LOAD ALL DATA ──
async function loadAll() {
  showLoadingSkeletons();
  
  if (!filterFrom) {
    filterFrom = todayStr();
    filterTo   = todayStr();
  }

  try {
    // 1. Ambil data receipts Loyverse (Berdasarkan filter rentang waktu)
    const receiptData = await apiGet(`/api/receipts?from=${filterFrom}&to=${filterTo}`);
    const receipts = receiptData.receipts || [];

    // 2. Ambil data members Supabase
    const members = await apiGet('/api/members');

    // Proses data & Render komponen dashboard
    processKpis(receipts, members);
    renderComplexCharts(receipts); 
    renderVisitorTable(receipts);
    renderRevenueTable(receipts);
    renderDailyBreakdown(receipts);

    // Filter segmentasi member manajemen
    const newMembers = members.filter(m => m.membership_status === 'Active' && new Date(m.member_since) >= new Date(filterFrom));
    const expiringMembers = members.filter(m => m.membership_status === 'Active' && daysLeft(m.renewal_due) <= 7 && daysLeft(m.renewal_due) >= 0);
    const pausedMembers = members.filter(m => m.membership_status === 'Paused');

    renderTables(newMembers, expiringMembers, pausedMembers);

  } catch (err) {
    console.error('Error memuat data dashboard:', err);
    showToast('❌ Gagal memuat data dari API internal.');
  }
}

// ── KPI PROCESSING ──
function processKpis(receipts, members) {
  // Hitung total uang masuk dari tipe transaksi SALE
  const totalRev = receipts
    .filter(r => r.receipt_type === 'SALE')
    .reduce((acc, r) => acc + (r.total_money || 0), 0);

  document.getElementById('kpi-revenue').textContent = fmtMoney(totalRev);
  document.getElementById('kpi-revenue-sub').textContent = `${receipts.length} total transaksi`;

  // Filter pendaftaran baru sesuai rentang pilihan
  const newM = members.filter(m => m.membership_status === 'Active' && new Date(m.member_since) >= new Date(filterFrom));
  document.getElementById('kpi-new-members').textContent = newM.length;

  // Angka expiring member dalam kurun waktu 7 hari ke depan
  const expM = members.filter(m => m.membership_status === 'Active' && daysLeft(m.renewal_due) <= 7 && daysLeft(m.renewal_due) >= 0);
  document.getElementById('kpi-expiring-members').textContent = expM.length;

  // Pengunjung dihitung berdasarkan jumlah baris receipt yang tercatat
  document.getElementById('kpi-visitors').textContent = receipts.length;
}

// ── RENDER TABEL UTAMA (NAMA, PLAN, REMINDER) ──
function renderTables(newMembers, expiringMembers, pausedMembers) {
  const expiringBody = document.getElementById('table-expiring-body');
  
  if (expiringMembers.length === 0) {
    expiringBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--muted)">Semua masa aktif member aman! 🎉</td></tr>`;
  } else {
    expiringBody.innerHTML = expiringMembers.map(m => {
      const days = daysLeft(m.renewal_due);
      const urgencyStyle = days <= 3 ? 'color:var(--red); font-weight:bold;' : 'color:var(--orange);';
      
      return `<tr>
        <td><strong>${m.name}</strong></td>
        <td><span class="badge badge-gold">${m.membership_level || 'Standard Plan'}</span></td>
        <td style="text-align: center;">
          <button class="btn-refresh" style="display:inline-flex; margin:0 auto; padding:4px 10px; border-color:var(--orange);" 
                  onclick="showToast('🔔 Reminder terkirim ke ${m.name} (${days} Hari Lagi Expired)')">
            <span style="${urgencyStyle}">⚡ Kirimkan (${days}d)</span>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  // Render New Members Table
  const newBody = document.getElementById('table-new-members-body');
  if (newMembers.length === 0) {
    newBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--muted)">Tidak ada pendaftaran baru.</td></tr>`;
  } else {
    newBody.innerHTML = newMembers.map(m => `<tr>
      <td><strong>${m.name}</strong></td>
      <td><span class="badge badge-gold">${m.membership_level || '—'}</span></td>
      <td>${fmtDate(m.member_since)}</td>
    </tr>`).join('');
  }
}

// ── RENDER LINE CHART REVENUE TREND (TANPA PRODUCT DONUT CHART) ──
function renderComplexCharts(receipts) {
  const revenueByDate = {};
  receipts.forEach(r => {
    const dateStr = r.created_at.split('T')[0];
    revenueByDate[dateStr] = (revenueByDate[dateStr] || 0) + r.total_money;
  });

  const sortedDates = Object.keys(revenueByDate).sort();
  const revenueValues = sortedDates.map(d => revenueByDate[d]);

  if (revenueChartInstance) revenueChartInstance.destroy();

  const ctxLine = document.getElementById('revenueChart').getContext('2d');
  revenueChartInstance = new Chart(ctxLine, {
    type: 'line',
    data: {
      labels: sortedDates.map(d => fmtDate(d)),
      datasets: [{
        label: 'Revenue Harian (IDR)',
        data: revenueValues,
        borderColor: '#d4a84b',
        backgroundColor: 'rgba(212, 168, 75, 0.1)',
        fill: true,
        tension: 0.25,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: '#21262d' }, ticks: { color: '#7d8590' } },
        x: { grid: { display: false }, ticks: { color: '#7d8590' } }
      }
    }
  });
}

// ── DETAIL PENGUNJUNG (Nama, Email, Session/Layanan) ──
// Badge warna per jenis sesi, biar gampang dipindai sekilas
function sessionBadgeClass(sessionName) {
  if (sessionName === PRODUCT_SINGLE)  return 'badge-blue';
  if (sessionName === PRODUCT_DAYPASS) return 'badge-teal';
  return 'badge-purple';
}

function renderVisitorTable(receipts) {
  const tbody = document.getElementById('table-visitors-body');
  if (!tbody) return;

  const sorted = [...receipts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  updateVisitorCount(sorted.length);

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted)">Belum ada pengunjung tercatat pada periode ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map(r => {
    const name  = r.customer_name || 'Walk-in Guest';
    const email = r.customer_email
      ? r.customer_email
      : `<span style="color:var(--muted)">—</span>`;

    const sessions = (r.sessions && r.sessions.length) ? r.sessions : ['—'];
    const sessionBadges = sessions
      .map(s => `<span class="badge ${sessionBadgeClass(s)}">${s}</span>`)
      .join(' ');

    const time = new Date(r.created_at).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    return `<tr>
      <td><strong>${name}</strong></td>
      <td class="cell-email">${email}</td>
      <td class="cell-session">${sessionBadges}</td>
      <td class="cell-time">${time}</td>
    </tr>`;
  }).join('');
}

// Pencarian cepat berdasarkan nama, email, atau session
function filterVisitorTable() {
  const query = document.getElementById('visitor-search').value.trim().toLowerCase();
  const rows = document.querySelectorAll('#table-visitors-body tr');
  let visible = 0;

  rows.forEach(row => {
    const matches = row.textContent.toLowerCase().includes(query);
    row.style.display = matches ? '' : 'none';
    if (matches) visible++;
  });

  updateVisitorCount(visible);
}

function updateVisitorCount(count) {
  const badge = document.getElementById('visitor-count-badge');
  if (badge) badge.textContent = `${count} pengunjung`;
}

// ── REVENUE SUMMARY OPERATIONS ──
function renderRevenueTable(receipts) {
  const summary = {};
  receipts.forEach(r => {
    (r.line_items || []).forEach(item => {
      const name = item.item_name || 'Produk Lain';
      if (!summary[name]) summary[name] = { count: 0, revenue: 0 };
      summary[name].count += (item.quantity || 1);
      summary[name].revenue += (item.total_money || 0);
    });
  });

  document.getElementById('revenue-period-label').textContent = `${fmtDate(filterFrom)} - ${fmtDate(filterTo)}`;

  const body = document.getElementById('revenue-table');
  const keys = Object.keys(summary);
  if (keys.length === 0) {
    body.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--muted)">Tidak ada rincian item.</td></tr>`;
    return;
  }

  body.innerHTML = keys.map(k => `<tr>
    <td><strong>${k}</strong></td>
    <td>${summary[k].count}x</td>
    <td>${fmtMoney(summary[k].revenue)}</td>
  </tr>`).join('');
}

// ── DAILY BREAKDOWN BARS ──
function renderDailyBreakdown(receipts) {
  const container = document.getElementById('daily-breakdown-container');
  const daysData = {};

  receipts.forEach(r => {
    const dateStr = r.created_at.split('T')[0];
    if (!daysData[dateStr]) daysData[dateStr] = { total: 0, tx: 0 };
    daysData[dateStr].total += r.total_money;
    daysData[dateStr].tx++;
  });

  const sorted = Object.keys(daysData).sort().reverse();
  if (sorted.length === 0) {
    container.innerHTML = `<div style="padding:20px; color:var(--muted)">Belum ada distribusi harian.</div>`;
    return;
  }

  const maxTotal = Math.max(...Object.values(daysData).map(d => d.total)) || 1;

  container.innerHTML = sorted.map(dateStr => {
    const d = daysData[dateStr];
    const barW = (d.total / maxTotal) * 100;
    const label = new Date(dateStr).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
    const meta = `${d.tx} Transaksi tercatat`;

    return `<div class="daily-item" style="padding: 12px 20px 4px;">
      <div class="daily-date" style="font-weight:500; margin-bottom:4px;">${label}</div>
      <div class="daily-bars" style="display:flex; align-items:center; gap:12px;">
        <div style="flex:1; height:6px; background:var(--surface2); border-radius:3px; overflow:hidden">
          <div style="height:100%; width:${barW}%; background:var(--gold); border-radius:3px; transition:width .5s"></div>
        </div>
        <div class="daily-meta" style="font-family:'DM Mono', monospace; font-size:12px;">${fmtMoney(d.total)}</div>
      </div>
    </div>
    <div style="padding:2px 20px 12px; font-size:11px; font-family:'DM Mono',monospace; color:var(--muted); border-bottom:1px solid var(--border)">${meta}</div>`;
  }).join('');
}

// ── SKELETON LOADING PLACEHOLDER ──
function showLoadingSkeletons() {
  const loadingHtml = `<tr><td colspan="3" style="text-align:center; color:var(--muted)">Menghubungkan Server API...</td></tr>`;
  document.getElementById('table-expiring-body').innerHTML = loadingHtml;
  document.getElementById('table-new-members-body').innerHTML = loadingHtml;

  const visitorBody = document.getElementById('table-visitors-body');
  if (visitorBody) visitorBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--muted)">Menghubungkan Server API...</td></tr>`;
}

// ── TOAST ALERTS SYSTEM ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// Runtime Initialization
document.getElementById('currentDate').textContent = new Date().toLocaleDateString('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

// Jalankan Load Data Pertama Kali saat Aplikasi Terbuka
loadAll();