const STORAGE_KEY = 'danisman_panel_state_v1';
const DATABASE_NAME = 'danisman-panel-db';
const DATABASE_VERSION = 1;
const DATABASE_STORE = 'app-data';
const STATE_RECORD_ID = 'workspace-state';
const PENDING_CLOUD_STATE_ID = 'pending-cloud-state';

const navItems = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');
const appShell = document.querySelector('#appShell');
const loginScreen = document.querySelector('#loginScreen');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const loginButton = document.querySelector('#loginButton');
const sessionList = document.querySelector('#sessionList');
const sessionCount = document.querySelector('#sessionCount');
const todaySessionList = document.querySelector('#todaySessionList');
const todaySessionCount = document.querySelector('#todaySessionCount');
const clientList = document.querySelector('#clientList');
const clientDetailStats = document.querySelector('#clientDetailStats');
const clientSessionHistory = document.querySelector('#clientSessionHistory');
const clientForm = document.querySelector('#clientForm');
const sessionForm = document.querySelector('#sessionForm');
const sessionClientSelect = document.querySelector('#sessionClient');
const formModeButtons = document.querySelectorAll('[data-form-mode]');
const sessionDialog = document.querySelector('#sessionDialog');
const sessionDialogNote = document.querySelector('#sessionNote');
const sessionSummaryStatus = document.querySelector('#sessionSummaryStatus');
const sessionDialogPayment = document.querySelector('#sessionDialogPayment');
const calendarGrid = document.querySelector('#calendarGrid');
let activeSessionDialogId = null;
const currentDate = new Date();
let calendarMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
let selectedCalendarDate = toISODate(currentDate);
let selectedFinanceYear = currentDate.getFullYear();
const EMPTY_STATE = { clients: [], sessions: [] };

let state = { clients: [], sessions: [] };
let databasePromise;
let cloudVersion = 0;
let cloudSyncReady = false;
let cloudConflictActive = false;
let queuedCloudWrites = 0;
let saveQueue = Promise.resolve();

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB desteklenmiyor.'));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DATABASE_STORE)) {
        request.result.createObjectStore(DATABASE_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

function readDatabaseState() {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readonly');
    const request = transaction.objectStore(DATABASE_STORE).get(STATE_RECORD_ID);
    request.onsuccess = () => resolve(request.result?.payload || null);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  }));
}

function writeDatabaseState(snapshot, version = cloudVersion, pendingCloud = false) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).put({
      id: STATE_RECORD_ID,
      payload: snapshot,
      cloudVersion: version,
      pendingCloud
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

function readDatabaseRecord(id) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readonly');
    const request = transaction.objectStore(DATABASE_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  }));
}

function writeDatabaseRecord(record) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

function deleteDatabaseRecord(id) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, 'readwrite');
    transaction.objectStore(DATABASE_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

function normalizeState(candidate) {
  if (!candidate || !Array.isArray(candidate.clients) || !Array.isArray(candidate.sessions)) return null;

  const cancelledCounts = new Map();
  const rescheduledCounts = new Map();
  candidate.sessions.forEach((session) => {
    if (session.status === 'cancelled') {
      cancelledCounts.set(session.clientId, (cancelledCounts.get(session.clientId) || 0) + 1);
    }
    const history = Array.isArray(session.rescheduleHistory) ? session.rescheduleHistory : [];
    rescheduledCounts.set(session.clientId, (rescheduledCounts.get(session.clientId) || 0) + history.length);
  });

  return {
    ...candidate,
    clients: candidate.clients.map((client) => ({
      ...client,
      cancelledSessionCount: (Number.isInteger(client.cancelledSessionCount) && client.cancelledSessionCount >= 0
        ? client.cancelledSessionCount
        : 0) + (cancelledCounts.get(client.id) || 0),
      rescheduledSessionCount: Number.isInteger(client.rescheduledSessionCount) && client.rescheduledSessionCount >= 0
        ? client.rescheduledSessionCount
        : rescheduledCounts.get(client.id) || 0
    })),
    sessions: candidate.sessions.filter((session) => session.status !== 'cancelled').map((session) => {
      const client = candidate.clients.find((item) => item.id === session.clientId);
      const savedFee = Number(session.fee);
      return {
        ...session,
        fee: Number.isFinite(savedFee) ? savedFee : Number(client?.fee) || 0,
        paymentStatus: session.paymentStatus === 'paid' ? 'paid' : 'unpaid',
        summaryStatus: session.summaryStatus === 'written' ? 'written' : 'notWritten',
        status: ['upcoming', 'completed', 'cancelled'].includes(session.status) ? session.status : 'upcoming'
      };
    })
  };
}

function readLegacyState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : null;
  } catch (error) {
    console.error('Eski tarayıcı kayıtları okunamadı:', error);
    return null;
  }
}

async function loadState() {
  const databaseState = await readDatabaseState();
  const stored = normalizeState(databaseState);
  if (stored) {
    const hasCancelledSessions = databaseState.sessions.some((session) => session.status === 'cancelled');
    const hasMissingClientStats = databaseState.clients.some((client) => (
      !Number.isInteger(client.cancelledSessionCount) || !Number.isInteger(client.rescheduledSessionCount)
    ));
    if (hasCancelledSessions || hasMissingClientStats) await writeDatabaseState(stored);
    return stored;
  }

  const legacy = readLegacyState();
  const initial = legacy || structuredClone(EMPTY_STATE);
  await writeDatabaseState(initial);
  if (legacy) localStorage.removeItem(STORAGE_KEY);
  return initial;
}

