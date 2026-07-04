// Cara pakai:
//   node generate-hash.js "passwordRahasiaAnda"
// Hasilnya (hash) di-copy ke environment variable ADMIN_PASSWORD_HASH.
// Password ASLI-nya tidak perlu (dan sebaiknya tidak) disimpan di mana pun.

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
    console.error('❌ Tulis password yang mau di-hash.');
    console.error('   Contoh: node generate-hash.js "passwordSaya123"');
    process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log('\n✅ Hash berhasil dibuat. Copy baris di bawah ini ke environment variable ADMIN_PASSWORD_HASH:\n');
console.log(hash);
console.log('');
