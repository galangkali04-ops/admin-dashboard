const { createClient } = require('@supabase/supabase-js');
const https = require('https');

// ===== KONFIGURASI =====
const WA_API_KEY         = 'qn5k5tg58okgkx7izdlftv18p4y4wx';
const WA_ACCOUNT_ID      = '436654';
const SUPABASE_URL        = 'https://pzotsmqimlecrgkaajdb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6b3RzbXFpbWxlY3Jna2FhamRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTg3NjQ4MCwiZXhwIjoyMDk1NDUyNDgwfQ.aB-TlrPfAROmTzXqLtlaf73Asq04Q7Y7kc36zHXwDpc';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ===== AMBIL TOKEN =====
async function getAccessToken() {
    return new Promise((resolve, reject) => {
        const credentials = Buffer.from(`APIKEY:${WA_API_KEY}`).toString('base64');
        const body = 'grant_type=client_credentials&scope=auto';

        const options = {
            hostname: 'oauth.wildapricot.org',
            path: '/auth/token',
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    console.log('Token status:', res.statusCode);
                    const parsed = JSON.parse(data);
                    if (parsed.access_token) {
                        resolve(parsed.access_token);
                    } else {
                        reject(new Error(`Gagal dapat token: ${data}`));
                    }
                } catch (e) {
                    reject(new Error(`Token parse error: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ===== FETCH DATA WILD APRICOT =====
async function fetchWildApricot(endpoint, token) {
    return new Promise((resolve, reject) => {
        const url = new URL(`https://api.wildapricot.org/v2.2/accounts/${WA_ACCOUNT_ID}/${endpoint}`);

        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                        return;
                    }
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Parse error: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

// ===== SYNC UTAMA =====
async function syncMembers() {
    console.log('🔄 Mulai sync...');

    try {
        console.log('🔑 Mengambil token...');
        const token = await getAccessToken();
        console.log('✅ Token berhasil didapat');

        let allContacts = [];
        let skip = 0;
        const limit = 100;

        // Loop ambil semua halaman
        while (true) {
            console.log(`📄 Mengambil kontak ${skip + 1} - ${skip + limit}...`);
            const result = await fetchWildApricot(
                `contacts?$async=false&$top=${limit}&$skip=${skip}`,
                token
            );

            if (!result || !result.Contacts || result.Contacts.length === 0) {
                break;
            }

            allContacts = allContacts.concat(result.Contacts);
            console.log(`✅ Total terkumpul: ${allContacts.length} kontak`);

            if (result.Contacts.length < limit) {
                break;
            }

            skip += limit;
        }

        console.log(`\n📊 Total semua kontak: ${allContacts.length}`);
        console.log('💾 Mulai simpan ke Supabase...\n');

        // Simpan semua ke Supabase
        for (const contact of allContacts) {

            // Helper ambil nilai dari FieldValues
            const getField = (code) => {
                const f = contact.FieldValues?.find(f => f.SystemCode === code);
                return f ? f.Value : null;
            };

            const renewalDue = getField('RenewalDue') || null;

            // Cek apakah sudah expired (renewal_due sudah lewat hari ini)
            const isExpired = renewalDue
                ? new Date(renewalDue) < new Date(new Date().toISOString().split('T')[0])
                : false;

            const membershipStatus = isExpired
                ? 'Inactive'
                : contact.MembershipEnabled ? 'Active' : 'Inactive';

            if (isExpired) {
                console.log(`⚠️  Expired: ${contact.DisplayName} (renewal_due: ${renewalDue})`);
            }

            // Cek di Supabase — kalau statusnya Paused, jangan di-overwrite
            const { data: existing } = await supabase
                .from('members')
                .select('membership_status')
                .eq('wildapricot_id', contact.Id)
                .single();

            const finalStatus = existing?.membership_status === 'Paused'
                ? 'Paused'   // jaga status paused, sync tidak boleh reset
                : membershipStatus;

            if (existing?.membership_status === 'Paused') {
                console.log(`⏸  Keeping Paused: ${contact.DisplayName}`);
            }

            const memberData = {
                wildapricot_id:    contact.Id,
                name:              contact.DisplayName || `${contact.FirstName} ${contact.LastName}`,
                email:             contact.Email || '',
                phone:             getField('Phone') || '',
                membership_status: membershipStatus,
                membership_level:  contact.MembershipLevel?.Name || null,
                member_since:      getField('MemberSince') || null,
                renewal_due:       renewalDue,
                last_sync:         new Date().toISOString()
            };

            const { error } = await supabase
                .from('members')
                .upsert(memberData, { onConflict: 'wildapricot_id' });

            if (error) {
                console.error(`❌ Gagal sync ${memberData.name}:`, error.message);
            } else {
                console.log(`✅ Sync: ${memberData.name}`);
            }
        }

        console.log('\n🎉 Sync selesai!');

    } catch (err) {
        console.error('❌ ERROR:', err.message);
    }
}

// ===== JALANKAN =====
console.log('🚀 sync.js berjalan...');
syncMembers();