function saveState() {
  const snapshot = structuredClone(state);
  writeDatabaseState(snapshot, cloudVersion, true).catch((error) => {
    console.error('IndexedDB kaydı başarısız; yerel yedek kullanılıyor:', error);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (fallbackError) {
      console.error('Yerel kayıt da başarısız:', fallbackError);
    }
  });

  if (cloudConflictActive) {
    writeDatabaseRecord({ id: PENDING_CLOUD_STATE_ID, payload: snapshot, baseVersion: cloudVersion })
      .catch((error) => {
        console.error('Eşitlenmemiş yedek kaydedilemedi:', error);
        setSyncStatus(`Yerel yedek kaydedilemedi: ${error.message}`, true);
      });
    return;
  }
  if (!cloudSyncReady) return;
  queuedCloudWrites += 1;
  setSyncStatus('Buluta kaydediliyor…');
  saveQueue = saveQueue.then(async () => {
    if (!cloudSyncReady || cloudConflictActive) {
      await writeDatabaseRecord({ id: PENDING_CLOUD_STATE_ID, payload: snapshot, baseVersion: cloudVersion });
      queuedCloudWrites -= 1;
      return;
    }

    const nextVersion = await window.DanismaCloudStore.saveWorkspace(cloudVersion, snapshot);
    if (!Number.isInteger(nextVersion)) throw new Error('Bulut sürüm numarası geçersiz.');
    cloudVersion = nextVersion;
    queuedCloudWrites -= 1;
    await writeDatabaseState(snapshot, cloudVersion, false);
    await deleteDatabaseRecord(PENDING_CLOUD_STATE_ID);
    if (queuedCloudWrites === 0) setSyncStatus('Bulutla eşitlendi');
  }).catch((error) => {
    queuedCloudWrites = Math.max(0, queuedCloudWrites - 1);
    cloudSyncReady = false;
    cloudConflictActive = true;
    console.error('Bulut eşitlemesi başarısız; yerel yedek korundu:', error);
    return writeDatabaseRecord({ id: PENDING_CLOUD_STATE_ID, payload: snapshot, baseVersion: cloudVersion })
      .then(() => {
        document.querySelector('#syncConflictPanel').hidden = false;
        setSyncStatus(`Eşitleme durdu: ${error.message}. İki yedek de korundu.`, true);
      }).catch((backupError) => {
        console.error('Eşitlenmemiş yedek kaydedilemedi:', backupError);
        setSyncStatus(`Bulut hatası: ${error.message}; yerel yedek de kaydedilemedi: ${backupError.message}`, true);
      });
  });
}

function setSyncStatus(message, hasError = false) {
  if (hasError) console.error(message);
}

function showLogin(message = '') {
  cloudSyncReady = false;
  appShell.hidden = true;
  loginScreen.hidden = false;
  loginError.textContent = message;
  loginError.hidden = !message;
}

function showApp() {
  loginScreen.hidden = true;
  appShell.hidden = false;
}

async function loadCloudWorkspace() {
  const remote = await window.DanismaCloudStore.fetchWorkspace();
  let pendingRecord = await readDatabaseRecord(PENDING_CLOUD_STATE_ID);
  const localRecord = await readDatabaseRecord(STATE_RECORD_ID);
  const localState = normalizeState(localRecord?.payload);
  const localHasData = Boolean(localState && (localState.clients.length || localState.sessions.length));
  const localVersionIsStale = Boolean(remote && localHasData && localRecord.cloudVersion !== undefined
    && localRecord.cloudVersion !== remote.version);
  const unmarkedLegacyData = Boolean(remote && localHasData && localRecord.cloudVersion === undefined);
  if (!pendingRecord && remote && (localRecord?.pendingCloud || localVersionIsStale || unmarkedLegacyData)) {
    pendingRecord = {
      id: PENDING_CLOUD_STATE_ID,
      payload: localState,
      baseVersion: localRecord.cloudVersion ?? 0
    };
    await writeDatabaseRecord(pendingRecord);
  }

  if (remote && pendingRecord) {
    const pending = normalizeState(pendingRecord.payload);
    if (!pending) throw new Error('Bu cihazdaki bekleyen yedek okunamadı; mevcut veriler korunuyor.');
    state = pending;
    cloudVersion = remote.version;
    cloudSyncReady = false;
    cloudConflictActive = true;
    document.querySelector('#syncConflictPanel').hidden = false;
    await writeDatabaseState(state, cloudVersion, true);
    render();
    showApp();
    setSyncStatus('Bulut ve cihaz yedekleri farklı; seçim bekleniyor', true);
    return;
  }

  if (!remote && pendingRecord) {
    const pending = normalizeState(pendingRecord.payload);
    if (!pending) throw new Error('Bu cihazdaki bekleyen yedek okunamadı; mevcut veriler korunuyor.');
    state = pending;
  }
  if (remote) {
    const normalized = normalizeState(remote.payload);
    if (!normalized) throw new Error('Supabase kayıt biçimi tanınmadı; mevcut veriler korunuyor.');
    state = normalized;
    cloudVersion = remote.version;
    await writeDatabaseState(state);
  } else {
    if (!pendingRecord) {
      const local = normalizeState(await readDatabaseState());
      state = local || structuredClone(EMPTY_STATE);
    }
    cloudVersion = await window.DanismaCloudStore.saveWorkspace(0, state);
    await writeDatabaseState(state, cloudVersion, false);
    if (pendingRecord) await deleteDatabaseRecord(PENDING_CLOUD_STATE_ID);
  }

  cloudSyncReady = true;
  cloudConflictActive = false;
  document.querySelector('#syncConflictPanel').hidden = true;
  render();
  showApp();
  setSyncStatus('Bulutla eşitlendi');
}

