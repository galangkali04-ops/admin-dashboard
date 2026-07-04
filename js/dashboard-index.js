// ╔══════════════════════════════════════════════════════════════╗
// ║  SANTAI RECOVERY SPA — Admin Dashboard JS                   ║
// ║  v2.2 — Timezone WITA, Net Sales Akurat, Payment Breakdown  ║
// ║         per-payment (fix split payment), Expenses Supabase  ║
// ╚══════════════════════════════════════════════════════════════╝

const BASE_URL        = ''; // server-additions.js sekarang serve frontend & API dari origin yang sama

let currentPreset               = 'today';
let filterFrom                  = '';
let filterTo                    = '';
let revenueChartInstance        = null;
let visitorCategoryChartInstance = null;
let lastReceiptsData            = [];
let currentVisitorView          = 'bar';

// ── AUTH GUARD ──
// Kalau belum login, langsung lempar ke halaman login sebelum sempat minta data apapun.
(function requireLogin() {
    if (!localStorage.getItem('auth_token')) {
        window.location.href = 'login.html';
    }
})();

function logout() {
    localStorage.removeItem('auth_token');
    window.location.href = 'login.html';
}

function authHeaders(extra = {}) {
    const token = localStorage.getItem('auth_token');
    return { ...extra, Authorization: `Bearer ${token}` };
}

// Kalau token sudah gak valid/kadaluarsa (401 dari server), otomatis tendang ke login
function handleAuthFailure(status) {
    if (status === 401) {
        localStorage.removeItem('auth_token');
        window.location.href = 'login.html';
        return true;
    }
    return false;
}

// ── API HELPERS ──
async function apiGet(path) {
    const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
    if (handleAuthFailure(res.status)) return new Promise(() => {}); // stop di sini, redirect lagi jalan
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
}
async function apiPost(path, data) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(data)
    });
    if (handleAuthFailure(res.status)) return new Promise(() => {});
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
}
async function apiDelete(path) {
    const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers: authHeaders() });
    if (handleAuthFailure(res.status)) return new Promise(() => {});
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── DATE HELPERS (WITA = UTC+8) ──
function witaDate(offsetDays = 0) {
    const now  = new Date();
    const wita = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    if (offsetDays) wita.setDate(wita.getDate() + offsetDays);
    return wita.toISOString().split('T')[0];
}
function todayStr()     { return witaDate(0); }
function yesterdayStr() { return witaDate(-1); }
function daysAgoStr(n)  { return witaDate(-n); }

// ── PRESET HANDLER ──
function setPreset(preset, btn) {
    currentPreset = preset;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const rangeRow = document.getElementById('customRangeRow');
    const errorEl  = document.getElementById('customRangeError');
    if (errorEl) errorEl.textContent = '';

    if (preset === 'custom') {
        // Cuma buka input tanggal, jangan langsung loadAll() — tunggu user
        // pilih From/To lalu klik Apply (biar ga nembak API tiap 1 tanggal keganti).
        if (rangeRow) {
            rangeRow.style.display = 'flex';
            const fromInput = document.getElementById('customFrom');
            const toInput   = document.getElementById('customTo');
            if (fromInput && !fromInput.value) fromInput.value = filterFrom || todayStr();
            if (toInput   && !toInput.value)   toInput.value   = filterTo   || todayStr();
        }
        return;
    }
    if (rangeRow) rangeRow.style.display = 'none';

    const today = todayStr();
    if (preset === 'today') {
        filterFrom = today; filterTo = today;
    } else if (preset === 'yesterday') {
        filterFrom = yesterdayStr(); filterTo = yesterdayStr();
    } else if (preset === '7d') {
        filterFrom = daysAgoStr(7); filterTo = today;
    } else if (preset === '30d') {
        filterFrom = daysAgoStr(30); filterTo = today;
    } else if (preset === 'thisMonth') {
        const now  = new Date();
        const wita = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        filterFrom = wita.getFullYear() + '-' + String(wita.getMonth() + 1).padStart(2, '0') + '-01';
        filterTo   = today;
    }
    loadAll();
}

// ── CUSTOM RANGE HANDLER ──
function applyCustomRange() {
    const fromInput = document.getElementById('customFrom');
    const toInput   = document.getElementById('customTo');
    const errorEl   = document.getElementById('customRangeError');
    if (!fromInput || !toInput) return;

    const from = fromInput.value;
    const to   = toInput.value;

    if (!from || !to) {
        if (errorEl) errorEl.textContent = 'Pick both dates.';
        return;
    }
    if (new Date(from) > new Date(to)) {
        if (errorEl) errorEl.textContent = '"From" must be before "To".';
        return;
    }

    if (errorEl) errorEl.textContent = '';
    filterFrom = from;
    filterTo   = to;
    loadAll();
}

// ── FORMATTERS ──
function fmtMoney(v) {
    if (v == null) return 'Rp 0';
    if (v < 0) return '-Rp ' + Math.round(Math.abs(v)).toLocaleString('en-US');
    return 'Rp ' + Math.round(v).toLocaleString('en-US');
}
function fmtDate(isoStr) {
    if (!isoStr) return '--';
    const d = new Date(isoStr.length === 10 ? isoStr + 'T00:00:00+08:00' : isoStr);
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}
function fmtDateTime(utcIso) {
    if (!utcIso) return '--';
    return new Intl.DateTimeFormat('en-US', {
        day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Makassar'
    }).format(new Date(utcIso));
}
function daysLeft(dueStr) {
    if (!dueStr) return 0;
    return Math.ceil((new Date(dueStr) - new Date()) / (1000 * 60 * 60 * 24));
}

