// =========================================================================
// NUVEM: login com Google + Firebase Realtime Database
// Cada usuário tem seus dados em /users/{uid}/state. Só o dono lê e grava
// (garantido pelas regras do banco no console do Firebase).
// Carregado DEPOIS do app.js.
// =========================================================================

(function () {
  // Config pública do app web do Firebase (não é segredo; a segurança vem das regras do banco).
  // apiKey/appId vêm de: Console do Firebase → Configurações do projeto → Seus apps → Web.
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAmeY90LCLcEOEAqayKRqNS-8M7Q7t6E5I',
    authDomain: 'nexus-estudos-98c43.firebaseapp.com',
    databaseURL: 'https://nexus-estudos-98c43-default-rtdb.firebaseio.com',
    projectId: 'nexus-estudos-98c43',
    storageBucket: 'nexus-estudos-98c43.firebasestorage.app',
    messagingSenderId: '258260611879',
    appId: '1:258260611879:web:87527ca09bcdae41e32f02'
  };

  const SDK_VERSION = '10.12.2';
  const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
  const OWNER_KEY = 'NEXUS_OWNER_UID';
  const DEVICE_KEY = 'NEXUS_DEVICE_ID';
  const PUSH_DELAY_MS = 1200;

  let auth = null;
  let db = null;
  let currentUser = null;
  let stateRef = null;
  let pushTimer = null;
  let isOnline = false;
  let status = 'idle';
  let lastSyncAt = null;
  let firstSnapshotHandled = false;
  let applyingRemote = false;

  const deviceId = (() => {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = 'dev_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch { return 'dev_' + Math.random().toString(36).slice(2, 10); }
  })();

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isConfigured = () => Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.appId);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Falha ao carregar ' + src));
      document.head.appendChild(s);
    });
  }

  // Remove undefined (o Firebase não aceita) e marca quem gravou
  function serializeState() {
    const clean = JSON.parse(JSON.stringify(appState));
    clean.lastUpdated = Number(appState.lastUpdated) || Date.now();
    clean.deviceId = deviceId;
    return clean;
  }

  function summarize(data) {
    if (!data) return 'vazio';
    const subs = Array.isArray(data.subjects) ? data.subjects.length : Object.keys(data.subjects || {}).length;
    const sess = Array.isArray(data.sessions) ? data.sessions.length : Object.keys(data.sessions || {}).length;
    const when = data.lastUpdated ? new Date(data.lastUpdated).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'data desconhecida';
    return `${subs} matérias, ${sess} sessões (salvo em ${when})`;
  }

  // O Firebase transforma arrays em objetos às vezes; normaliza de volta
  function toArrayDeep(value) {
    if (Array.isArray(value)) return value.map(toArrayDeep);
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length && keys.every(k => /^\d+$/.test(k))) {
        return keys.sort((a, b) => a - b).map(k => toArrayDeep(value[k]));
      }
      const out = {};
      keys.forEach(k => { out[k] = toArrayDeep(value[k]); });
      return out;
    }
    return value;
  }

  function applyRemoteState(remote, message) {
    applyingRemote = true;
    try {
      const data = toArrayDeep(remote);
      delete data.deviceId;
      appState = normalizeCloudData(data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      updateAllUI();
      if (typeof refreshCharts === 'function') refreshCharts();
      if (typeof renderScheduleUI === 'function') renderScheduleUI();
      if (typeof renderFlashcardsTab === 'function') renderFlashcardsTab();
      lastSyncAt = Date.now();
      if (message) uiToast(message, { type: 'info' });
    } finally {
      applyingRemote = false;
    }
  }

  // ---------- Envio ----------
  function schedulePush() {
    if (!currentUser || !stateRef || applyingRemote || !firstSnapshotHandled) return;
    clearTimeout(pushTimer);
    setStatus(isOnline ? 'saving' : 'offline');
    pushTimer = setTimeout(pushNow, PUSH_DELAY_MS);
  }

  async function pushNow() {
    clearTimeout(pushTimer);
    if (!currentUser || !stateRef) return;
    try {
      const payload = serializeState();
      const write = stateRef.set(payload);
      // Offline: o SDK guarda na fila e envia quando a conexão voltar
      if (!isOnline) { setStatus('offline'); write.then(() => { lastSyncAt = Date.now(); setStatus('synced'); }).catch(onWriteError); return; }
      await write;
      lastSyncAt = Date.now();
      setStatus('synced');
    } catch (err) {
      onWriteError(err);
    }
  }

  function onWriteError(err) {
    console.error('Erro ao salvar na nuvem:', err);
    setStatus('error', err && err.code === 'PERMISSION_DENIED'
      ? 'Sem permissão no banco. Confira as regras do Realtime Database.'
      : 'Não foi possível salvar na nuvem.');
  }

  // ---------- Recebimento ----------
  async function handleSnapshot(snap) {
    const remote = snap.val();
    const localTs = Number(appState.lastUpdated) || 0;

    if (!firstSnapshotHandled) {
      firstSnapshotHandled = true;
      await reconcileOnLogin(remote);
      return;
    }

    if (!remote) return;
    const remoteTs = Number(remote.lastUpdated) || 0;
    if (remote.deviceId === deviceId && remoteTs <= localTs) { lastSyncAt = Date.now(); setStatus('synced'); return; }
    if (remoteTs > localTs) {
      clearTimeout(pushTimer);
      applyRemoteState(remote, 'Dados atualizados de outro dispositivo.');
      setStatus('synced');
    }
  }

  async function reconcileOnLogin(remote) {
    const uid = currentUser.uid;
    let owner = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch {}
    const localTs = Number(appState.lastUpdated) || 0;
    const remoteTs = Number(remote?.lastUpdated) || 0;

    if (!remote) {
      if (owner && owner !== uid) {
        const keep = await uiConfirm(`Esta conta ainda não tem dados na nuvem. Copiar os dados deste navegador (${summarize(appState)}) para ela?`,
          { title: 'Primeiro acesso', okLabel: 'Copiar para a conta', cancelLabel: 'Começar do zero', noClose: true });
        if (!keep) { appState = getDefaultState(); appState.lastUpdated = Date.now(); localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); updateAllUI(); }
      }
      setOwner(uid);
      if (!appState.lastUpdated) appState.lastUpdated = Date.now();
      await pushNow();
      uiToast('Seus dados agora ficam salvos na sua conta.', { type: 'success' });
      return;
    }

    if (owner === uid) {
      // Mesmo dono: o mais recente vence
      if (remoteTs > localTs) applyRemoteState(remote, 'Dados carregados da nuvem.');
      else if (localTs > remoteTs) await pushNow();
      else { lastSyncAt = Date.now(); setStatus('synced'); }
      return;
    }

    // Navegador nunca usado com esta conta, e a conta já tem dados
    if (!owner) {
      const result = await uiDialog({
        title: 'Qual versão usar?',
        message: `Sua conta já tem dados na nuvem: ${summarize(remote)}.\nNeste navegador: ${summarize(appState)}.`,
        okLabel: 'Usar os da nuvem',
        cancelLabel: 'Usar os deste navegador',
        noClose: true
      });
      setOwner(uid);
      if (result.ok) applyRemoteState(remote, 'Dados carregados da nuvem.');
      else { appState.lastUpdated = Date.now(); localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); await pushNow(); }
      setStatus('synced');
      return;
    }

    // Navegador era de outra conta: os dados da conta vencem
    setOwner(uid);
    applyRemoteState(remote, 'Dados da sua conta carregados.');
    setStatus('synced');
  }

  function setOwner(uid) { try { localStorage.setItem(OWNER_KEY, uid); } catch {} }

  // ---------- Login ----------
  async function signIn() {
    if (!isConfigured()) {
      uiToast('A nuvem ainda não foi configurada neste site.', { type: 'warning' });
      return;
    }
    try {
      await ensureFirebase();
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await auth.signInWithPopup(provider);
      } catch (err) {
        if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
          await auth.signInWithRedirect(provider);
        } else if (err && err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
          throw err;
        }
      }
    } catch (err) {
      console.error(err);
      const msg = err && err.code === 'auth/unauthorized-domain'
        ? 'Este endereço não está autorizado no Firebase (Authentication → Domínios autorizados).'
        : 'Não foi possível entrar com o Google.';
      uiToast(msg, { type: 'error', timeout: 7000 });
    }
  }

  async function signOut() {
    if (!auth) return;
    const ok = await uiConfirm('Sair da conta? Seus dados continuam salvos na nuvem e neste navegador.', { title: 'Sair', okLabel: 'Sair' });
    if (!ok) return;
    await pushNow();
    await auth.signOut();
    uiToast('Você saiu da conta.', { type: 'info' });
  }

  async function syncNow() {
    if (!currentUser || !stateRef) { updateAllUI(); return; }
    setStatus('saving');
    try {
      const snap = await stateRef.get();
      const remote = snap.val();
      const localTs = Number(appState.lastUpdated) || 0;
      const remoteTs = Number(remote?.lastUpdated) || 0;
      if (remote && remoteTs > localTs) applyRemoteState(remote, 'Dados atualizados da nuvem.');
      else if (!remote || localTs > remoteTs) await pushNow();
      lastSyncAt = Date.now();
      setStatus('synced');
      uiToast('Tudo sincronizado.', { type: 'success' });
    } catch (err) {
      onWriteError(err);
    }
  }

  // ---------- Inicialização ----------
  let firebasePromise = null;
  function ensureFirebase() {
    if (firebasePromise) return firebasePromise;
    firebasePromise = (async () => {
      await loadScript(`${SDK_BASE}/firebase-app-compat.js`);
      await loadScript(`${SDK_BASE}/firebase-auth-compat.js`);
      await loadScript(`${SDK_BASE}/firebase-database-compat.js`);
      const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
      auth = app.auth();
      db = app.database();
      db.ref('.info/connected').on('value', (s) => {
        isOnline = s.val() === true;
        if (!currentUser) return;
        if (!isOnline) setStatus('offline');
        else if (status === 'offline') { setStatus('saving'); pushNow(); }
      });
      auth.onAuthStateChanged(onAuthChanged);
    })();
    return firebasePromise;
  }

  function onAuthChanged(user) {
    if (stateRef) { stateRef.off(); stateRef = null; }
    currentUser = user || null;
    firstSnapshotHandled = false;
    if (!user) { setStatus('signed-out'); return; }
    setStatus('connecting');
    stateRef = db.ref(`users/${user.uid}/state`);
    stateRef.on('value', handleSnapshot, (err) => {
      console.error(err);
      setStatus('error', err && err.code === 'PERMISSION_DENIED'
        ? 'Sem permissão no banco. Confira as regras do Realtime Database.'
        : 'Erro ao conectar na nuvem.');
    });
  }

  async function init() {
    if (!isConfigured()) { setStatus('disabled'); return; }
    setStatus('loading');
    try {
      await ensureFirebase();
    } catch (err) {
      console.error(err);
      setStatus('error', 'Sem internet para carregar a nuvem. Seus dados seguem salvos neste navegador.');
    }
  }

  // ---------- Interface (menu ⚙ e botão do header) ----------
  let statusDetail = '';
  function setStatus(next, detail = '') {
    status = next;
    statusDetail = detail;
    renderCloudUI();
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return 'agora mesmo';
    if (s < 60) return `há ${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `há ${m} min`;
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderCloudUI() {
    const box = document.getElementById('cloudAccountBox');
    const gearBtn = document.getElementById('settingsMenuBtn');
    if (!box) return;

    const STATES = {
      disabled:     { dot: 'off',  text: 'Nuvem não configurada',        sub: 'Seus dados ficam só neste navegador.' },
      loading:      { dot: 'wait', text: 'Carregando nuvem…',            sub: '' },
      'signed-out': { dot: 'off',  text: 'Não conectado',                sub: 'Entre para salvar seus dados na nuvem e usar em vários aparelhos.' },
      connecting:   { dot: 'wait', text: 'Conectando…',                  sub: '' },
      saving:       { dot: 'wait', text: 'Salvando na nuvem…',           sub: '' },
      synced:       { dot: 'on',   text: 'Conectado à nuvem',            sub: lastSyncAt ? `Tudo salvo · ${timeAgo(lastSyncAt)}` : 'Tudo salvo' },
      offline:      { dot: 'wait', text: 'Sem internet',                 sub: 'Suas mudanças serão enviadas quando a conexão voltar.' },
      error:        { dot: 'err',  text: 'Erro na nuvem',                sub: statusDetail || 'Tente de novo em instantes.' }
    };
    const st = STATES[status] || STATES.disabled;

    const user = currentUser;
    const avatar = user?.photoURL
      ? `<img src="${esc(user.photoURL)}" alt="" class="cloud-avatar" referrerpolicy="no-referrer">`
      : `<span class="cloud-avatar cloud-avatar-fallback">${esc((user?.displayName || user?.email || '?').charAt(0).toUpperCase())}</span>`;

    box.innerHTML = `
      ${user ? `
        <div class="cloud-user">
          ${avatar}
          <div class="min-w-0">
            <div class="cloud-name text-truncate">${esc(user.displayName || 'Sua conta')}</div>
            <div class="cloud-email text-truncate">${esc(user.email || '')}</div>
          </div>
        </div>` : ''}
      <div class="cloud-status cloud-${st.dot}">
        <span class="cloud-dot"></span>
        <div class="min-w-0">
          <div class="cloud-status-text">${esc(st.text)}</div>
          ${st.sub ? `<div class="cloud-status-sub">${esc(st.sub)}</div>` : ''}
        </div>
      </div>
      <div class="d-flex gap-2 mt-2">
        ${!user && status !== 'disabled' && status !== 'loading'
          ? `<button type="button" class="btn btn-light btn-sm w-100 google-btn" onclick="NexusCloud.signIn()">
               <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
               Entrar com Google
             </button>` : ''}
        ${user ? `
          <button type="button" class="btn btn-outline-nexus btn-sm flex-grow-1" onclick="NexusCloud.syncNow()"><i class="bi bi-arrow-repeat me-1"></i>Sincronizar</button>
          <button type="button" class="btn btn-outline-nexus btn-sm" onclick="NexusCloud.signOut()" title="Sair da conta"><i class="bi bi-box-arrow-right"></i></button>` : ''}
      </div>`;

    if (gearBtn) {
      gearBtn.classList.toggle('has-avatar', Boolean(user));
      gearBtn.innerHTML = user
        ? `${avatar}<span class="gear-dot cloud-${st.dot}"></span>`
        : `<i class="bi bi-gear"></i>${status !== 'disabled' ? `<span class="gear-dot cloud-${st.dot}"></span>` : ''}`;
      gearBtn.title = user ? `${user.displayName || 'Conta'} · ${st.text}` : `Configurações · ${st.text}`;
    }
  }

  // Atualiza o "há X min" de vez em quando
  setInterval(() => { if (status === 'synced') renderCloudUI(); }, 30000);

  window.NexusCloud = { init, signIn, signOut, syncNow, schedulePush, isSignedIn: () => Boolean(currentUser), isConfigured };
  document.addEventListener('DOMContentLoaded', () => { renderCloudUI(); init(); });
})();
