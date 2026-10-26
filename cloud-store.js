(() => {
  const SESSION_KEY = 'danisman_supabase_session_v1';
  const config = window.DANISMAN_SUPABASE_CONFIG || {};
  let session = null;
  let refreshPromise = null;

  function isConfigured() {
    return typeof config.url === 'string'
      && /^https:\/\/.+\.supabase\.co$/.test(config.url)
      && typeof config.anonKey === 'string'
      && config.anonKey.length > 20
      && !config.url.includes('YOUR-PROJECT')
      && !config.anonKey.includes('YOUR_SUPABASE');
  }

  function usernameToEmail(username) {
    const normalized = username.trim().toLocaleLowerCase('tr-TR')
      .replace(/[ıİ]/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '');

    if (!normalized) throw new Error('Kullanıcı adını girin.');
    return `${normalized}@danisman.invalid`;
  }

  function storeSession(nextSession) {
    session = {
      accessToken: nextSession.access_token,
      refreshToken: nextSession.refresh_token,
      expiresAt: Date.now() + Number(nextSession.expires_in || 3600) * 1000,
      user: nextSession.user
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    session = null;
    localStorage.removeItem(SESSION_KEY);
  }

  async function request(path, options = {}) {
    const response = await fetch(`${config.url.replace(/\/+$/, '')}${path}`, {
      method: options.method || 'GET',
      headers: {
        apikey: config.anonKey,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.prefer ? { Prefer: options.prefer } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });

    const responseText = await response.text();
    let result = null;
    if (responseText) {
      try {
        result = JSON.parse(responseText);
      } catch {
        result = responseText;
      }
    }

    if (!response.ok) {
      const message = typeof result === 'object' && result
        ? result.msg || result.message || result.error_description || result.error
        : result;
      const error = new Error(message || `Supabase isteği başarısız (${response.status}).`);
      error.status = response.status;
      throw error;
    }

    return result;
  }

  async function refreshSession() {
    if (!session?.refreshToken) return null;
    if (refreshPromise) return refreshPromise;

    refreshPromise = request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refreshToken }
    }).then(storeSession).catch((error) => {
      if (error.status === 400 || error.status === 401) clearSession();
      throw error;
    }).finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function validSession() {
    if (!session) return null;
    if (session.expiresAt <= Date.now() + 60_000) return refreshSession();
    return session;
  }

  async function restoreSession() {
    if (!isConfigured()) throw new Error('Supabase bağlantı ayarları henüz yapılmamış.');
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (error) {
      clearSession();
      if (error instanceof SyntaxError) return null;
      throw error;
    }
    if (!saved?.refreshToken) return null;
    session = saved;
    return validSession();
  }

  async function signIn(username, password) {
    if (!isConfigured()) throw new Error('Önce Supabase URL ve Publishable/anon key ayarlanmalı.');
    const email = usernameToEmail(username);

    const result = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password }
    });
    return storeSession(result);
  }

  async function signOut() {
    const activeSession = await validSession();
    if (activeSession) {
      try {
        await request('/auth/v1/logout', { method: 'POST', token: activeSession.accessToken });
      } finally {
        clearSession();
      }
    } else {
      clearSession();
    }
  }

  async function fetchWorkspace() {
    const activeSession = await validSession();
    if (!activeSession) throw new Error('Oturum bulunamadı; yeniden giriş yapın.');
    const rows = await request(
      `/rest/v1/workspace_state?select=payload,version&user_id=eq.${encodeURIComponent(activeSession.user.id)}`,
      { token: activeSession.accessToken }
    );
    return rows[0] || null;
  }

  async function saveWorkspace(expectedVersion, payload) {
    const activeSession = await validSession();
    if (!activeSession) throw new Error('Oturum bulunamadı; veriler buluta gönderilemedi.');
    return request('/rest/v1/rpc/save_workspace_state', {
      method: 'POST',
      token: activeSession.accessToken,
      body: { p_expected_version: expectedVersion, p_payload: payload }
    });
  }

  window.DanismaCloudStore = {
    isConfigured,
    hasSession: () => Boolean(session?.refreshToken),
    restoreSession,
    signIn,
    signOut,
    fetchWorkspace,
    saveWorkspace
  };
})();