async function refreshCloudWorkspace() {
  if (!cloudSyncReady || cloudConflictActive || queuedCloudWrites > 0 || sessionDialog.open) return;
  try {
    const remote = await window.DanismaCloudStore.fetchWorkspace();
    if (!remote || remote.version <= cloudVersion) return;
    const normalized = normalizeState(remote.payload);
    if (!normalized) throw new Error('Supabase kayıt biçimi tanınmadı.');
    state = normalized;
    cloudVersion = remote.version;
    await writeDatabaseState(state, cloudVersion, false);
    render();
    setSyncStatus('Diğer cihazdaki değişiklikler alındı');
  } catch (error) {
    console.error('Bulut verisi yenilenemedi:', error);
    if (!window.DanismaCloudStore.hasSession()) {
      showLogin('Oturum sona erdi. Bulut verilerine devam etmek için yeniden giriş yapın.');
      return;
    }
    setSyncStatus(`Bulut verisi yenilenemedi: ${error.message}`, true);
  }
}

async function resolveCloudConflict(useLocalCopy) {
  const conflictPanel = document.querySelector('#syncConflictPanel');
  const localCopy = structuredClone(state);
  try {
    const remote = await window.DanismaCloudStore.fetchWorkspace();
    if (useLocalCopy) {
      const message = 'Bu cihazdaki yedek bulut verisinin yerine yazılacak. Devam edilsin mi?';
      if (!window.confirm(message)) return;
      if (!remote) throw new Error('Buluttaki kayıt bulunamadı; yerel yedek değiştirilmedi.');
      const nextVersion = await window.DanismaCloudStore.saveWorkspace(remote.version, localCopy);
      if (!Number.isInteger(nextVersion)) throw new Error('Bulut sürüm numarası geçersiz.');
      cloudVersion = nextVersion;
      await writeDatabaseState(localCopy, cloudVersion, false);
    } else {
      if (!window.confirm('Bu cihazdaki eşitlenmemiş yedek bu cihazdan kaldırılacak. Bulut verisi yüklensin mi?')) return;
      if (!remote) throw new Error('Buluttaki kayıt bulunamadı; yerel yedek değiştirilmedi.');
      const normalized = normalizeState(remote.payload);
      if (!normalized) throw new Error('Bulut kaydı okunamadı.');
      state = normalized;
      cloudVersion = remote.version;
      await writeDatabaseState(state, cloudVersion, false);
    }
    await deleteDatabaseRecord(PENDING_CLOUD_STATE_ID);
    cloudConflictActive = false;
    cloudSyncReady = true;
    conflictPanel.hidden = true;
    render();
    setSyncStatus('Bulutla eşitlendi');
  } catch (error) {
    console.error('Bulut ve yerel yedek seçimi tamamlanamadı:', error);
    setSyncStatus(`Yedekler korunuyor: ${error.message}`, true);
  }
}

async function submitLogin(event) {
  event.preventDefault();
  loginError.hidden = true;
  loginButton.disabled = true;
  loginButton.textContent = 'Giriş yapılıyor…';

  try {
    await window.DanismaCloudStore.signIn(
      document.querySelector('#loginUsername').value,
      document.querySelector('#loginPassword').value
    );
    document.querySelector('#loginPassword').value = '';
    await loadCloudWorkspace();
  } catch (error) {
    console.error('Giriş veya bulut verisi yükleme başarısız:', error);
    loginError.textContent = error.message;
    loginError.hidden = false;
    await window.DanismaCloudStore.signOut().catch((signOutError) => {
      console.error('Başarısız oturum temizlenemedi:', signOutError);
    });
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Giriş yap';
  }
}

function createClient(data) {
  const client = {
    id: crypto.randomUUID(),
    name: data.name.trim(),
    mode: data.mode,
    fee: Number(data.fee) || 0,
    note: data.note.trim(),
    createdAt: new Date().toISOString().slice(0, 10),
    cancelledSessionCount: 0,
    rescheduledSessionCount: 0
  };

  state.clients.unshift(client);
  saveState();
  render();
  activateScreen('clients');
}

function toISODate(date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 10);
}

function getClientById(id) {
  return state.clients.find((client) => client.id === id);
}