// ── LOADING OVERLAY ──
function showLoadingOverlay() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.style.display = 'flex';
}
function hideLoadingOverlay() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.style.display = 'none';
}

// ── MAIN LOAD ──
async function loadAll() {
    showLoadingOverlay();
    showLoadingSkeletons();
    if (!filterFrom) { filterFrom = todayStr(); filterTo = todayStr(); }

    try {
        const [receiptData, members] = await Promise.all([
            apiGet('/api/receipts?from=' + filterFrom + '&to=' + filterTo),
            apiGet('/api/members')
        ]);

        const receipts = receiptData.receipts || [];

        processKpis(receipts, members);
        renderKelapaCounter(receipts);
        renderComplexCharts(receipts);
        renderPaymentBreakdown(receipts);
        renderVisitorTable(receipts);
        renderRevenueTable(receipts);
        renderDiscountUsageTable(receipts);
        renderDailyBreakdown(receipts);
        renderVisitorBreakdown(receipts);

        const newMembers      = members.filter(m => m.membership_status === 'Active' && new Date(m.member_since) >= new Date(filterFrom));
        const expiringMembers = members.filter(m => m.membership_status === 'Active' && daysLeft(m.renewal_due) <= 7 && daysLeft(m.renewal_due) >= 0);

        renderTables(newMembers, expiringMembers);

    } catch (err) {
        console.error('Error loading dashboard:', err);
        showToast('Failed to load data from API. Check server console.');
    } finally {
        hideLoadingOverlay();
    }
}

// ── KPI CARDS ──
function processKpis(receipts, members) {
    const netSales    = receipts.reduce((acc, r) => acc + (r.total_money || 0), 0);
    const saleCount   = receipts.filter(r => r.receipt_type === 'SALE').length;
    const refundCount = receipts.filter(r => r.receipt_type === 'REFUND').length;

    var el;
    el = document.getElementById('kpi-revenue');
    if (el) el.textContent = fmtMoney(netSales);
    el = document.getElementById('kpi-revenue-sub');
    if (el) el.textContent = saleCount + ' receipts' + (refundCount ? ' \u00b7 ' + refundCount + ' refund' : '');

    // Total visitor — dihitung dengan aturan sama seperti Sales Monitor:
    // struk yang isinya cuma retail (coconut/snack, tanpa sesi) TIDAK dihitung
    // sebagai tamu, dan nama ganda dalam 1 struk (mis. "Polina & Vladimir")
    // dihitung sebagai 2 tamu terpisah.
    const breakdown = computeVisitorBreakdown(receipts);
    el = document.getElementById('kpi-visitors');
    if (el) el.textContent = breakdown.total;
    el = document.getElementById('kpi-visitors-sub');
    if (el) el.textContent = breakdown.total + ' visitors \u00b7';

    const expM = members.filter(m => m.membership_status === 'Active' && daysLeft(m.renewal_due) <= 7 && daysLeft(m.renewal_due) >= 0);
    el = document.getElementById('kpi-expiring-members');
    if (el) el.textContent = expM.length;

    const newM = members.filter(m => m.membership_status === 'Active' && new Date(m.member_since) >= new Date(filterFrom));
    el = document.getElementById('kpi-new-members');
    if (el) el.textContent = newM.length;
}

// ── KATEGORI visitor (aturan sama persis dengan Sales Monitor) ──
// Daftar nama produk sesi asli Loyverse. Kalau nama produk di Loyverse-mu
// berbeda, sesuaikan daftar ini.
const SESSION_PRODUCTS = [
    'Single Session', 'Day Pass', 'Weekly Pass', 'Monthly Pass',
    '3 Months Pass', '6 Months Pass', '10 Pass', '1 Year',
    'GROUP SESSION', 'PRIVATE SESSION', 'Upgrade Session'
];
const MV_PREFIX = 'MV ';

// Struk yang isinya cuma retail (coconut water, snack, towel, dll) tanpa
// item sesi/MV sama sekali → BUKAN kunjungan tamu, jangan dihitung.
function isRetailOnlyReceipt(items) {
    var names = (items || []).map(function(i) { return i.item_name || ''; });
    if (names.length === 0) return false;
    var hasSession = names.some(function(n) {
        return SESSION_PRODUCTS.some(function(p) { return p.toLowerCase() === n.toLowerCase(); });
    });
    var hasMV = names.some(function(n) { return n.indexOf(MV_PREFIX) === 0; });
    return !hasSession && !hasMV;
}

// Kategori sesi untuk 1 struk (dipakai buat breakdown), MV diprioritaskan
// dulu baru dicocokkan ke daftar SESSION_PRODUCTS.
function sessionCategoryLabel(items) {
    var names = (items || []).map(function(i) { return i.item_name || ''; });
    var mv = names.find(function(n) { return n.indexOf(MV_PREFIX) === 0; });
    if (mv) return mv;
    for (var i = 0; i < SESSION_PRODUCTS.length; i++) {
        var prod = SESSION_PRODUCTS[i];
        if (names.some(function(n) { return n.toLowerCase() === prod.toLowerCase(); })) return prod;
    }
    return 'Other';
}

