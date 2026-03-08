/* ============================================================
   FlightWatch — app.js
   Full flight tracking logic: search, watchlist, alerts
   ============================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────
const API_BASE = 'http://api.aviationstack.com/v1/flights';
const WATCHLIST_KEY = 'flightwatch_watchlist';   // localStorage key
const PREV_STATUS_KEY = 'flightwatch_prev_status'; // localStorage key for status tracking
const ALERTS_ENABLED_KEY = 'flightwatch_alerts_on';   // app-level alert toggle
const SETTINGS_KEY = 'flightwatch_settings';    // user settings (api key, whatsapp)
const REFRESH_INTERVAL = 60 * 60 * 1000;            // 60 minutes

// ── DOM refs ─────────────────────────────────────────────────
const flightInput = document.getElementById('flight-input');
const searchBtn = document.getElementById('search-btn');
const searchSpinner = document.getElementById('search-spinner');
const searchError = document.getElementById('search-error');
const resultSection = document.getElementById('result-section');
const resultCard = document.getElementById('result-card');
const watchlistGrid = document.getElementById('watchlist-grid');
const watchlistEmpty = document.getElementById('watchlist-empty');
const refreshAllBtn = document.getElementById('refresh-all-btn');
const notifBtn = document.getElementById('notif-btn');
const notifLabel = document.getElementById('notif-label');
const lastUpdated = document.getElementById('last-updated');
const toastContainer = document.getElementById('toast-container');

// ── State ────────────────────────────────────────────────────
let currentResult = null;
let autoRefreshTimer = null;
// App-level alert preference (separate from browser permission)
// Defaults to true so alerts are on immediately after browser permission is granted
let alertsEnabled = localStorage.getItem(ALERTS_ENABLED_KEY) !== 'false';

// ── Init ─────────────────────────────────────────────────────
(function init() {
    renderWatchlist();
    updateNotifButton();   // reflect existing permission state — never prompts automatically
    startAutoRefresh();
    checkFirstRun();        // show settings if no API key found

    // Settings panel
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    document.getElementById('settings-save-btn').addEventListener('click', saveSettings);
    document.getElementById('settings-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'settings-overlay') closeSettings();
    });

    // Search on button click
    searchBtn.addEventListener('click', handleSearch);

    // Search on Enter key
    flightInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleSearch();
    });

    // Uppercase input automatically
    flightInput.addEventListener('input', () => {
        const pos = flightInput.selectionStart;
        flightInput.value = flightInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        flightInput.setSelectionRange(pos, pos);
    });

    refreshAllBtn.addEventListener('click', () => {
        refreshAllBtn.classList.add('spinning');
        refreshWatchlist().then(() => {
            refreshAllBtn.classList.remove('spinning');
        });
    });
})();

// ── Search ───────────────────────────────────────────────────
async function handleSearch() {
    const raw = flightInput.value.trim().toUpperCase();
    if (!raw) {
        showError('Please enter a flight number, e.g. BA123 or TP451.');
        return;
    }
    if (raw.length < 3) {
        showError('Flight number seems too short. Try something like BA123.');
        return;
    }

    clearError();
    setSearchLoading(true);

    try {
        const data = await fetchFlight(raw);
        if (!data) {
            showError(`No flight found for "${raw}". Check the number and try again.`);
            hideResult();
        } else {
            currentResult = data;
            renderResultCard(data);
        }
    } catch (err) {
        showError(err.message || 'Something went wrong. Please try again.');
        hideResult();
    } finally {
        setSearchLoading(false);
    }
}

function setSearchLoading(on) {
    searchBtn.disabled = on;
    document.querySelector('.btn-label').classList.toggle('hidden', on);
    searchSpinner.classList.toggle('hidden', !on);
}

function showError(msg) {
    searchError.textContent = msg;
    searchError.classList.remove('hidden');
}
function clearError() {
    searchError.textContent = '';
    searchError.classList.add('hidden');
}
function hideResult() {
    resultSection.classList.add('hidden');
}

// ── API ──────────────────────────────────────────────────────
async function fetchFlight(flightIata) {
    const key = getSettings().aviationKey;
    if (!key) {
        openSettings();
        throw new Error('No API key set. Please enter your AviationStack key in Settings.');
    }
    // On HTTPS (GitHub Pages), route via CORS proxy — AviationStack free plan is HTTP-only
    const target = `${API_BASE}?access_key=${key}&flight_iata=${encodeURIComponent(flightIata)}`;
    const url = location.protocol === 'https:'
        ? `https://corsproxy.io/?${encodeURIComponent(target)}`
        : target;

    let res;
    try {
        res = await fetch(url);
    } catch (_) {
        throw new Error('Network error — check your internet connection.');
    }

    if (!res.ok) throw new Error(`API error: ${res.status}`);

    const json = await res.json();

    if (json.error) {
        const msg = json.error.message || 'API returned an error.';
        throw new Error(msg);
    }

    if (!json.data || json.data.length === 0) return null;

    // Return the most recent entry (first in array)
    return json.data[0];
}

// ── Status helpers ───────────────────────────────────────────
function statusLabel(raw) {
    const map = {
        scheduled: 'Scheduled',
        active: 'In Flight',
        landed: 'Landed',
        cancelled: 'Cancelled',
        incident: 'Incident',
        diverted: 'Diverted',
    };
    return map[raw] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown');
}

function statusClass(raw) {
    if (raw === 'active') return 'active';
    if (raw === 'landed') return 'landed';
    if (raw === 'cancelled') return 'cancelled';
    if (raw === 'diverted') return 'diverted';
    if (raw === 'scheduled') return 'scheduled';
    return 'scheduled';
}

function isDelayed(flight) {
    const dep = flight.departure?.delay;
    const arr = flight.arrival?.delay;
    return (dep && dep > 0) || (arr && arr > 0);
}

// ── Format helpers ───────────────────────────────────────────
function formatTime(isoString) {
    if (!isoString) return '—';
    try {
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return '—'; }
}

function formatDate(isoString) {
    if (!isoString) return '—';
    try {
        return new Date(isoString).toLocaleDateString([], { day: 'numeric', month: 'short' });
    } catch (_) { return '—'; }
}

function delayText(minutes) {
    if (!minutes || minutes <= 0) return null;
    return `+${minutes} min delay`;
}

// ── Render: full result card ─────────────────────────────────
function renderResultCard(f) {
    const status = f.flight_status || 'unknown';
    const sc = statusClass(status);
    const delayed = isDelayed(f);

    const depSched = formatTime(f.departure?.scheduled);
    const depEst = formatTime(f.departure?.estimated || f.departure?.actual);
    const arrSched = formatTime(f.arrival?.scheduled);
    const arrEst = formatTime(f.arrival?.estimated || f.arrival?.actual);
    const depDelay = delayText(f.departure?.delay);
    const arrDelay = delayText(f.arrival?.delay);
    const isWatched = getWatchlist().includes(f.flight?.iata);

    resultCard.innerHTML = `
    <div class="flight-card__status-bar statusbar--${sc}"></div>
    <div class="flight-card__header">
      <div>
        <div class="flight-card__airline">${f.airline?.name || 'Unknown Airline'}</div>
        <div class="flight-card__number">${f.flight?.iata || '—'}</div>
      </div>
      <div class="status-badge status--${delayed && status === 'scheduled' ? 'delayed' : sc}">
        <div class="status-badge__dot"></div>
        ${delayed && status === 'scheduled' ? 'Delayed' : statusLabel(status)}
      </div>
    </div>

    <div class="flight-route">
      <div class="route-point">
        <div class="route-point__code">${f.departure?.iata || '—'}</div>
        <div class="route-point__city">${f.departure?.airport || '—'}</div>
      </div>
      <div class="route-line">
        <span class="route-line__plane">✈</span>
        <hr class="route-line__hr"/>
      </div>
      <div class="route-point route-point--arrival">
        <div class="route-point__code">${f.arrival?.iata || '—'}</div>
        <div class="route-point__city">${f.arrival?.airport || '—'}</div>
      </div>
    </div>

    <div class="flight-details">
      <div class="detail-item">
        <div class="detail-item__label">Departs</div>
        <div class="detail-item__value">${depSched}</div>
        ${depEst && depEst !== depSched ? `<div class="detail-item__value ${depDelay ? 'delayed' : ''}">${depEst} est.</div>` : ''}
      </div>
      <div class="detail-item">
        <div class="detail-item__label">Arrives</div>
        <div class="detail-item__value">${arrSched}</div>
        ${arrEst && arrEst !== arrSched ? `<div class="detail-item__value ${arrDelay ? 'delayed' : ''}">${arrEst} est.</div>` : ''}
      </div>
      ${f.departure?.terminal ? `
      <div class="detail-item">
        <div class="detail-item__label">Terminal</div>
        <div class="detail-item__value">${f.departure.terminal}</div>
      </div>` : ''}
      ${f.departure?.gate ? `
      <div class="detail-item">
        <div class="detail-item__label">Gate</div>
        <div class="detail-item__value">${f.departure.gate}</div>
      </div>` : ''}
      <div class="detail-item">
        <div class="detail-item__label">Date</div>
        <div class="detail-item__value">${formatDate(f.flight_date) || formatDate(f.departure?.scheduled)}</div>
      </div>
      ${f.aircraft?.registration ? `
      <div class="detail-item">
        <div class="detail-item__label">Aircraft</div>
        <div class="detail-item__value">${f.aircraft.registration}</div>
      </div>` : ''}
    </div>

    <div class="card-actions">
      <button class="btn-ghost" id="close-result-btn">Dismiss</button>
      ${isWatched
            ? `<button class="btn-ghost" id="watchlist-toggle-btn">Remove from Watchlist</button>`
            : `<button class="btn-primary" id="watchlist-toggle-btn">+ Add to Watchlist</button>`
        }
    </div>
  `;

    resultSection.classList.remove('hidden');

    document.getElementById('close-result-btn').addEventListener('click', () => {
        resultSection.classList.add('hidden');
    });

    document.getElementById('watchlist-toggle-btn').addEventListener('click', () => {
        const iata = f.flight?.iata;
        if (!iata) return showToast('Cannot track — flight number missing.', 'error');
        if (getWatchlist().includes(iata)) {
            removeFromWatchlist(iata);
        } else {
            addToWatchlist(iata, f);
        }
        // Re-render card to update button
        renderResultCard(f);
    });
}

// ── Watchlist: storage ───────────────────────────────────────
function getWatchlist() {
    try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY)) || []; }
    catch (_) { return []; }
}

function saveWatchlist(list) {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

function getPrevStatuses() {
    try { return JSON.parse(localStorage.getItem(PREV_STATUS_KEY)) || {}; }
    catch (_) { return {}; }
}

function savePrevStatuses(obj) {
    localStorage.setItem(PREV_STATUS_KEY, JSON.stringify(obj));
}

function addToWatchlist(iata, flightData) {
    const list = getWatchlist();
    if (list.includes(iata)) return;
    list.push(iata);
    saveWatchlist(list);
    showToast(`${iata} added to your watchlist.`, 'success');

    // Kick off a render with existing data immediately
    renderWatchlist();

    // Also store initial status to detect future changes
    const statuses = getPrevStatuses();
    statuses[iata] = flightData?.flight_status || null;
    savePrevStatuses(statuses);
}

function removeFromWatchlist(iata) {
    const list = getWatchlist().filter(f => f !== iata);
    saveWatchlist(list);
    const statuses = getPrevStatuses();
    delete statuses[iata];
    savePrevStatuses(statuses);
    showToast(`${iata} removed from watchlist.`, 'info');
    renderWatchlist();
}

// ── Watchlist: render ────────────────────────────────────────
async function renderWatchlist(fetchedData) {
    const list = getWatchlist();

    if (list.length === 0) {
        watchlistEmpty.classList.remove('hidden');
        watchlistGrid.innerHTML = '';
        return;
    }

    watchlistEmpty.classList.add('hidden');

    // If we have pre-fetched data, just render it
    if (fetchedData) {
        watchlistGrid.innerHTML = '';
        fetchedData.forEach(({ iata, data }) => {
            watchlistGrid.appendChild(buildWatchCard(iata, data));
        });
        return;
    }

    // Create placeholder cards while loading
    watchlistGrid.innerHTML = list.map(iata => `
    <div class="card watch-card loading" data-iata="${iata}">
      <div class="watch-card__top">
        <div class="watch-card__flight">${iata}</div>
      </div>
      <div style="color:var(--text-tertiary);font-size:13px;">Loading…</div>
    </div>
  `).join('');
}

async function refreshWatchlist() {
    const list = getWatchlist();
    if (list.length === 0) return;

    const statuses = getPrevStatuses();
    const results = [];

    for (const iata of list) {
        try {
            const data = await fetchFlight(iata);
            results.push({ iata, data });

            // Check for departure (scheduled → active) and arrival (any → landed)
            if (data) {
                const prev = statuses[iata];
                const curr = data.flight_status;
                if (prev && prev !== 'active' && curr === 'active') {
                    fireDepartureNotification(iata, data);
                    sendDepartureWhatsAppAlert(iata, data);
                    showToast(`${iata} has taken off from ${data.departure?.airport || 'origin'}.`, 'info');
                }
                if (prev !== 'landed' && curr === 'landed') {
                    fireArrivalNotification(iata, data);
                    sendWhatsAppAlert(iata, data);
                    showToast(`${iata} has landed at ${data.arrival?.airport || 'destination'}.`, 'success');
                }
                statuses[iata] = curr;
            }
        } catch (_) {
            results.push({ iata, data: null });
        }
    }

    savePrevStatuses(statuses);

    // Render all at once
    watchlistGrid.innerHTML = '';
    results.forEach(({ iata, data }) => {
        watchlistGrid.appendChild(buildWatchCard(iata, data));
    });
    watchlistEmpty.classList.add('hidden');

    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function buildWatchCard(iata, f) {
    const el = document.createElement('div');
    el.className = 'card watch-card';
    el.setAttribute('data-iata', iata);

    if (!f) {
        el.innerHTML = `
      <div class="watch-card__top">
        <div class="watch-card__flight">${iata}</div>
        <button class="remove-btn" title="Remove">✕</button>
      </div>
      <div style="color:var(--text-tertiary);font-size:13px;">Could not fetch data. Will retry on next refresh.</div>
    `;
        el.querySelector('.remove-btn').addEventListener('click', () => removeFromWatchlist(iata));
        return el;
    }

    const status = f.flight_status || 'unknown';
    const sc = statusClass(status);
    const delayed = isDelayed(f);
    const displayStatus = delayed && status === 'scheduled' ? 'delayed' : sc;

    el.innerHTML = `
    <div class="flight-card__status-bar statusbar--${displayStatus}" style="border-radius: 24px 24px 0 0;"></div>
    <div class="watch-card__top">
      <div class="watch-card__flight">${f.flight?.iata || iata}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="status-badge status--${displayStatus}" style="font-size:11px;padding:4px 10px;">
          <div class="status-badge__dot"></div>
          ${delayed && status === 'scheduled' ? 'Delayed' : statusLabel(status)}
        </div>
        <button class="remove-btn" title="Remove">✕</button>
      </div>
    </div>
    <div class="watch-card__route">
      <div class="route-iata">${f.departure?.iata || '—'}</div>
      <div class="route-arrow">— ✈ —</div>
      <div class="route-iata">${f.arrival?.iata || '—'}</div>
    </div>
    <div class="watch-card__times">
      <div class="time-item">
        <div class="time-item__label">Departs</div>
        <div class="time-item__value">${formatTime(f.departure?.scheduled)}</div>
      </div>
      <div class="time-item">
        <div class="time-item__label">Arrives</div>
        <div class="time-item__value">${formatTime(f.arrival?.scheduled)}</div>
      </div>
      ${f.departure?.delay > 0 ? `
      <div class="time-item">
        <div class="time-item__label">Dep. Delay</div>
        <div class="time-item__value" style="color:var(--orange)">+${f.departure.delay} min</div>
      </div>` : ''}
      ${f.arrival?.delay > 0 ? `
      <div class="time-item">
        <div class="time-item__label">Arr. Delay</div>
        <div class="time-item__value" style="color:var(--orange)">+${f.arrival.delay} min</div>
      </div>` : ''}
    </div>
    <div class="watch-card__footer">
      <span style="font-size:12px;color:var(--text-tertiary)">${f.airline?.name || ''}</span>
    </div>
  `;

    el.querySelector('.remove-btn').addEventListener('click', () => removeFromWatchlist(iata));
    return el;
}

// ── Auto-refresh ─────────────────────────────────────────────
function startAutoRefresh() {
    // Do an immediate refresh on load
    const list = getWatchlist();
    if (list.length > 0) {
        refreshWatchlist();
    }

    // Then every 15 minutes
    autoRefreshTimer = setInterval(() => {
        refreshWatchlist();
    }, REFRESH_INTERVAL);
}

// ── Notifications ────────────────────────────────────────────
function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission().then(updateNotifButton);
    }
}

function updateNotifButton() {
    if (!('Notification' in window)) {
        notifBtn.classList.add('hidden');
        return;
    }

    // Reset classes, inline styles, and injected elements
    notifBtn.classList.remove('active', 'denied', 'paused');
    notifBtn.removeAttribute('style');
    const existingDot = notifBtn.querySelector('.active-dot');
    if (existingDot) existingDot.remove();

    const perm = Notification.permission;

    if (perm === 'granted' && alertsEnabled) {
        // Alerts ON — solid green
        notifBtn.classList.add('active');
        notifBtn.style.cssText = 'background:#30d158;border-color:#30d158;color:#000;box-shadow:0 0 16px rgba(48,209,88,0.4);';
        notifLabel.textContent = 'Disable Alerts';
        const dot = document.createElement('span');
        dot.className = 'active-dot';
        dot.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#000;flex-shrink:0;';
        notifBtn.insertBefore(dot, notifLabel);
    } else if (perm === 'granted' && !alertsEnabled) {
        // Alerts OFF (but permitted)
        notifBtn.classList.add('paused');
        notifLabel.textContent = 'Enable Alerts';
    } else if (perm === 'denied') {
        // Browser blocked
        notifBtn.classList.add('denied');
        notifBtn.style.cssText = 'background:rgba(255,69,58,0.12);border-color:rgba(255,69,58,0.35);color:#ff453a;';
        notifLabel.textContent = 'Alerts Blocked';
    } else {
        // Not yet asked
        notifLabel.textContent = 'Enable Alerts';
    }
}

notifBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
        showToast('Your browser does not support notifications.', 'error');
        return;
    }

    if (Notification.permission === 'granted') {
        // Toggle app-level preference — no browser dialog needed
        alertsEnabled = !alertsEnabled;
        localStorage.setItem(ALERTS_ENABLED_KEY, String(alertsEnabled));
        updateNotifButton();
        showToast(alertsEnabled ? 'Arrival alerts enabled.' : 'Arrival alerts paused.', alertsEnabled ? 'success' : 'info');
        return;
    }

    if (Notification.permission === 'denied') {
        showToast('Notifications are blocked. Enable them in your browser settings, then reload.', 'error');
        return;
    }

    // Permission is 'default' — ask the browser
    // Disable button while waiting for dialog
    notifBtn.disabled = true;
    notifLabel.textContent = 'Waiting…';

    try {
        // Works in Chrome (returns Promise) and Safari 15+ (returns Promise)
        // For older Safari, requestPermission() is callback-only — wrap in a safe Promise
        const result = await new Promise((resolve) => {
            const p = Notification.requestPermission((r) => resolve(r));
            if (p && typeof p.then === 'function') p.then(resolve);
        });

        alertsEnabled = (result === 'granted');
        localStorage.setItem(ALERTS_ENABLED_KEY, String(alertsEnabled));

        if (result === 'granted') {
            showToast('Arrival alerts enabled. You will be notified when tracked flights land.', 'success');
        } else {
            showToast('Notification permission was not granted. You can enable it in browser settings.', 'error');
        }
    } catch (err) {
        // Fallback — check current state
        alertsEnabled = (Notification.permission === 'granted');
        localStorage.setItem(ALERTS_ENABLED_KEY, String(alertsEnabled));
    } finally {
        notifBtn.disabled = false;
        updateNotifButton();
    }
});

function fireArrivalNotification(iata, f) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !alertsEnabled) return;

    const arrival = f.arrival?.airport || 'destination';
    const time = formatTime(f.arrival?.actual || f.arrival?.estimated || f.arrival?.scheduled);

    new Notification(`${iata} has landed`, {
        body: `Arrived at ${arrival}${time !== '—' ? ' at ' + time : ''}.`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="20" font-size="20">✈</text></svg>',
        tag: `flightwatch-${iata}`, // prevents duplicate notifications for same flight
    });
    playNotificationSound(true);
}

// ── Toast ────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
// ── WhatsApp alert via CallMeBot ─────────────────────────────────────
function sendWhatsAppAlert(iata, f) {
    const wa = getSettings().whatsapp;
    if (!wa.enabled || !wa.phone || !wa.apiKey) return;
    const airport = f.arrival?.airport || 'destination';
    const time = formatTime(f.arrival?.actual || f.arrival?.estimated || f.arrival?.scheduled);
    const text = encodeURIComponent(`✈️ FlightWatch: ${iata} has LANDED at ${airport}${time !== '—' ? ' at ' + time : ''}.`);
    new Image().src = `https://api.callmebot.com/whatsapp.php?phone=${wa.phone}&text=${text}&apikey=${wa.apiKey}`;
}

function sendDepartureWhatsAppAlert(iata, f) {
    const wa = getSettings().whatsapp;
    if (!wa.enabled || !wa.phone || !wa.apiKey) return;
    const airport = f.departure?.airport || 'origin';
    const text = encodeURIComponent(`✈️ FlightWatch: ${iata} has TAKEN OFF from ${airport}.`);
    new Image().src = `https://api.callmebot.com/whatsapp.php?phone=${wa.phone}&text=${text}&apikey=${wa.apiKey}`;
}

// ── Settings ─────────────────────────────────────────────────────────
function getSettings() {
    // Merges localStorage (deployed) with config.js (local dev); localStorage wins
    const stored = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) { return {}; } })();
    const cfg = (typeof CONFIG !== 'undefined') ? CONFIG : {};
    return {
        aviationKey: stored.aviationKey || cfg.AVIATION_STACK_KEY || '',
        whatsapp: {
            enabled: stored.whatsappEnabled !== undefined ? stored.whatsappEnabled : (cfg.WHATSAPP?.enabled || false),
            phone: stored.whatsappPhone || cfg.WHATSAPP?.phone || '',
            apiKey: stored.whatsappApiKey || cfg.WHATSAPP?.apiKey || '',
        }
    };
}

function openSettings() {
    const s = getSettings();
    document.getElementById('settings-aviation-key').value = s.aviationKey;
    document.getElementById('settings-wa-phone').value = s.whatsapp.phone;
    document.getElementById('settings-wa-apikey').value = s.whatsapp.apiKey;
    document.getElementById('settings-overlay').classList.remove('hidden');
}

function closeSettings() {
    document.getElementById('settings-overlay').classList.add('hidden');
}

function saveSettings() {
    const key = document.getElementById('settings-aviation-key').value.trim();
    const waPhone = document.getElementById('settings-wa-phone').value.trim();
    const waKey = document.getElementById('settings-wa-apikey').value.trim();

    if (!key) {
        document.getElementById('settings-aviation-key').focus();
        return;
    }

    const settings = {
        aviationKey: key,
        whatsappEnabled: !!(waPhone && waKey),
        whatsappPhone: waPhone,
        whatsappApiKey: waKey,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    closeSettings();
    showToast('Settings saved.', 'success');
}

function checkFirstRun() {
    if (!getSettings().aviationKey) openSettings();
}

// ── Departure browser notification ───────────────────────────────────
function fireDepartureNotification(iata, f) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !alertsEnabled) return;
    const dep = f.departure?.airport || 'origin';
    new Notification(`${iata} has taken off`, {
        body: `Departed from ${dep}.`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="20" font-size="20">✈</text></svg>',
        tag: `flightwatch-dep-${iata}`,
    });
    playNotificationSound(false);
}

// ── Notification sound (Web Audio API — no file needed) ──────────────
function playNotificationSound(isArrival = true) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();

        if (isArrival) {
            // Ascending chime that builds over ~5 seconds
            const notes = [
                [523.25, 0.0, 0.6],   // C5
                [659.25, 0.5, 0.6],   // E5
                [783.99, 1.0, 0.6],   // G5
                [1046.5, 1.5, 1.0],   // C6 (held)
                [783.99, 2.6, 0.4],   // G5
                [1046.5, 3.0, 0.4],   // C6
                [1318.5, 3.4, 1.8],   // E6 (final, long fade)
            ];
            notes.forEach(([freq, delay, dur]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const t = ctx.currentTime + delay;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.15, t + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
                osc.start(t);
                osc.stop(t + dur + 0.1);
            });
        } else {
            // Two quick ascending beeps for departure
            [[587.33, 0.0], [739.99, 0.35]].forEach(([freq, delay]) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const t = ctx.currentTime + delay;
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
                osc.start(t);
                osc.stop(t + 0.45);
            });
        }

        setTimeout(() => ctx.close().catch(() => { }), 6000);
    } catch (_) {
        // Web Audio not available — silent fallback
    }
}