function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function getSessionTypeLabel(mode) {
  return mode === 'online' ? 'Online görüşme' : 'Yüz yüze görüşme';
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2
  }).format(amount);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthSessions = state.sessions.filter((session) => {
    const [sessionYear, sessionMonth] = session.date.split('-').map(Number);
    return sessionYear === year && sessionMonth === month + 1;
  });
  const sessionsByDate = new Map();

  monthSessions.forEach((session) => {
    const sessions = sessionsByDate.get(session.date) || [];
    sessions.push(session);
    sessionsByDate.set(session.date, sessions);
  });

  document.querySelector('#calendarMonthTitle').textContent = new Intl.DateTimeFormat('tr-TR', {
    month: 'long',
    year: 'numeric'
  }).format(calendarMonth);

  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push('<span class="calendar-empty-day" aria-hidden="true"></span>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toISODate(new Date(year, month, day));
    const daySessions = (sessionsByDate.get(date) || []).sort((first, second) => first.time.localeCompare(second.time));
    const todayClass = date === toISODate(new Date()) ? ' is-today' : '';
    const selectedClass = date === selectedCalendarDate ? ' is-selected' : '';
    const occupiedClass = daySessions.length ? ' has-sessions' : '';
    const busyClass = daySessions.length > 2 ? ' is-busy' : '';
    const names = daySessions.slice(0, 2).map((session) => {
      const client = getClientById(session.clientId);
      if (!client) return '';
      const firstName = client.name.trim().split(/\s+/)[0];
      return `<span class="calendar-session-name">${escapeHtml(firstName)}</span>`;
    }).join('');
    const more = daySessions.length > 2 ? `<span class="calendar-more">+${daySessions.length - 2}</span>` : '';
    const namesForLabel = daySessions.map((session) => getClientById(session.clientId)?.name).filter(Boolean).join(', ');
    const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(calendarMonth);
    const label = `${day} ${monthName}${namesForLabel ? `, seanslar: ${namesForLabel}` : ', seans yok'}`;

    cells.push(`
      <button class="calendar-day${todayClass}${selectedClass}${occupiedClass}${busyClass}" type="button" data-calendar-date="${date}" aria-label="${escapeHtml(label)}" aria-pressed="${date === selectedCalendarDate}">
        <span class="calendar-day-number">${day}</span>
        <span class="calendar-day-sessions">${names}${more}</span>
      </button>
    `);
  }

  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  while (cells.length < totalCells) cells.push('<span class="calendar-empty-day" aria-hidden="true"></span>');
  calendarGrid.innerHTML = cells.join('');

  const selectedSessions = [...(sessionsByDate.get(selectedCalendarDate) || [])]
    .sort((first, second) => first.time.localeCompare(second.time));
  const selectedDate = new Date(`${selectedCalendarDate}T00:00:00`);
  document.querySelector('#selectedCalendarDate').textContent = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(selectedDate);
  sessionCount.textContent = String(selectedSessions.length);
  sessionList.innerHTML = selectedSessions.length
    ? renderSessionRows(selectedSessions, 'calendar')
    : '<div class="empty-list">Bu gün için seans planlanmamış.</div>';
}

function renderSessionRows(sessions, view) {
  if (!sessions.length) {
    return `<div class="empty-list">${view === 'today' ? 'Bugün için seans planlanmamış.' : 'Seans bulunmuyor.'}</div>`;
  }

  const now = new Date();
  return sessions.map((session) => {
    const client = getClientById(session.clientId);
    if (!client) return '';

    const isPast = new Date(`${session.date}T${session.time}:00`) < now;
    const statusLabel = session.status === 'completed'
      ? 'Tamamlandı'
      : isPast ? 'Durum girilmedi' : 'Planlandı';
    const statusClass = session.status === 'completed' ? 'success' : 'pending';
    const paymentStatus = session.paymentStatus === 'paid'
      ? '<span class="tag payment-paid">Ödendi</span>'
      : '<span class="tag payment-unpaid">Ödenmedi</span>';
    const summaryStatus = session.summaryStatus === 'written'
      ? '<span class="tag summary-written">Özet yazıldı</span>'
      : '<span class="tag summary-not-written">Özet yazılmadı</span>';
    return `
      <div class="session-row" data-session-id="${session.id}" role="button" tabindex="0" aria-label="${escapeHtml(client.name)} seans ayrıntılarını aç">
        <div class="time-block">
          <strong>${escapeHtml(session.time)}</strong>
          ${view === 'calendar' ? '' : `<span>${formatDate(session.date)}</span>`}
        </div>
        <div class="client-name">
          <div>
            <strong>${escapeHtml(client.name)}</strong>
            <small>${getSessionTypeLabel(session.mode)}</small>
          </div>
        </div>
        <div class="session-actions">
          <span class="tag ${statusClass}">${statusLabel}</span>
          ${paymentStatus}
          ${summaryStatus}
        </div>
      </div>
    `;
  }).join('');
}

function renderToday() {
  const now = new Date();
  const today = toISODate(now);
  const todaysSessions = state.sessions
    .filter((session) => session.date === today)
    .sort((first, second) => first.time.localeCompare(second.time));

  document.querySelector('#todayDate').textContent = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(now);
  todaySessionCount.textContent = String(todaysSessions.length);
  todaySessionList.innerHTML = renderSessionRows(todaysSessions, 'today');
}