// Satu struk kadang dibayar 1 orang tapi nama-nya berisi 2+ tamu, misal
// "Polina & Vladimir". Ini dipecah jadi nama-nama terpisah supaya jumlah
// tamu tercatat benar (dihitung 2), walau struknya cuma 1.
function splitGuestNames(rawName) {
    var name = (rawName || '').trim();
    if (!name) return ['Walk-in Guest'];
    var parts = name.split(/\s*(?:&|\+|\/| dan | and )\s*/i).map(function(s) { return s.trim(); }).filter(Boolean);
    return parts.length > 1 ? parts : [name];
}

function computeVisitorBreakdown(receipts) {
    // Refund tidak dihitung sebagai kunjungan baru
    const salesOnly = receipts.filter(function(r) { return r.receipt_type !== 'REFUND'; });
    const counts = {};
    let total = 0;
    salesOnly.forEach(function(r) {
        if (isRetailOnlyReceipt(r.line_items)) return; // coconut/retail-only, bukan tamu
        var label  = sessionCategoryLabel(r.line_items);
        var guests = splitGuestNames(r.customer_name).length;
        counts[label] = (counts[label] || 0) + guests;
        total += guests;
    });
    return { counts: counts, total: total };
}

function renderVisitorBreakdownPanel(receipts) {
    var container = document.getElementById('visitor-breakdown-container');
    if (!container) return;

    var breakdown = computeVisitorBreakdown(receipts);
    var counts    = breakdown.counts;
    var total     = breakdown.total;

    var badge = document.getElementById('visitor-breakdown-total-badge');
    if (badge) badge.textContent = total + ' visitor';

    if (total === 0) {
        container.innerHTML = '<div style="padding:16px 0;color:var(--muted);font-size:13px;text-align:center;">No visitor data for this period.</div>';
        return;
    }

    var palette = ['var(--blue)', 'var(--teal)', 'var(--purple)', 'var(--gold)', 'var(--orange)', 'var(--green)', 'var(--red)', 'var(--muted)'];
    var order   = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
    var html    = '';

    order.forEach(function(cat, i) {
        var count = counts[cat];
        var pct   = total ? Math.round((count / total) * 100) : 0;
        var color = cat === 'Other' ? 'var(--muted)' : palette[i % palette.length];
        html += '<div class="visitor-cat-row">';
        html += '  <div class="visitor-cat-head">';
        html += '    <span>' + cat + '</span>';
        html += '    <span class="visitor-cat-count" style="color:' + color + '">' + count + ' (' + pct + '%)</span>';
        html += '  </div>';
        html += '  <div class="visitor-cat-bar-wrap">';
        html += '    <div class="visitor-cat-bar" style="width:' + pct + '%;background:' + color + '"></div>';
        html += '  </div>';
        html += '</div>';
    });

    html += '<div class="visitor-cat-total-row">';
    html += '  <span>Total visitors</span>';
    html += '  <strong style="font-family:\'DM Mono\',monospace;color:var(--text);">' + total + '</strong>';
    html += '</div>';

    container.innerHTML = html;
}

// ── DISPATCHER: 2 opsi tampilan data Kategori visitor (Bar / Grafik) ──
function renderVisitorBreakdown(receipts) {
    lastReceiptsData = receipts;
    if (currentVisitorView === 'chart') {
        renderVisitorCategoryChart(receipts);
    } else {
        renderVisitorBreakdownPanel(receipts);
    }
}

function setVisitorView(mode) {
    currentVisitorView = mode;

    var barBtn   = document.getElementById('btn-view-bar');
    var chartBtn = document.getElementById('btn-view-chart');
    var barBox   = document.getElementById('visitor-breakdown-container');
    var chartBox = document.getElementById('visitor-breakdown-chart-wrap');

    if (barBtn)   barBtn.classList.toggle('active', mode === 'bar');
    if (chartBtn) chartBtn.classList.toggle('active', mode === 'chart');
    if (barBox)   barBox.style.display   = mode === 'bar'   ? '' : 'none';
    if (chartBox) chartBox.style.display = mode === 'chart' ? 'block' : 'none';

    renderVisitorBreakdown(lastReceiptsData);
}

function renderVisitorCategoryChart(receipts) {
    var canvas = document.getElementById('visitorCategoryChart');
    if (!canvas) return;

    var breakdown = computeVisitorBreakdown(receipts);
    var counts    = breakdown.counts;
    var total     = breakdown.total;

    var badge = document.getElementById('visitor-breakdown-total-badge');
    if (badge) badge.textContent = total + ' visitor';

    if (visitorCategoryChartInstance) {
        visitorCategoryChartInstance.destroy();
        visitorCategoryChartInstance = null;
    }
    if (total === 0) return;

    var palette = ['#58a6ff', '#2dd4bf', '#bc8cff', '#d4a84b', '#f0883e', '#3fb950', '#f85149', '#7d8590'];
    var labels  = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
    var data    = labels.map(function(l) { return counts[l]; });
    var colors  = labels.map(function(l, i) { return l === 'Other' ? '#7d8590' : palette[i % palette.length]; });

    visitorCategoryChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: colors, borderColor: '#161b22', borderWidth: 2 }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#7d8590', boxWidth: 10, font: { size: 10 } } }
            }
        }
    });
}

