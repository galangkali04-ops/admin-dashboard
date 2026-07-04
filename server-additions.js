require('dotenv').config();

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve file frontend (index.html, login.html, css/, js/, assets/) langsung
// dari server yang sama. Jadi 1 service Railway = backend + frontend jadi satu,
// gak perlu urus CORS/domain terpisah buat frontend.
app.use(express.static(__dirname));

// ── KONFIGURASI ──
const LOYVERSE_TOKEN = process.env.LOYVERSE_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://pzotsmqimlecrgkaajdb.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;

// ── KONFIGURASI LOGIN ──
const JWT_SECRET          = process.env.JWT_SECRET;
const ADMIN_USERNAME      = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH; // hasil dari generate-hash.js

if (!LOYVERSE_TOKEN || !SUPABASE_KEY) {
    console.error("❌ ERROR: LOYVERSE_TOKEN atau SUPABASE_SERVICE_KEY belum diatur di file .env!");
    process.exit(1);
}

if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
    console.error("❌ ERROR: JWT_SECRET, ADMIN_USERNAME, atau ADMIN_PASSWORD_HASH belum diatur di file .env!");
    console.error("   Jalankan 'node generate-hash.js' untuk membuat ADMIN_PASSWORD_HASH.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const lyHeaders = {
    Authorization: `Bearer ${LOYVERSE_TOKEN}`,
    'Content-Type': 'application/json'
};

/* ═══════════════════════════════════════════════════════
   UTILITY: AMBIL SEMUA DATA LOYVERSE (Auto-Pagination)
   ═══════════════════════════════════════════════════════ */
async function lyFetchAll(endpoint, params = {}) {
    let results = [];
    let cursor  = undefined;
    while (true) {
        const p = { limit: 250, ...params };
        if (cursor) p.cursor = cursor;
        const res = await axios.get(`https://api.loyverse.com/v1.0/${endpoint}`, {
            headers: lyHeaders,
            params: p
        });
        const key = Object.keys(res.data).find(k => Array.isArray(res.data[k]));
        const items = key ? res.data[key] : [];
        results = results.concat(items);
        cursor = res.data.cursor;
        if (!cursor || items.length === 0) break;
    }
    return results;
}

async function getItemNames() {
    try {
        const items = await lyFetchAll('items');
        const map = {};
        items.forEach(i => {
            (i.variants || []).forEach(v => {
                map[v.variant_id] = i.item_name;
            });
        });
        return map;
    } catch (e) {
        console.error('⚠️ Gagal mengambil nama item:', e.message);
        return {};
    }
}

// Nama diskon (mis. "BTC", "Staff Discount") tidak ikut terbawa di dalam
// receipts/line_items — Loyverse cuma kasih id-nya. Jadi diambil terpisah
// dari endpoint /discounts lalu di-mapping id -> nama, sama pola-nya kayak getItemNames().
async function getDiscountNames() {
    try {
        const discounts = await lyFetchAll('discounts');
        const map = {};
        discounts.forEach(d => { map[d.id] = d.name; });
        return map;
    } catch (e) {
        console.error('⚠️ Gagal mengambil nama diskon:', e.message);
        return {};
    }
}

let _customerCache = { map: {}, fetchedAt: 0 };
const CUSTOMER_CACHE_TTL = 5 * 60 * 1000;

async function getCustomerMap() {
    const isFresh = (Date.now() - _customerCache.fetchedAt) < CUSTOMER_CACHE_TTL;
    if (isFresh && Object.keys(_customerCache.map).length > 0) return _customerCache.map;
    try {
        const customers = await lyFetchAll('customers');
        const map = {};
        customers.forEach(c => {
            map[c.id] = { name: c.name || null, email: c.email || null };
        });
        _customerCache = { map, fetchedAt: Date.now() };
        return map;
    } catch (e) {
        console.error('⚠️ Gagal mengambil data customer:', e.message);
        return _customerCache.map;
    }
}

/* ═══════════════════════════════════════════════════════
   AUTH: LOGIN
   ═══════════════════════════════════════════════════════ */

// Batasi percobaan login: max 10x per 15 menit per IP, biar gak bisa di-brute-force
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam beberapa menit.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.post('/api/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'Username dan password wajib diisi' });
        }

        // Bandingkan username apa adanya, dan password terhadap hash bcrypt
        // (bukan plain-text compare, biar password gak pernah tersimpan mentah)
        const usernameOk = username === ADMIN_USERNAME;
        const passwordOk = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

        if (!usernameOk || !passwordOk) {
            console.log(`⚠️ Login gagal untuk username: ${username}`);
            return res.status(401).json({ error: 'Username atau password salah' });
        }

        const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '12h' });
        console.log(`✅ Login berhasil: ${username}`);
        res.json({ success: true, token });
    } catch (e) {
        console.error('❌ Error /api/login:', e.message);
        res.status(500).json({ error: 'Terjadi kesalahan saat login' });
    }
});

// Middleware: wajib ada token JWT valid di header Authorization: Bearer <token>
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Belum login / token tidak ada' });
    }
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Sesi login sudah habis, silakan login lagi' });
    }
}

// Semua route /api/* di bawah ini wajib login, KECUALI /api/login yang sudah didaftarkan di atas
app.use('/api', requireAuth);

/* ═══════════════════════════════════════════════════════
   API: MEMBERS — baca dari member_registrations
   ═══════════════════════════════════════════════════════ */