function renderClients() {
  clientCount.textContent = String(state.clients.length);

  if (!state.clients.length) {
    clientList.innerHTML = '<div class="empty-list">Henüz danışan kaydı yok.</div>';
    return;
  }

  clientList.innerHTML = state.clients.map((client) => {
    const clientSessions = state.sessions.filter((session) => session.clientId === client.id);
    const completedCount = clientSessions.filter((session) => session.status === 'completed').length;
    const nextSession = clientSessions
      .filter((session) => session.status === 'upcoming' && new Date(`${session.date}T${session.time}:00`) >= new Date())
      .sort((first, second) => new Date(`${first.date}T${first.time}:00`) - new Date(`${second.date}T${second.time}:00`))[0];

    return `
      <article class="client-row">
        <button class="client-detail-button" type="button" data-client-detail="${client.id}">
          <div class="client-row-info">
            <strong>${escapeHtml(client.name)}</strong>
            <small>${getSessionTypeLabel(client.mode)} · ${formatCurrency(Number(client.fee) || 0)}</small>
            <small>${completedCount} tamamlanan seans${nextSession ? ` · Sıradaki ${formatDate(nextSession.date)} ${escapeHtml(nextSession.time)}` : ''}</small>
          </div>
        </button>
        <button class="client-session-btn" type="button" data-client-session="${client.id}">Seans ekle</button>
      </article>
    `;
  }).join('');
}

function renderClientDetail(clientId) {
  const client = getClientById(clientId);
  if (!client) {
    activateScreen('clients');
    return;
  }

  const clientSessions = state.sessions
    .filter((session) => session.clientId === client.id)
    .sort((first, second) => (
      second.date.localeCompare(first.date) || second.time.localeCompare(first.time)
    ));
  const collected = clientSessions
    .filter((session) => session.paymentStatus === 'paid')
    .reduce((total, session) => total + (Number(session.fee) || Number(client.fee) || 0), 0);
  const outstanding = clientSessions
    .filter((session) => session.paymentStatus !== 'paid')
    .reduce((total, session) => total + (Number(session.fee) || Number(client.fee) || 0), 0);
  const stats = [
    { label: 'Toplam seans', value: String(clientSessions.length) },
    { label: 'Tamamlanan', value: String(clientSessions.filter((session) => session.status === 'completed').length) },
    { label: 'Tahsil edilen', value: formatCurrency(collected) },
    { label: 'Bekleyen ödeme', value: formatCurrency(outstanding) },
    { label: 'İptal edilen', value: String(client.cancelledSessionCount || 0) },
    { label: 'Ertelenen', value: String(client.rescheduledSessionCount || 0) }
  ];

  document.querySelector('#clientDetailTitle').textContent = client.name;
  document.querySelector('#clientDetailSubtitle').textContent = `${getSessionTypeLabel(client.mode)} · Seans ücreti ${formatCurrency(Number(client.fee) || 0)}`;
  document.querySelector('#clientDetailNote').textContent = client.note || 'Danışan için kayıtlı not yok.';
  clientDetailStats.innerHTML = stats.map((stat) => `
    <div class="client-stat-card">
      <span>${stat.label}</span>
      <strong>${stat.value}</strong>
    </div>
  `).join('');
  clientSessionHistory.innerHTML = clientSessions.length
    ? renderSessionRows(clientSessions, 'client')
    : '<div class="empty-list">Bu danışan için henüz seans kaydı yok.</div>';
  activateScreen('client-detail', 'clients');
}

function renderSessionClientOptions() {
  const selectedId = sessionClientSelect.value;
  sessionClientSelect.innerHTML = state.clients.length
    ? state.clients.map((client) => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join('')
    : '<option value="">Önce danışan ekleyin</option>';
  if (state.clients.some((client) => client.id === selectedId)) {
    sessionClientSelect.value = selectedId;
  }
  updateSessionMode();
}

function setFormMode(mode) {
  const isClientMode = mode === 'client';
  formModeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.formMode === mode);
  });
  clientForm.classList.toggle('active', mode === 'client');
  sessionForm.classList.toggle('active', mode === 'session');
  document.querySelector('#entryTitle').textContent = isClientMode ? 'Danışan ekle' : 'Seans ekle';
  document.querySelector('#entryDescription').textContent = isClientMode
    ? 'Danışan kaydı için seans tarihi ve saati gerekmez; seansları daha sonra ayrıca planlayabilirsiniz.'
    : 'Danışanı seçip tarih ve saat belirleyerek yeni seansı planlayın.';
  if (mode === 'session') renderSessionClientOptions();
}

function updateSessionMode() {
  const client = getClientById(sessionClientSelect.value);
  if (client) document.querySelector('#sessionMode').value = client.mode;
}

function createSession(data) {
  const client = getClientById(data.clientId);
  if (!client) return;

  const hasConflict = state.sessions.some((session) => (
    session.status !== 'cancelled'
    && session.date === data.date
    && session.time === data.time
  ));
  if (hasConflict) {
    alert('Bu tarih ve saatte başka bir seans planlanmış. Lütfen farklı bir saat seçin.');
    return;
  }

  state.sessions.push({
    id: crypto.randomUUID(),
    clientId: client.id,
    date: data.date,
    time: data.time,
    status: 'upcoming',
    mode: data.mode,
    fee: Number(client.fee) || 0,
    paymentStatus: 'unpaid',
    summaryStatus: 'notWritten'
  });
  selectedCalendarDate = data.date;
  calendarMonth = new Date(`${data.date}T00:00:00`);
  calendarMonth.setDate(1);
  saveState();
  render();
  activateScreen('sessions');
  sessionForm.reset();
}

function cancelSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session || !window.confirm('Bu seansı iptal etmek ve kaydını kalıcı olarak silmek istiyor musunuz?')) return;

  const client = getClientById(session.clientId);
  if (client) client.cancelledSessionCount = (client.cancelledSessionCount || 0) + 1;
  state.sessions = state.sessions.filter((item) => item.id !== id);
  saveState();
  sessionDialog.close();
  activeSessionDialogId = null;
  render();
}

function openSessionDialog(id) {
  const session = state.sessions.find((item) => item.id === id);
  const client = session && getClientById(session.clientId);
  if (!session || !client) return;

  activeSessionDialogId = session.id;
  const isCancelled = session.status === 'cancelled';
  const isPlanned = session.status === 'upcoming';
  const isPast = new Date(`${session.date}T${session.time}:00`) < new Date();
  const statusLabel = isCancelled
    ? 'İptal edildi'
    : session.status === 'completed' ? 'Tamamlandı' : isPast ? 'Durum girilmedi' : 'Planlandı';

  document.querySelector('#sessionDialogTitle').textContent = client.name;
  document.querySelector('#sessionDialogMeta').textContent = `${formatDate(session.date)} · ${session.time} · ${getSessionTypeLabel(session.mode)}`;
  document.querySelector('#sessionDialogStatus').textContent = statusLabel;
  document.querySelector('#sessionDialogStatus').className = `tag ${isCancelled ? 'cancelled' : session.status === 'completed' ? 'success' : 'pending'}`;
  document.querySelector('#sessionDialogFee').textContent = formatCurrency(Number(session.fee) || Number(client.fee) || 0);
  document.querySelector('#reschedulePanel').hidden = true;
  document.querySelector('#rescheduleDate').value = session.date;
  document.querySelector('#rescheduleTime').value = session.time;
  document.querySelector('#rescheduleSessionButton').hidden = !isPlanned;
  const rescheduleHistory = document.querySelector('#sessionRescheduleHistory');
  const history = Array.isArray(session.rescheduleHistory) ? session.rescheduleHistory : [];
  rescheduleHistory.innerHTML = history.map((change) => (
    `<small>Önceki tarih: ${formatDate(change.date)} · ${escapeHtml(change.time)}</small>`
  )).join('');
  rescheduleHistory.hidden = history.length === 0;
  sessionDialogNote.value = session.note || '';
  sessionDialogNote.disabled = isCancelled;
  sessionSummaryStatus.value = session.summaryStatus === 'written' ? 'written' : 'notWritten';
  sessionSummaryStatus.disabled = isCancelled;
  sessionDialogPayment.disabled = isCancelled;
  sessionDialogPayment.dataset.paymentStatus = session.paymentStatus === 'paid' ? 'paid' : 'unpaid';
  sessionDialogPayment.textContent = sessionDialogPayment.dataset.paymentStatus === 'paid' ? 'Ödendi' : 'Ödenmedi';
  sessionDialogPayment.classList.toggle('paid', sessionDialogPayment.dataset.paymentStatus === 'paid');
  sessionDialogPayment.setAttribute('aria-pressed', String(sessionDialogPayment.dataset.paymentStatus === 'paid'));
  document.querySelector('#cancelSessionFromDialog').hidden = !isPlanned;
  document.querySelector('#completeSessionFromDialog').hidden = !isPlanned;
  document.querySelector('#saveSessionDetails').hidden = isCancelled;

  if (!sessionDialog.open) sessionDialog.showModal();
}

function saveSessionDetails(markCompleted) {
  const session = state.sessions.find((item) => item.id === activeSessionDialogId);
  if (!session || session.status === 'cancelled') return;

  session.note = sessionDialogNote.value.trim();
  session.summaryStatus = sessionSummaryStatus.value === 'written' ? 'written' : 'notWritten';
  session.paymentStatus = sessionDialogPayment.dataset.paymentStatus;
  if (markCompleted && session.status === 'upcoming') {
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
  }

  saveState();
  sessionDialog.close();
  render();
}