// ── MEMBER TABLES ──
function renderTables(newMembers, expiringMembers) {
    var expiringBody = document.getElementById('table-expiring-body');
    if (!expiringBody) return;

    if (expiringMembers.length === 0) {
        expiringBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">All memberships are up to date!</td></tr>';
    } else {
        var rows = '';
        expiringMembers.forEach(function(m) {
            var days   = daysLeft(m.renewal_due);
            var color  = days <= 3 ? 'var(--red)' : 'var(--orange)';
            rows += '<tr>';
            rows += '<td><strong>' + m.name + '</strong></td>';
            rows += '<td><span class="badge badge-gold">' + (m.membership_level || 'Standard') + '</span></td>';
            rows += '<td style="text-align:center;"><button class="btn-refresh" style="padding:4px 10px;border-color:var(--orange);" onclick="showToast(\'Reminder sent to ' + m.name + ' (' + days + ' days left)\')">';
            rows += '<span style="color:' + color + ';font-weight:bold;">' + days + 'd</span></button></td>';
            rows += '</tr>';
        });
        expiringBody.innerHTML = rows;
    }

    var newBody = document.getElementById('table-new-members-body');
    if (!newBody) return;
    if (newMembers.length === 0) {
        newBody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">No new registrations.</td></tr>';
    } else {
        var rows2 = '';
        newMembers.forEach(function(m) {
            rows2 += '<tr><td><strong>' + m.name + '</strong></td><td><span class="badge badge-gold">' + (m.membership_level || '--') + '</span></td><td>' + fmtDate(m.member_since) + '</td></tr>';
        });
        newBody.innerHTML = rows2;
    }
}

// ── PAYMENT METHOD BREAKDOWN (Cash / Card / QRIS / Transfer) ──
// Deteksi kategori dipisah dari payBadge() supaya tidak mengubah tampilan
// badge yang sudah ada di tabel Visitor Details. OVO & GoPay digabung ke
// kategori QRIS (sama-sama e-wallet/QR-based payment).
const PAYMENT_BUCKETS = {
    cash:     { label: 'Cash',            color: 'var(--green)'  },
    card:     { label: 'Card',            color: 'var(--blue)'   },
    qris:     { label: 'QRIS / E-Wallet', color: 'var(--purple)' },
    transfer: { label: 'Transfer',        color: 'var(--teal)'   },
    other:    { label: 'Other',           color: 'var(--muted)'  }
};

// Nerima SATU payment object (p) + receipt induknya (r) untuk fallback.
// Dipanggil per-item dari r.payments di computePaymentBreakdown, supaya
// struk dengan split payment (mis. separuh cash separuh card) dihitung
// benar ke masing-masing kategori — bukan numplek semua ke payment pertama.
function paymentBucketKey(p, r) {
    if (!p) {
        // Fallback kalau payments kosong sama sekali (sering terjadi di data lama)
        const note = (r.note || '').toLowerCase();
        if (note.includes('cash') || note.includes('tunai')) return 'cash';
        return 'other';
    }

    // Coba semua kemungkinan field nama/tipe payment dari Loyverse
    let raw = [
        p.name,
        p.payment_type_name,
        p.type,
        p.payment_type,
        p.gateway_name,
        r.payment_type
    ].filter(Boolean).join(' ').toLowerCase();

    if (raw.includes('cash') || raw.includes('tunai')) return 'cash';
    if (raw.includes('card') || raw.includes('credit') || raw.includes('debit')) return 'card';
    if (raw.includes('qris') || raw.includes('qr') || raw.includes('ovo') || raw.includes('gopay')) return 'qris';
    if (raw.includes('transfer') || raw.includes('bank')) return 'transfer';

    console.warn(`Unknown payment (old data?):`, raw, r.receipt_id);
    return 'other';
}

// Ambil nominal 1 payment. Loyverse API biasanya pakai field "money_amount"
// di tiap objek payments[]. Kalau field itu tidak ada (versi API beda),
// fallback ke 0 supaya tidak salah hitung diam-diam — cek console warning.
function paymentAmount(p) {
    if (!p) return 0;
    if (typeof p.money_amount === 'number') return p.money_amount;
    if (typeof p.paid_at === 'number')       return p.paid_at; // fallback lama, jarang kepakai
    console.warn('Payment object tanpa field nominal yang dikenal:', p);
    return 0;
}

// Net per metode bayar (SALE dikurangi REFUND di metode yang sama), biar
// totalnya nyambung sama angka KPI "Net Sales" di atas.
// Loop per-payment (bukan per-receipt) supaya split payment kehitung ke
// masing-masing kategori dengan nominal aslinya, bukan seluruh total struk
// ditumpuk ke payment pertama saja.
function computePaymentBreakdown(receipts) {
    var totals = { cash: 0, card: 0, qris: 0, transfer: 0, other: 0 };

    receipts.forEach(function(r) {
        var isRefund = r.receipt_type === 'REFUND';
        var payments = (r.payments && r.payments.length) ? r.payments : [null];

        payments.forEach(function(p) {
            var key    = paymentBucketKey(p, r);
            var amount = p ? paymentAmount(p) : (r.total_money || 0);

            totals[key] += isRefund ? -Math.abs(amount) : amount;
        });
    });

    return totals;
}

