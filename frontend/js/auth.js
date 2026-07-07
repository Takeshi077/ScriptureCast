(function () {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const errorEl = document.getElementById('auth-error');

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  function clearError() {
    if (errorEl) errorEl.classList.add('hidden');
  }

  async function api(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.detail || 'Something went wrong');
    }
    return data;
  }

  function redirect() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next') || '/app';
    window.location.href = next;
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      try {
        const data = await api('/api/auth/login', {
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        });
        localStorage.setItem('token', data.token);
        try {
          if (window.__TAURI_INTERNALS__) {
            await window.__TAURI__.core.invoke('set_auth_token', { token: data.token });
          }
        } catch (_) { /* Tauri store is optional */ }
        redirect();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();
      const btn = document.getElementById('register-btn');
      btn.disabled = true;
      btn.textContent = 'Creating account...';
      try {
        const data = await api('/api/auth/register', {
          name: document.getElementById('name').value,
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        });
        localStorage.setItem('token', data.token);
        try {
          if (window.__TAURI_INTERNALS__) {
            await window.__TAURI__.core.invoke('set_auth_token', { token: data.token });
          }
        } catch (_) { /* Tauri store is optional */ }
        redirect();
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    });
  }
})();