function rescheduleSession() {
  const session = state.sessions.find((item) => item.id === activeSessionDialogId);
  if (!session || session.status !== 'upcoming') return;

  const newDate = document.querySelector('#rescheduleDate').value;
  const newTime = document.querySelector('#rescheduleTime').value;
  if (!newDate || !newTime) {
    alert('Lütfen yeni seans tarihi ve saatini girin.');
    return;
  }

  if (new Date(`${newDate}T${newTime}:00`) < new Date()) {
    alert('Seansı geçmiş bir tarih ve saate erteleyemezsiniz.');
    return;
  }

  const hasConflict = state.sessions.some((otherSession) => (
    otherSession.id !== session.id
    && otherSession.status !== 'cancelled'
    && otherSession.date === newDate
    && otherSession.time === newTime
  ));
  if (hasConflict) {
    alert('Bu tarih ve saatte başka bir seans planlanmış. Lütfen farklı bir saat seçin.');
    return;
  }

  if (newDate !== session.date || newTime !== session.time) {
    session.rescheduleHistory = [...(session.rescheduleHistory || []), {
      date: session.date,
      time: session.time,
      changedAt: new Date().toISOString()
    }];
    const client = getClientById(session.clientId);
    if (client) client.rescheduledSessionCount = (client.rescheduledSessionCount || 0) + 1;
    session.date = newDate;
    session.time = newTime;
  }

  selectedCalendarDate = newDate;
  calendarMonth = new Date(`${newDate}T00:00:00`);
  calendarMonth.setDate(1);
  saveSessionDetails(false);
}

function calculateMonthlyTotals(year, month) {
  const monthSessions = state.sessions.filter((session) => {
    const [sessionYear, sessionMonth] = session.date.split('-').map(Number);
    return session.status !== 'cancelled' && sessionYear === year && sessionMonth === month + 1;
  });

  return monthSessions.reduce((result, session) => {
    const client = getClientById(session.clientId);
    const fee = Number.isFinite(Number(session.fee)) ? Number(session.fee) : Number(client?.fee) || 0;
    result[session.paymentStatus === 'paid' ? 'paid' : 'unpaid'] += fee;
    if (session.paymentStatus === 'paid' && session.mode === 'faceToFace') {
      result.commission += fee * 0.3;
    }
    return result;
  }, { paid: 0, unpaid: 0, commission: 0 });
}

function renderMonthlyBreakdown() {
  document.querySelector('#financeYear').textContent = String(selectedFinanceYear);
  document.querySelector('#monthlyBreakdown').innerHTML = Array.from({ length: 12 }, (_, month) => {
    const totals = calculateMonthlyTotals(selectedFinanceYear, month);
    const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(new Date(selectedFinanceYear, month, 1));
    const currentMonth = selectedFinanceYear === currentDate.getFullYear() && month === currentDate.getMonth();

    return `
      <div class="monthly-breakdown-row ${currentMonth ? 'is-current-month' : ''}">
        <strong class="monthly-month-name">${escapeHtml(monthName.replace('.', ''))}</strong>
        <span>${formatCurrency(totals.paid)}</span>
        <span>${formatCurrency(totals.commission)}</span>
        <strong>${formatCurrency(totals.paid - totals.commission)}</strong>
      </div>
    `;
  }).join('');
}

function renderIncome() {
  const now = currentDate;
  const totals = calculateMonthlyTotals(now.getFullYear(), now.getMonth());
  const total = totals.paid + totals.unpaid;
  const percentage = total ? Math.round((totals.paid / total) * 100) : 0;

  document.querySelector('.income-header small').textContent = new Intl.DateTimeFormat('tr-TR', {
    month: 'long',
    year: 'numeric'
  }).format(now);
  document.querySelector('#monthlyIncome').textContent = formatCurrency(totals.paid);
  document.querySelector('#officeCommission').textContent = formatCurrency(totals.commission);
  document.querySelector('#netIncome').textContent = formatCurrency(totals.paid - totals.commission);
  document.querySelector('#paidTotal').textContent = formatCurrency(totals.paid);
  document.querySelector('#unpaidTotal').textContent = formatCurrency(totals.unpaid);
  document.querySelector('#collectionRate').textContent = `%${percentage}`;
  document.querySelector('#collectionDonut').style.setProperty('--paid-ratio', `${percentage}%`);
  renderMonthlyBreakdown();
}

function activateScreen(name, navigationTarget = name) {
  navItems.forEach((item) => item.classList.toggle('active', item.dataset.target === navigationTarget));
  screens.forEach((screen) => {
    screen.classList.toggle('active', screen.dataset.screen === name);
  });
}

navItems.forEach((button) => {
  button.addEventListener('click', () => {
    activateScreen(button.dataset.target);
  });
});

function handleSessionRowClick(event) {
  const row = event.target.closest('.session-row[data-session-id]');
  if (row) openSessionDialog(row.dataset.sessionId);
}

function handleSessionRowKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.session-row[data-session-id]');
  if (!row) return;
  event.preventDefault();
  openSessionDialog(row.dataset.sessionId);
}

sessionList.addEventListener('click', handleSessionRowClick);
todaySessionList.addEventListener('click', handleSessionRowClick);
sessionList.addEventListener('keydown', handleSessionRowKeydown);
todaySessionList.addEventListener('keydown', handleSessionRowKeydown);

sessionDialogPayment.addEventListener('click', () => {
  const isPaid = sessionDialogPayment.dataset.paymentStatus === 'paid';
  sessionDialogPayment.dataset.paymentStatus = isPaid ? 'unpaid' : 'paid';
  sessionDialogPayment.textContent = isPaid ? 'Ödenmedi' : 'Ödendi';
  sessionDialogPayment.classList.toggle('paid', !isPaid);
  sessionDialogPayment.setAttribute('aria-pressed', String(!isPaid));
});