function renderPaymentBreakdown(receipts) {
    var container = document.getElementById('payment-breakdown-container');
    if (!container) return;

    var totals = computePaymentBreakdown(receipts);
    var netTotal = Object.values(totals).reduce((sum, val) => sum + val, 0);

    console.log('Payment Totals Final:', totals);   // ← Debug
    console.log('Net Total:', netTotal);

    var badge = document.getElementById('payment-breakdown-total-badge');
    if (badge) badge.textContent = fmtMoney(netTotal);

    // Hitung scale untuk bar
    var scaleBase = Object.values(totals).reduce((sum, val) => sum + Math.abs(val), 0);

    var order = Object.keys(PAYMENT_BUCKETS)
        .filter(k => totals[k] !== 0)
        .sort((a, b) => Math.abs(totals[b]) - Math.abs(totals[a]));

    if (order.length === 0 || netTotal === 0) {
        container.innerHTML = '<div style="padding:40px 20px;color:var(--muted);font-size:13px;text-align:center;">No payment data for this period.</div>';
        return;
    }

    var html = '';
    order.forEach(function(key) {
        var info = PAYMENT_BUCKETS[key];
        var value = totals[key];
        var pct = scaleBase ? Math.round((Math.abs(value) / scaleBase) * 100) : 0;

        html += `<div class="visitor-cat-row">
            <div class="visitor-cat-head">
                <span>${info.label}</span>
                <span class="visitor-cat-count" style="color:${value < 0 ? 'var(--red)' : info.color}">
                    ${fmtMoney(value)} (${pct}%)
                </span>
            </div>
            <div class="visitor-cat-bar-wrap">
                <div class="visitor-cat-bar" style="width:${pct}%;background:${value < 0 ? 'var(--red)' : info.color}"></div>
            </div>
        </div>`;
    });

    html += `<div class="visitor-cat-total-row">
        <span>Total Net Sales</span>
        <strong style="font-family:'DM Mono',monospace;color:${netTotal < 0 ? 'var(--red)' : 'var(--text)'};">${fmtMoney(netTotal)}</strong>
    </div>`;

    container.innerHTML = html;
}

// ── LINE CHART ──
function renderComplexCharts(receipts) {
    var revenueByDate = {};
    receipts.forEach(function(r) {
        var key = r.local_date || r.created_at.split('T')[0];
        revenueByDate[key] = (revenueByDate[key] || 0) + r.total_money;
    });

    var sortedDates   = Object.keys(revenueByDate).sort();
    var revenueValues = sortedDates.map(function(d) { return revenueByDate[d]; });

    if (revenueChartInstance) revenueChartInstance.destroy();

    var canvas = document.getElementById('revenueChart');
    if (!canvas) return;

    revenueChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: sortedDates.map(function(d) { return fmtDate(d); }),
            datasets: [{
                label: 'Net Sales (IDR)',
                data: revenueValues,
                borderColor: '#d4a84b',
                backgroundColor: 'rgba(212,168,75,0.1)',
                fill: true, tension: 0.25, borderWidth: 2,
                pointRadius: 4, pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    grid: { color: '#21262d' },
                    ticks: { color: '#7d8590', callback: function(v) { return 'Rp ' + (v/1000).toFixed(0) + 'k'; } }
                },
                x: { grid: { display: false }, ticks: { color: '#7d8590' } }
            }
        }
    });
}

// ── VISITOR TABLE (ala Sales Monitor: No / Nama / Session / 🥥 / Bayar / Total) ──
const SESSION_LABEL_MAP = {
    'Single Session':  { label: 'Single',   cls: 'b-single'  },
    'Day Pass':        { label: 'Day Pass', cls: 'b-daypass' },
    'Weekly Pass':     { label: 'Weekly',   cls: 'b-member'  },
    'Monthly Pass':    { label: 'Monthly',  cls: 'b-member'  },
    '3 Months Pass':   { label: '3 Months', cls: 'b-member'  },
    '6 Months Pass':   { label: '6 Months', cls: 'b-member'  },
    '10 Pass':         { label: '10 Pass',  cls: 'b-member'  },
    '1 Year':          { label: '1 Year',   cls: 'b-member'  },
    'GROUP SESSION':   { label: 'Group',    cls: 'b-group'   },
    'PRIVATE SESSION': { label: 'Private',  cls: 'b-private' },
    'Upgrade Session': { label: 'Upgrade',  cls: 'b-upgrade' }
};

function sessionBadgeInfo(items) {
    var names = (items || []).map(function(i) { return i.item_name || ''; });
    var mv = names.find(function(n) { return n.indexOf(MV_PREFIX) === 0; });
    if (mv) return { label: mv, cls: 'b-mv' };
    for (var i = 0; i < SESSION_PRODUCTS.length; i++) {
        var prod = SESSION_PRODUCTS[i];
        if (names.some(function(n) { return n.toLowerCase() === prod.toLowerCase(); })) {
            var info = SESSION_LABEL_MAP[prod];
            if (info) return info;
        }
    }
    return { label: 'Other', cls: 'b-sess-other' };
}

function sessionBadgeHtml(items) {
    var info = sessionBadgeInfo(items);
    return '<span class="badge ' + info.cls + '">' + info.label + '</span>';
}

