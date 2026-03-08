/* ============================================================
   FlightWatch — app.js
   Full flight tracking logic: search, watchlist, alerts
   ============================================================ */

'use strict';

// ── Constants ────────────────────────────────────────────────
const API_BASE = 'http://api.aviationstack.com/v1/flights';
const WATCHLIST_KEY = 'flightwatch_watchlist';   // localStorage key
const PREV_STATUS_KEY = 'flightwatch_prev_status'; // localStorage key for status tracking
const REFRESH_INTERVAL = 30 * 60 * 1000;            // 30 minutes

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

// ── Init ─────────────────────────────────────────────────────
(function init() {
    renderWatchlist();
    requestNotificationPermission();
    updateNotifButton();
    startAutoRefresh();

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
    const url = `${API_BASE}?access_key=${CONFIG.AVIATION_STACK_KEY}&flight_iata=${encodeURIComponent(flightIata)}`;

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

            // Check for arrival
            if (data) {
                const prev = statuses[iata];
                const curr = data.flight_status;
                if (prev !== 'landed' && curr === 'landed') {
                    fireArrivalNotification(iata, data);
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

    // Then every 30 minutes
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
    if (Notification.permission === 'granted') {
        notifBtn.classList.add('active');
        notifLabel.textContent = 'Alerts On';
    } else if (Notification.permission === 'denied') {
        notifLabel.textContent = 'Alerts Blocked';
    } else {
        notifLabel.textContent = 'Enable Alerts';
    }
}

notifBtn.addEventListener('click', () => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') {
        Notification.requestPermission().then(updateNotifButton);
    }
});

function fireArrivalNotification(iata, f) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const arrival = f.arrival?.airport || 'destination';
    const time = formatTime(f.arrival?.actual || f.arrival?.estimated || f.arrival?.scheduled);

    new Notification(`${iata} has landed`, {
        body: `Arrived at ${arrival}${time !== '—' ? ' at ' + time : ''}.`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="20" font-size="20">✈</text></svg>',
        tag: `flightwatch-${iata}`, // prevents duplicate notifications for same flight
    });
}

// ── Toast ────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
