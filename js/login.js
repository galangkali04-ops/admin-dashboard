// Kalau sudah punya token, langsung lempar ke dashboard (gak perlu login lagi)
if (localStorage.getItem('auth_token')) {
  window.location.href = 'index.html';
}

// Isi otomatis username kalau sebelumnya pernah dicentang "Remember me"
// (yang disimpan cuma username, password TIDAK pernah disimpan di browser)
const rememberedUsername = localStorage.getItem('remembered_username');
if (rememberedUsername) {
  document.getElementById('username').value = rememberedUsername;
  document.getElementById('rememberMe').checked = true;
}

const form      = document.getElementById('loginForm');
const errorEl   = document.getElementById('loginError');
const btn       = document.getElementById('loginBtn');

// ── TOGGLE SHOW/HIDE PASSWORD ──
const passwordInput   = document.getElementById('password');
const toggleBtn       = document.getElementById('togglePassword');
const eyeIcon         = document.getElementById('eyeIcon');

const eyeOpenPath   = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
const eyeClosedPath = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.86 21.86 0 0 1 5.06-6.06M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.86 21.86 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';

toggleBtn.addEventListener('click', () => {
  const isHidden = passwordInput.type === 'password';
  passwordInput.type = isHidden ? 'text' : 'password';
  eyeIcon.innerHTML = isHidden ? eyeClosedPath : eyeOpenPath;
  toggleBtn.title = isHidden ? 'Sembunyikan password' : 'Tampilkan password';
  toggleBtn.setAttribute('aria-label', toggleBtn.title);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const remember = document.getElementById('rememberMe').checked;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, remember })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Login gagal';
      return;
    }

    localStorage.setItem('auth_token', data.token);

    // Ingat username aja (bukan password) buat auto-isi login berikutnya
    if (remember) {
      localStorage.setItem('remembered_username', username);
    } else {
      localStorage.removeItem('remembered_username');
    }

    window.location.href = 'index.html';
  } catch (err) {
    errorEl.textContent = 'Tidak bisa terhubung ke server. Coba lagi.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
});