// Badge metode bayar — nama field payment Loyverse bisa beda-beda tergantung
// versi API, jadi dicoba beberapa kemungkinan biar tetap kebaca.
// Catatan: badge ini cuma menampilkan payment PERTAMA di tabel Visitor
// Details (sekadar tampilan ringkas per baris), beda dengan perhitungan
// nominal di Payment Method Breakdown yang sudah loop semua payments[].
function payBadge(r) {
    var p   = (r.payments && r.payments[0]) || {};
    var raw = (p.name || p.type || p.payment_type_name || p.payment_type || r.payment_type || '').toString().toLowerCase();
    if (!raw) return '<span class="badge b-pay-other">\u2014</span>';
    if (raw.indexOf('cash') !== -1 || raw.indexOf('tunai') !== -1) return '<span class="badge b-cash">Cash</span>';
    if (raw.indexOf('card') !== -1 || raw.indexOf('debit') !== -1 || raw.indexOf('credit') !== -1) return '<span class="badge b-card">Card</span>';
    if (raw.indexOf('qris') !== -1 || raw.indexOf('qr') !== -1) return '<span class="badge b-qris">QRIS</span>';
    if (raw.indexOf('transfer') !== -1) return '<span class="badge b-transfer">Transfer</span>';
    if (raw.indexOf('ovo') !== -1) return '<span class="badge b-qris">OVO</span>';
    if (raw.indexOf('gopay') !== -1) return '<span class="badge b-qris">GoPay</span>';
    return '<span class="badge b-pay-other">' + raw + '</span>';
}

// Badge diskon — ambil nama diskon (mis. "BTC", "Staff Discount") + persentasenya
// dari line_items (dikirim server-additions.js: discount_name, discount_percent).
// Beberapa item dalam 1 struk bisa punya diskon berbeda, jadi di-dedupe by label.
function discountBadgeHtml(items) {
    var labels = [];
    var seen   = {};
    (items || []).forEach(function(li) {
        if ((li.discount_amount || 0) > 0) {
            var name  = li.discount_name || 'Discount';
            var pct   = li.discount_percent ? ' (' + li.discount_percent + '%)' : '';
            var label = name + pct;
            if (!seen[label]) { seen[label] = true; labels.push(label); }
        }
    });
    if (labels.length === 0) return '<span class="no-coconut">\u00b7</span>';
    return labels.map(function(l) { return '<span class="badge b-discount">' + l + '</span>'; }).join(' ');
}

// ── PENGGUNAAN DISKON TERBANYAK ──
// Dihitung per "orang" (sama seperti Kategori visitor), bukan cuma per
// struk — jadi kalau 1 struk isinya "Polina & Vladimir" pakai diskon BTC,
// itu dihitung 2 pemakaian, bukan 1. Refund tidak dihitung sebagai pemakaian.
// Kalau 1 struk punya beberapa item dengan diskon nama BEDA (mis. BTC di
// satu sesi, Staff Discount di sesi lain), masing-masing dihitung terpisah;
// tapi kalau nama diskonnya SAMA di beberapa item, cuma dihitung 1x per
// struk (dedupe), biar tidak dobel-hitung 1 tamu jadi 2 pemakaian.
function computeDiscountUsage(receipts) {
    var salesOnly = (receipts || []).filter(function(r) { return r.receipt_type !== 'REFUND'; });
    var usage = {}; // name -> { guests, transactions, amount }

    salesOnly.forEach(function(r) {
        var items = r.line_items || [];
        var amountByName = {};
        items.forEach(function(li) {
            if ((li.discount_amount || 0) > 0) {
                var name = li.discount_name || 'Other Discount';
                amountByName[name] = (amountByName[name] || 0) + (li.discount_amount || 0);
            }
        });

        var discNames = Object.keys(amountByName);
        if (discNames.length === 0) return;

        var guestCount = splitGuestNames(r.customer_name).length;

        discNames.forEach(function(name) {
            if (!usage[name]) usage[name] = { guests: 0, transactions: 0, amount: 0 };
            usage[name].guests       += guestCount;
            usage[name].transactions += 1;
            usage[name].amount       += amountByName[name];
        });
    });

    return usage;
}

function renderDiscountUsageTable(receipts) {
    var body = document.getElementById('discount-usage-table');
    if (!body) return;

    var label = document.getElementById('discount-usage-period-label');
    if (label) label.textContent = fmtDate(filterFrom) + ' \u2013 ' + fmtDate(filterTo);

    var usage = computeDiscountUsage(receipts);
    var names = Object.keys(usage);

    var totalGuests = names.reduce(function(sum, n) { return sum + usage[n].guests; }, 0);
    var totalBadge = document.getElementById('discount-usage-total-badge');
    if (totalBadge) totalBadge.textContent = totalGuests + ' uses';

    if (names.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No discounts used in this period.</td></tr>';
        return;
    }

    names.sort(function(a, b) { return usage[b].guests - usage[a].guests; });

    var rows = '';
    names.forEach(function(name, i) {
        var u = usage[name];
        var topTag = i === 0 ? ' <span class="badge badge-gold">Top</span>' : '';
        rows += '<tr>';
        rows += '  <td><strong>' + name + '</strong>' + topTag + '</td>';
        rows += '  <td style="text-align:center;"><span class="badge badge-purple">' + u.guests + ' guests</span></td>';
        rows += '  <td style="text-align:center;color:var(--muted)">' + u.transactions + 'x</td>';
        rows += '  <td style="text-align:right;color:var(--red)">' + fmtMoney(u.amount) + '</td>';
        rows += '</tr>';
    });

    body.innerHTML = rows;
}