document.querySelector('#completeSessionFromDialog').addEventListener('click', () => saveSessionDetails(true));
document.querySelector('#saveSessionDetails').addEventListener('click', () => saveSessionDetails(false));
document.querySelector('#cancelSessionFromDialog').addEventListener('click', () => cancelSession(activeSessionDialogId));
document.querySelector('#rescheduleSessionButton').addEventListener('click', () => {
  document.querySelector('#reschedulePanel').hidden = false;
});
document.querySelector('#cancelReschedule').addEventListener('click', () => {
  document.querySelector('#reschedulePanel').hidden = true;
});
document.querySelector('#saveReschedule').addEventListener('click', rescheduleSession);
document.querySelector('#previousFinanceYear').addEventListener('click', () => {
  selectedFinanceYear -= 1;
  renderMonthlyBreakdown();
});
document.querySelector('#nextFinanceYear').addEventListener('click', () => {
  selectedFinanceYear += 1;
  renderMonthlyBreakdown();
});
document.querySelector('#closeSessionDialog').addEventListener('click', () => sessionDialog.close());
sessionDialog.addEventListener('click', (event) => {
  if (event.target === sessionDialog) sessionDialog.close();
});

loginForm.addEventListener('submit', submitLogin);
document.querySelector('#keepLocalCopyButton').addEventListener('click', () => resolveCloudConflict(true));
document.querySelector('#useCloudCopyButton').addEventListener('click', () => resolveCloudConflict(false));
window.addEventListener('focus', refreshCloudWorkspace);
window.addEventListener('online', refreshCloudWorkspace);
window.setInterval(refreshCloudWorkspace, 45_000);

calendarGrid.addEventListener('click', (event) => {
  const dayButton = event.target.closest('[data-calendar-date]');
  if (!dayButton) return;
  selectedCalendarDate = dayButton.dataset.calendarDate;
  renderCalendar();
});

document.querySelector('#previousMonth').addEventListener('click', () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
  selectedCalendarDate = toISODate(calendarMonth);
  renderCalendar();
});

document.querySelector('#nextMonth').addEventListener('click', () => {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
  selectedCalendarDate = toISODate(calendarMonth);
  renderCalendar();
});

document.querySelector('#calendarToday').addEventListener('click', () => {
  const now = new Date();
  calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  selectedCalendarDate = toISODate(now);
  renderCalendar();
});

formModeButtons.forEach((button) => {
  button.addEventListener('click', () => setFormMode(button.dataset.formMode));
});

document.querySelector('#addSessionButton').addEventListener('click', () => {
  activateScreen('new-session', 'sessions');
  setFormMode('session');
});

document.querySelector('#todayAddSessionButton').addEventListener('click', () => {
  activateScreen('new-session', 'today');
  setFormMode('session');
});

document.querySelector('#addClientButton').addEventListener('click', () => {
  activateScreen('new-session', 'clients');
  setFormMode('client');
});

clientList.addEventListener('click', (event) => {
  const detailButton = event.target.closest('[data-client-detail]');
  if (detailButton) {
    renderClientDetail(detailButton.dataset.clientDetail);
    return;
  }

  const button = event.target.closest('[data-client-session]');
  if (!button) return;

  activateScreen('new-session', 'clients');
  setFormMode('session');
  sessionClientSelect.value = button.dataset.clientSession;
  updateSessionMode();
});

clientSessionHistory.addEventListener('click', handleSessionRowClick);
clientSessionHistory.addEventListener('keydown', handleSessionRowKeydown);
document.querySelector('#backToClients').addEventListener('click', () => activateScreen('clients'));

sessionClientSelect.addEventListener('change', updateSessionMode);

clientForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const data = {
    name: document.querySelector('#clientName').value,
    mode: document.querySelector('#clientMode').value,
    fee: document.querySelector('#clientFee').value,
    note: document.querySelector('#clientNote').value
  };

  if (!data.name.trim() || !data.fee) {
    alert('Lütfen danışan adı ve ücret alanlarını doldurun.');
    return;
  }

  createClient(data);
  clientForm.reset();
});

sessionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  createSession({
    clientId: sessionClientSelect.value,
    date: document.querySelector('#sessionDate').value,
    time: document.querySelector('#sessionTime').value,
    mode: document.querySelector('#sessionMode').value
  });
});

function render() {
  renderCalendar();
  renderToday();
  renderClients();
  renderIncome();
  renderSessionClientOptions();
}

async function initializeApp() {
  try {
    state = await loadState();
  } catch (error) {
    console.error('IndexedDB açılamadı; yerel yedek kullanılıyor:', error);
    state = readLegacyState() || structuredClone(EMPTY_STATE);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (fallbackError) {
      console.error('Yerel yedek kaydedilemedi:', fallbackError);
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.error('Çevrimdışı uygulama kaydı başarısız:', error);
    });
  }

  try {
    const savedSession = await window.DanismaCloudStore.restoreSession();
    if (savedSession) {
      await loadCloudWorkspace();
    } else {
      showLogin(window.DanismaCloudStore.isConfigured()
        ? ''
        : 'Girişten önce Supabase URL ve Publishable/anon key ayarlanmalı.');
    }
  } catch (error) {
    console.error('Supabase oturumu veya verisi yüklenemedi:', error);
    showLogin(error.message);
  }
}

initializeApp();