app.get('/api/members', async (req, res) => {
    try {
        console.log('👥 Mengambil data member dari member_registrations...');
        const { data, error } = await supabase
            .from('member_registrations')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        console.log(`✅ ${data.length} member ditemukan`);
        res.json(data);
    } catch (e) {
        console.error('❌ Error /api/members:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/* ═══════════════════════════════════════════════════════
   API: RECEIPTS — dari Loyverse
   ═══════════════════════════════════════════════════════ */
app.get('/api/receipts', async (req, res) => {
    try {
// Di dalam app.get('/api/receipts'...
const { from, to } = req.query;
const params = {};

// Perbaikan filter tanggal
if (from) {
    params.created_at_min = new Date(`${from}T00:00:00+08:00`).toISOString();
}
if (to) {
    params.created_at_max = new Date(`${to}T23:59:59+08:00`).toISOString();
}

console.log(`Mengambil receipts dari ${params.created_at_min} sampai ${params.created_at_max}`);

        const [rawReceipts, itemMap, customerMap, discountMap] = await Promise.all([
            lyFetchAll('receipts', params),
            getItemNames(),
            getCustomerMap(),
            getDiscountNames()
        ]);

        const cleanReceipts = rawReceipts.map(r => {
            const lineItems = (r.line_items || []).map(item => {
                // gross_total_money = harga SEBELUM diskon. total_money Loyverse itu
                // udah net (SETELAH diskon & pajak ADDED) — pakai itu sebagai pembagi
                // dulu (bug sebelumnya) bikin persentase kebesaran (mis. 15% jadi 18%).
                const grossMoney     = item.gross_total_money || 0;
                const discountMoney  = item.total_discount || 0;
                const firstDisc      = (item.line_discounts && item.line_discounts[0]) || null;
                const discountName   = firstDisc ? (discountMap[firstDisc.id] || firstDisc.name || 'Diskon') : null;

                // Loyverse udah nyimpen persentase resmi buat diskon tipe
                // VARIABLE_PERCENT / FIXED_PERCENT di line_discounts[].percentage —
                // itu dipakai duluan biar 100% sama kayak yang di-set di Loyverse.
                // Kalau diskonnya nominal tetap (FIXED_AMOUNT dll, gak ada field
                // percentage), baru dihitung manual dari discountMoney / grossMoney.
                let discountPct = 0;
                if (discountMoney > 0) {
                    if (firstDisc && firstDisc.percentage != null) {
                        discountPct = Math.round(firstDisc.percentage);
                    } else if (grossMoney > 0) {
                        discountPct = Math.round((discountMoney / grossMoney) * 100);
                    }
                }

                return {
                    item_name:        itemMap[item.variant_id] || item.item_name || 'Produk Tidak Diketahui',
                    quantity:         item.quantity,
                    total_money:      item.total_money != null ? item.total_money : (grossMoney - discountMoney),
                    discount_name:    discountName,
                    discount_amount:  discountMoney,
                    discount_percent: discountPct
                };
            });

            const sessionNames = lineItems.map(li => li.item_name);
            const customerProfile = r.customer_id ? customerMap[r.customer_id] : null;

            // PENTING: Loyverse kadang ngirim total_money REFUND sebagai angka
            // POSITIF (nilai yang direfund, bukan sudah minus). Kalau ini cuma
            // dijumlah apa adanya ke Net Sales, refund malah NAMBAH bukannya
            // NGURANGIN — errornya jadi 2x nilai refund. Di-normalisasi di sini
            // sekali aja, biar semua bagian dashboard (KPI, chart, payment
            // breakdown, daily breakdown) otomatis dapat angka yang benar.
            const rawTotal = r.total_money || 0;
            const normalizedTotal = r.receipt_type === 'REFUND' ? -Math.abs(rawTotal) : rawTotal;

            return {
                receipt_id:     r.receipt_number,
                created_at:     r.created_at,
                receipt_type:   r.receipt_type,
                total_money:    normalizedTotal,
                line_items:     lineItems,
                // Kalau tidak ada profil Customer yang di-link, banyak kasir cuma nulis nama
                // tamu di kolom Comment (r.note) pas bikin struk — jadi itu dipakai juga
                // sebagai fallback sebelum jatuh ke "Walk-in Guest", biar sesuai Loyverse.
                customer_name:  r.customer?.name || customerProfile?.name || r.note || 'Walk-in Guest',
                customer_email: r.customer?.email || customerProfile?.email || null,
                note:           r.note || null,
                sessions:       sessionNames,
                session:        sessionNames.length ? sessionNames.join(', ') : '—',
                payments:       r.payments || []
            };
        });

        res.json({
            success: true,
            count: cleanReceipts.length,
            receipts: cleanReceipts
        });

    } catch (e) {
        console.error('❌ Error /api/receipts:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/* ═══════════════════════════════════════════════════════
   API: EXPENSES — dari tabel expenses Supabase
   ═══════════════════════════════════════════════════════ */
app.get('/api/expenses', async (req, res) => {
    try {
        const { from, to } = req.query;
        let query = supabase
            .from('expenses')
            .select('*')
            .order('date', { ascending: false });

        if (from) query = query.gte('date', from);
        if (to)   query = query.lte('date', to);

        const { data, error } = await query;
        if (error) throw error;

        res.json({ success: true, count: data.length, expenses: data });
    } catch (e) {
        console.error('❌ Error /api/expenses:', e.message);
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Server Santai Spa aktif di http://localhost:${PORT}`);
    console.log(`==================================================`);
});