function coconutCount(items) {
    var total = 0;
    (items || []).forEach(function(li) {
        if ((li.item_name || '').toLowerCase().indexOf('coconut water') !== -1) total += Math.round(li.quantity || 1);
    });
    return total;
}

// ── KELAPA COUNTER (total botol Coconut Water terjual, sesuai POS Loyverse) ──
// Refund tidak dihitung sebagai terjual. Retail-only receipt (beli coconut
// tanpa sesi) tetap dihitung, karena ini soal jumlah botol, bukan tamu.
function computeCoconutTotal(receipts) {
    var total = 0;
    (receipts || []).forEach(function(r) {
        if (r.receipt_type === 'REFUND') return;
        total += coconutCount(r.line_items);
    });
    return total;
}

function renderKelapaCounter(receipts) {
    var el = document.getElementById('kelapaCount');
    if (el) el.textContent = computeCoconutTotal(receipts);
}

// Label baris retail-only: kalau ada coconut water tulis "Coconut", kalau
// retail lain (snack/towel) pakai nama item pertamanya.
function retailLabel(items) {
    var names = (items || []).map(function(i) { return i.item_name || ''; }).filter(Boolean);
    var hasCoconut = names.some(function(n) { return n.toLowerCase().indexOf('coconut water') !== -1; });
    if (hasCoconut) return 'Coconut';
    return names[0] || 'Other';
}

function renderVisitorTable(receipts) {
    var tbody = document.getElementById('table-visitors-body');
    if (!tbody) return;

    var sorted = receipts.slice().sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });

    // Total tamu (aturan sama seperti Kategori visitor & Sales Monitor):
    // retail-only & refund tidak dihitung. Nomor dimulai dari transaksi
    // paling awal (angka kecil) ke paling baru (angka besar).
    var totalGuestUnits = 0;
    sorted.forEach(function(r) {
        if (r.receipt_type === 'REFUND' || isRetailOnlyReceipt(r.line_items)) return;
        totalGuestUnits += splitGuestNames(r.customer_name).length;
    });
    updateVisitorCount(totalGuestUnits);

    if (sorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No visitors yet.</td></tr>';
        return;
    }

    var guestNo = totalGuestUnits + 1;
    var rows = '';

    sorted.forEach(function(r) {
        var total       = fmtMoney(r.total_money);
        var coco        = coconutCount(r.line_items);
        var cocoHtml    = coco > 0 ? '<span class="coconut-cell">\ud83e\udd65\u00d7' + coco + '</span>' : '<span class="no-coconut">\u00b7</span>';
        var discHtml    = discountBadgeHtml(r.line_items);
        var refundBadge = r.receipt_type === 'REFUND' ? ' <span class="badge" style="background:#f85149;color:#fff;font-size:9px;">REFUND</span>' : '';

        // Retail-only (coconut/snack tanpa sesi) — ga dapat nomor, ga dihitung tamu
        if (isRetailOnlyReceipt(r.line_items)) {
            rows += '<tr class="retail-row">';
            rows += '  <td class="col-no">\u2013</td>';
            rows += '  <td>' + retailLabel(r.line_items) + refundBadge + '</td>';
            rows += '  <td><span class="badge b-sess-other">\u2013</span></td>';
            rows += '  <td class="col-coconut">' + cocoHtml + '</td>';
            rows += '  <td class="col-discount">' + discHtml + '</td>';
            rows += '  <td class="col-pay">' + payBadge(r) + '</td>';
            rows += '  <td class="col-total-amt">' + total + '</td>';
            rows += '</tr>';
            return;
        }

        // Nama bisa berisi 2+ tamu (mis. "Polina & Vladimir") — masing-masing
        // dapat nomor sendiri, tapi detail transaksi cuma tampil di baris pertama.
        var names = splitGuestNames(r.customer_name);
        names.forEach(function(name, idx) {
            if (r.receipt_type !== 'REFUND') guestNo--;
            var noCell = r.receipt_type === 'REFUND' ? '\u2013' : guestNo;

            if (idx === 0) {
                rows += '<tr>';
                rows += '  <td class="col-no">' + noCell + '</td>';
                rows += '  <td><strong>' + name + '</strong>' + refundBadge + '</td>';
                rows += '  <td>' + sessionBadgeHtml(r.line_items) + '</td>';
                rows += '  <td class="col-coconut">' + cocoHtml + '</td>';
                rows += '  <td class="col-discount">' + discHtml + '</td>';
                rows += '  <td class="col-pay">' + payBadge(r) + '</td>';
                rows += '  <td class="col-total-amt">' + total + '</td>';
                rows += '</tr>';
            } else {
                rows += '<tr class="split-row">';
                rows += '  <td class="col-no">' + noCell + '</td>';
                rows += '  <td class="visitor-name">\u21b3 ' + name + '</td>';
                rows += '  <td>\u2013</td><td class="col-coconut">\u2013</td><td class="col-discount">\u2013</td><td class="col-pay">\u2013</td><td class="col-total-amt">\u2013</td>';
                rows += '</tr>';
            }
        });
    });

    tbody.innerHTML = rows;
}

