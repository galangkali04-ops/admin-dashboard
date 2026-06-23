const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors()); // Mengizinkan frontend index.html mengakses API ini
app.use(express.json());

// ── KONFIGURASI ENV & CREDENTIALS ──
const LOYVERSE_TOKEN = process.env.LOYVERSE_TOKEN;
const SUPABASE_URL   = process.env.SUPABASE_URL || 'https://pzotsmqimlecrgkaajdb.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_KEY;

// Validasi untuk memastikan variabel env sudah terbaca dari file .env
if (!LOYVERSE_TOKEN || !SUPABASE_KEY) {
    console.error("❌ ERROR: LOYVERSE_TOKEN atau SUPABASE_KEY belum diatur di file .env!");
    process.exit(1);
}

// Inisialisasi Client Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const lyHeaders = {
    Authorization: `Bearer ${LOYVERSE_TOKEN}`,
    'Content-Type': 'application/json'
};

/* ═════════════════════════════════════════════════════════════
   1. UTILITY: AMBIL SEMUA DATA DARI LOYVERSE (Auto-Pagination)
   ═════════════════════════════════════════════════════════════ */
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

// Helper untuk mapping ID Produk Loyverse ke Nama Produk asli
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
        console.error('⚠️ Gagal mengambil nama item dari Loyverse:', e.message);
        return {};
    }
}

// ── CACHE CUSTOMER LOYVERSE (nama + email) ──
// Data customer jarang berubah, jadi di-cache sebentar biar /api/receipts tetap cepat
let _customerCache = { map: {}, fetchedAt: 0 };
const CUSTOMER_CACHE_TTL = 5 * 60 * 1000; // 5 menit

async function getCustomerMap() {
    const isFresh = (Date.now() - _customerCache.fetchedAt) < CUSTOMER_CACHE_TTL;
    if (isFresh && Object.keys(_customerCache.map).length > 0) {
        return _customerCache.map;
    }

    try {
        const customers = await lyFetchAll('customers');
        const map = {};
        customers.forEach(c => {
            map[c.id] = {
                name: c.name || null,
                email: c.email || null
            };
        });
        _customerCache = { map, fetchedAt: Date.now() };
        return map;
    } catch (e) {
        console.error('⚠️ Gagal mengambil data customer dari Loyverse:', e.message);
        return _customerCache.map; // fallback ke cache lama kalau gagal
    }
}

/* ═════════════════════════════════════════════════════════════
   2. API ENDPOINT: AMBIL DATA MEMBER DARI SUPABASE
   ═════════════════════════════════════════════════════════════ */
app.get('/api/members', async (req, res) => {
    try {
        console.log('👥 Mengambil data aktual member dari Supabase...');
        const { data, error } = await supabase
            .from('members')
            .select('*');

        if (error) throw error;

        res.json(data); // Kirim data array member langsung ke frontend
    } catch (e) {
        console.error('❌ Terjadi Eror pada API /api/members:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/* ═════════════════════════════════════════════════════════════
   3. API ENDPOINT: AMBIL TRANSAKSI / RECEIPTS FROM LOYVERSE
   ═════════════════════════════════════════════════════════════ */
app.get('/api/receipts', async (req, res) => {
    try {
        const { from, to } = req.query;
        
        const params = {};
        if (from) params.created_at_min = `${from}T00:00:00.000Z`;
        if (to)   params.created_at_max = `${to}T23:59:59.999Z`;

        console.log(`⚡ Mengambil receipts dari ${params.created_at_min} sampai ${params.created_at_max}`);
        
        const [rawReceipts, itemMap, customerMap] = await Promise.all([
            lyFetchAll('receipts', params),
            getItemNames(),
            getCustomerMap()
        ]);

        const cleanReceipts = rawReceipts.map(r => {
            const lineItems = (r.line_items || []).map(item => ({
                item_name: itemMap[item.variant_id] || item.item_name || 'Produk Tidak Diketahui',
                quantity: item.quantity,
                total_money: item.total_money - (item.total_discount || 0)
            }));

            // Sesi/layanan yang dipilih = nama produk pada setiap line item
            const sessionNames = lineItems.map(li => li.item_name);

            // Lengkapi data customer (nama & email) dari profil Loyverse kalau tersedia
            const customerProfile = r.customer_id ? customerMap[r.customer_id] : null;

            return {
                receipt_id: r.receipt_number,
                created_at: r.created_at,
                receipt_type: r.receipt_type,
                total_money: r.total_money,
                line_items: lineItems,
                customer_name: r.customer?.name || customerProfile?.name || 'Walk-in Guest',
                customer_email: r.customer?.email || customerProfile?.email || null,
                sessions: sessionNames,
                session: sessionNames.length ? sessionNames.join(', ') : '—'
            };
        });

        res.json({
            success: true,
            count: cleanReceipts.length,
            receipts: cleanReceipts
        });

    } catch (e) {
        console.error('❌ Terjadi Eror pada API /api/receipts:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Port runtime server Anda
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 Server Santai Spa Aktif di http://localhost:${PORT}`);
    console.log(`==================================================`);
});