function filterVisitorTable() {
    var query   = document.getElementById('visitor-search').value.trim().toLowerCase();
    var rows    = document.querySelectorAll('#table-visitors-body tr');
    var visible = 0;
    rows.forEach(function(row) {
        var match = row.textContent.toLowerCase().includes(query);
        row.style.display = match ? '' : 'none';
        if (match) visible++;
    });
    if (query) {
        var badge = document.getElementById('visitor-count-badge');
        if (badge) badge.textContent = visible + ' baris cocok';
    } else {
        renderVisitorTable(lastReceiptsData);
    }
}

function updateVisitorCount(count) {
    var badge = document.getElementById('visitor-count-badge');
    if (badge) badge.textContent = count + ' visitor';
}

// ── REVENUE TABLE ──
function renderRevenueTable(receipts) {
    var summary = {};
    receipts.forEach(function(r) {
        (r.line_items || []).forEach(function(item) {
            var name = item.item_name || 'Produk Lain';
            if (!summary[name]) summary[name] = { count: 0, revenue: 0 };
            summary[name].count   += (item.quantity    || 1);
            summary[name].revenue += (item.total_money || 0);
        });
    });

    var label = document.getElementById('revenue-period-label');
    if (label) label.textContent = fmtDate(filterFrom) + ' \u2013 ' + fmtDate(filterTo);

    var body = document.getElementById('revenue-table');
    var keys = Object.keys(summary);
    if (keys.length === 0) {
        body.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">No item details available.</td></tr>';
        return;
    }
    keys.sort(function(a, b) { return summary[b].revenue - summary[a].revenue; });
    var rows = '';
    keys.forEach(function(k) {
        rows += '<tr><td><strong>' + k + '</strong></td><td>' + summary[k].count + 'x</td>';
        rows += '<td style="color:' + (summary[k].revenue < 0 ? 'var(--red)' : 'inherit') + '">' + fmtMoney(summary[k].revenue) + '</td></tr>';
    });
    body.innerHTML = rows;
}

// ── DAILY BREAKDOWN ──
function renderDailyBreakdown(receipts) {
    var container = document.getElementById('daily-breakdown-container');
    if (!container) return;

    var daysData = {};
    receipts.forEach(function(r) {
        var key = r.local_date || r.created_at.split('T')[0];
        if (!daysData[key]) daysData[key] = { sales: 0, refunds: 0, tx: 0 };
        if (r.receipt_type === 'REFUND') daysData[key].refunds += r.total_money;
        else daysData[key].sales += r.total_money;
        daysData[key].tx++;
    });

    var sorted = Object.keys(daysData).sort().reverse();
    if (sorted.length === 0) {
        container.innerHTML = '<div style="padding:20px;color:var(--muted)">No daily distribution yet.</div>';
        return;
    }

    var maxSales = Math.max.apply(null, Object.values(daysData).map(function(d) { return d.sales; })) || 1;
    var html = '';

    sorted.forEach(function(dateKey) {
        var d        = daysData[dateKey];
        var netTotal = d.sales + d.refunds;
        var barW     = Math.max(0, (d.sales / maxSales) * 100);
        var label    = new Date(dateKey + 'T00:00:00+08:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });

        var refundNote  = d.refunds  < 0  ? ' \u00b7 <span style="color:var(--red)">Refund ' + fmtMoney(d.refunds) + '</span>' : '';

        html += '<div style="padding:12px 20px 4px;">';
        html += '  <div style="font-weight:500;margin-bottom:4px;">' + label + '</div>';
        html += '  <div style="display:flex;align-items:center;gap:12px;">';
        html += '    <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">';
        html += '      <div style="height:100%;width:' + barW + '%;background:var(--gold);border-radius:3px;transition:width .5s"></div>';
        html += '    </div>';
        html += '    <div style="font-family:\'DM Mono\',monospace;font-size:12px;color:' + (netTotal < 0 ? 'var(--red)' : 'inherit') + ';white-space:nowrap">' + fmtMoney(netTotal) + '</div>';
        html += '  </div>';
        html += '</div>';
        html += '<div style="padding:2px 20px 12px;font-size:11px;font-family:\'DM Mono\',monospace;color:var(--muted);border-bottom:1px solid var(--border)">';
        html += d.tx + ' transactions' + refundNote;
        html += '</div>';
    });

    container.innerHTML = html;
}

// ── LOADING SKELETON ──
function showLoadingSkeletons() {
    var loading3 = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Loading...</td></tr>';
    var loading4 = '<tr><td colspan="4" style="text-align:center;color:var(--muted)">Loading...</td></tr>';
    var e;
    e = document.getElementById('table-expiring-body');    if (e) e.innerHTML = loading3;
    e = document.getElementById('table-new-members-body'); if (e) e.innerHTML = loading3;
    e = document.getElementById('table-visitors-body');    if (e) e.innerHTML = loading4;
    e = document.getElementById('discount-usage-table');   if (e) e.innerHTML = loading4;
    e = document.getElementById('visitor-breakdown-container');
    if (e) e.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:13px;text-align:center;">Loading...</div>';
    e = document.getElementById('payment-breakdown-container');
    if (e) e.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:13px;text-align:center;">Loading...</div>';
}

// ── TOAST ──
function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 3500);
}

// ── INIT ──
var currentDateEl = document.getElementById('currentDate');
if (currentDateEl) {
    currentDateEl.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Makassar'
    });
}

loadAll();
