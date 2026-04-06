/* ═══════════════════════════════════════════════════════════
   Car Service Record — Frontend Logic
   Dependencies: config.js  (loaded first)
                 Google Identity Services (GSI library)
═══════════════════════════════════════════════════════════ */

'use strict';

// ── Checklist Data ──────────────────────────────────────────
const CHECKLIST_DATA = [
  {
    id: 'engine',
    icon: '🔧',
    label: 'Engine & Drivetrain',
    items: [
      'Engine oil & filter change',
      'Air filter inspection/replacement',
      'Cabin air filter inspection/replacement',
      'Spark plugs inspection/replacement',
      'Drive belts inspection (serpentine/accessory belt)',
      'Throttle body cleaning'
    ]
  },
  {
    id: 'hybrid',
    icon: '⚡',
    label: 'Hybrid System',
    items: [
      '12V auxiliary battery check (voltage & condition)',
      'High-voltage (HV) battery health check',
      'Electric motor system diagnostics (OBD scan)',
      'Hybrid cooling system inspection (separate from engine cooling)',
      'Regenerative braking system check',
      'Inverter & power electronics inspection'
    ]
  },
  {
    id: 'brakes',
    icon: '🛞',
    label: 'Brakes & Suspension',
    items: [
      'Brake pads & rotors inspection (wear is slower due to regen braking)',
      'Brake fluid check & replacement (every 2 years)',
      'Brake lines & hoses inspection',
      'Suspension components (shocks, struts, bushings, ball joints)',
      'Wheel bearings check',
      'Steering system inspection'
    ]
  },
  {
    id: 'cooling',
    icon: '🌡️',
    label: 'Cooling & Fluids',
    items: [
      'Engine coolant level & condition',
      'Hybrid system coolant check',
      'Transmission fluid inspection (DCT fluid)',
      'Power steering fluid check',
      'Windshield washer fluid top-up'
    ]
  },
  {
    id: 'charging',
    icon: '🔌',
    label: 'Charging System',
    items: [
      'Charging port & connector inspection',
      'On-board charger functionality check',
      'Charging cable condition'
    ]
  },
  {
    id: 'tires',
    icon: '🚗',
    label: 'Tires & Wheels',
    items: [
      'Tire pressure check & adjust',
      'Tire tread depth measurement',
      'Wheel alignment check',
      'Tire rotation',
      'Wheel balancing'
    ]
  },
  {
    id: 'electrical',
    icon: '💡',
    label: 'Electrical & Safety',
    items: [
      'All lights inspection (headlights, brake, indicators)',
      'Wiper blades condition',
      'Battery terminals cleaning & tightening',
      'OBD-II full diagnostic scan (check for fault codes)',
      'Horn & sensors check (parking sensors, cameras)'
    ]
  },
  {
    id: 'ac',
    icon: '🌬️',
    label: 'AC & Heating',
    items: [
      'AC refrigerant level & performance check',
      'Cabin heater performance (electric heat pump on PHEV)',
      'AC compressor inspection'
    ]
  }
];

// ── State ───────────────────────────────────────────────────
let currentUser = null;

// ═══════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════

window.onload = function () {
  if (!window.CONFIG) {
    console.error('config.js not loaded');
    return;
  }

  // Mechanic link: ?token=xxx&pageId=yyy — skip Google auth
  const params = new URLSearchParams(window.location.search);
  const mechanicToken  = params.get('token');
  const mechanicPageId = params.get('pageId');
  if (mechanicToken && mechanicPageId) {
    showScreen('mechanicScreen');
    loadMechanicForm(mechanicPageId, mechanicToken);
    return;
  }

  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: false
  });

  google.accounts.id.renderButton(
    document.getElementById('googleSignInBtn'),
    { theme: 'outline', size: 'large', text: 'sign_in_with', shape: 'rectangular', width: 280 }
  );
};

function handleCredentialResponse(response) {
  const credential = response.credential;
  const payload    = parseJwt(credential);

  // Store user info immediately so callApi can attach the credential
  currentUser = {
    email:      payload.email,
    name:       payload.name,
    picture:    payload.picture,
    credential: credential
  };

  // Authorisation is enforced server-side; verify before opening the app
  verifyAccess();
}

async function verifyAccess() {
  showLoading(true, 'Verifying access…');
  try {
    const result = await callApi('verifyAccess');
    if (result.success) {
      showApp();
    } else {
      currentUser = null;
      showScreen('deniedScreen');
    }
  } catch (err) {
    currentUser = null;
    showScreen('deniedScreen');
    console.error('Access verification failed:', err);
  } finally {
    showLoading(false);
  }
}

function parseJwt(token) {
  const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(
    atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  ));
}

function showApp() {
  showScreen('appScreen');
  document.getElementById('userAvatar').src = currentUser.picture || '';
  document.getElementById('userName').textContent = currentUser.name || currentUser.email;
  initApp();
}

function signOut() {
  google.accounts.id.disableAutoSelect();
  currentUser = null;
  showScreen('loginScreen');
}

function showScreen(id) {
  ['loginScreen', 'deniedScreen', 'appScreen', 'mechanicScreen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

// ═══════════════════════════════════════════════════════════
// App Init
// ═══════════════════════════════════════════════════════════

function initApp() {
  renderChecklist();
  document.getElementById('serviceDate').value = todayISO();
  switchTab('new-service');
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════
// Tabs
// ═══════════════════════════════════════════════════════════

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.tab-content').forEach(c =>
    c.classList.toggle('active', c.id === `tab-${tab}`)
  );
}

// ═══════════════════════════════════════════════════════════
// Checklist Rendering
// ═══════════════════════════════════════════════════════════

function renderChecklist() {
  const container = document.getElementById('checklistContainer');
  container.innerHTML = CHECKLIST_DATA.map(cat => `
    <div class="checklist-category">
      <h3 class="category-title">
        ${cat.icon} ${cat.label}
        <span class="category-progress" id="prog-${cat.id}">0/${cat.items.length}</span>
      </h3>
      <div class="checklist-items">
        ${cat.items.map((item, i) => `
          <div class="checklist-item" id="row-${cat.id}-${i}">
            <span class="item-text">${escHtml(item)}</span>
            <div class="status-btns">
              <button class="status-btn btn-inspected" id="sinsp-${cat.id}-${i}"
                      onclick="onStatusChange('${cat.id}', ${i}, 'inspected')"
                      title="Mark as Inspected">🔍 Inspected</button>
              <button class="status-btn btn-replaced" id="srepl-${cat.id}-${i}"
                      onclick="onStatusChange('${cat.id}', ${i}, 'replaced')"
                      title="Mark as Replaced">🔧 Replaced</button>
            </div>
            <input type="text"
                   class="item-comment"
                   id="cmt-${cat.id}-${i}"
                   placeholder="Add comment…"
                   aria-label="Comment for ${escHtml(item)}">
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function onStatusChange(catId, idx, newStatus) {
  const current = getRowStatus(catId, idx);
  setRowStatus(catId, idx, current === newStatus ? 'none' : newStatus);
  updateProgress(catId);
}

function getRowStatus(catId, idx) {
  if (document.getElementById(`sinsp-${catId}-${idx}`)?.classList.contains('active')) return 'inspected';
  if (document.getElementById(`srepl-${catId}-${idx}`)?.classList.contains('active')) return 'replaced';
  return 'none';
}

function setRowStatus(catId, idx, status) {
  const row  = document.getElementById(`row-${catId}-${idx}`);
  const insp = document.getElementById(`sinsp-${catId}-${idx}`);
  const repl = document.getElementById(`srepl-${catId}-${idx}`);
  insp?.classList.toggle('active', status === 'inspected');
  repl?.classList.toggle('active', status === 'replaced');
  row?.classList.remove('is-inspected', 'is-replaced');
  if (status !== 'none') row?.classList.add(`is-${status}`);
}

function updateProgress(catId) {
  const cat   = CHECKLIST_DATA.find(c => c.id === catId);
  const total = cat.items.length;
  const done  = cat.items.filter((_, i) => getRowStatus(catId, i) !== 'none').length;
  const el    = document.getElementById(`prog-${catId}`);
  if (!el) return;
  el.textContent = `${done}/${total}`;
  el.className = 'category-progress' +
    (done === total ? ' complete' : done > 0 ? ' partial' : '');
}

function selectAll(state) {
  CHECKLIST_DATA.forEach(cat => {
    cat.items.forEach((_, i) => setRowStatus(cat.id, i, state ? 'inspected' : 'none'));
    updateProgress(cat.id);
  });
}

// ═══════════════════════════════════════════════════════════
// Form — Collect & Validate
// ═══════════════════════════════════════════════════════════

function collectChecklist() {
  const data = {};
  CHECKLIST_DATA.forEach(cat => {
    data[cat.id] = {
      label: cat.label,
      items: {}
    };
    cat.items.forEach((item, i) => {
      data[cat.id].items[item] = {
        status:  getRowStatus(cat.id, i),
        comment: (document.getElementById(`cmt-${cat.id}-${i}`)?.value || '').trim()
      };
    });
  });
  return data;
}

function collectForm() {
  return {
    rego:            fieldVal('rego').toUpperCase(),
    serviceDate:     fieldVal('serviceDate'),
    vehicleMake:     fieldVal('vehicleMake'),
    odometer:        fieldNum('odometer'),
    nextServiceKm:   fieldNum('nextServiceKm'),
    nextServiceDate: fieldVal('nextServiceDate'),
    mechanicName:    fieldVal('mechanicName'),
    mechanicPhone:   fieldVal('mechanicPhone'),
    mechanicEmail:   fieldVal('mechanicEmail'),
    workshopName:    fieldVal('workshopName'),
    workshopAddress: fieldVal('workshopAddress'),
    serviceCost:     fieldNum('serviceCost'),
    generalNotes:    fieldVal('generalNotes'),
    checklist:       collectChecklist()
  };
}

function fieldVal(id) {
  return (document.getElementById(id)?.value || '').trim();
}

function fieldNum(id) {
  const v = fieldVal(id);
  return v ? Number(v) : null;
}

function validateForm(data) {
  if (!data.rego) {
    showToast('Please enter the vehicle registration number', 'error');
    document.getElementById('rego').focus();
    return false;
  }
  if (!data.serviceDate) {
    showToast('Please select the service date', 'error');
    document.getElementById('serviceDate').focus();
    return false;
  }
  return true;
}

function clearForm() {
  ['rego','vehicleMake','mechanicName','mechanicPhone','mechanicEmail',
   'workshopName','workshopAddress','generalNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['odometer','nextServiceKm','serviceCost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('serviceDate').value = todayISO();
  document.getElementById('nextServiceDate').value = '';

  CHECKLIST_DATA.forEach(cat => {
    cat.items.forEach((_, i) => {
      setRowStatus(cat.id, i, 'none');
      const cmt = document.getElementById(`cmt-${cat.id}-${i}`);
      if (cmt) cmt.value = '';
    });
    updateProgress(cat.id);
  });

  showToast('Form cleared', 'info');
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

async function callApi(action, payload = {}) {
  const url = CONFIG.APPS_SCRIPT_URL;
  if (!url || url.includes('YOUR_SCRIPT')) {
    throw new Error('APPS_SCRIPT_URL is not configured in config.js');
  }

  const res = await fetch(url, {
    method: 'POST',
    // text/plain avoids preflight CORS; Apps Script reads e.postData.contents
    body: JSON.stringify({ action, idToken: currentUser.credential, payload })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Public API call — no Google token (mechanic actions use token auth instead)
async function callApiPublic(action, payload = {}) {
  const url = CONFIG.APPS_SCRIPT_URL;
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ action, payload })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════════════════════
// Save
// ═══════════════════════════════════════════════════════════

async function saveRecord() {
  const data = collectForm();
  if (!validateForm(data)) return;

  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  showLoading(true, 'Saving record…');

  try {
    const result = await callApi('saveRecord', data);
    if (result.success) {
      showToast('Service record saved successfully! ✓', 'success');
      clearForm();
    } else {
      showToast('Save failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    showLoading(false);
  }
}

// ═══════════════════════════════════════════════════════════
// History — Search
// ═══════════════════════════════════════════════════════════

async function searchHistory() {
  const rego = (document.getElementById('searchRego')?.value || '').trim().toUpperCase();
  if (!rego) { showToast('Please enter a rego number', 'error'); return; }

  showLoading(true, 'Searching…');
  hideHistoryPanels();

  try {
    const result = await callApi('getHistory', { rego });
    if (result.success) {
      renderHistoryCards(result.records, rego);
    } else {
      showToast('Error: ' + result.error, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function loadAllRegos() {
  showLoading(true, 'Loading vehicles…');
  hideHistoryPanels();

  try {
    const result = await callApi('getAllRegos');
    if (result.success) {
      renderRegoGrid(result.regos);
    } else {
      showToast('Error: ' + result.error, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function renderRegoGrid(regos) {
  const content = document.getElementById('regoListContent');
  if (!regos.length) {
    content.innerHTML = '<p class="empty-state">No vehicles found in the database</p>';
  } else {
    content.innerHTML = regos.map(r =>
      `<div class="rego-chip" onclick="pickRego('${escAttr(r)}')">${escHtml(r)}</div>`
    ).join('');
  }
  show('regoList');
}

function pickRego(rego) {
  document.getElementById('searchRego').value = rego;
  searchHistory();
}

function showRegoList() {
  hideHistoryPanels();
  show('regoList');
}

function renderHistoryCards(records, rego) {
  const list = document.getElementById('historyList');
  const heading = document.getElementById('historyHeading');
  heading.textContent = records.length
    ? `${records.length} record${records.length > 1 ? 's' : ''} for ${rego}`
    : `No records for ${rego}`;

  if (!records.length) {
    list.innerHTML = '<p class="empty-state">No service records found for this vehicle</p>';
  } else {
    list.innerHTML = records.map(r => `
      <div class="history-card" onclick="viewRecord('${escAttr(r.pageId)}')">
        <div class="history-card-top">
          <span class="rego-badge">${escHtml(r.rego)}</span>
          <span class="service-date">${fmtDate(r.serviceDate)}</span>
        </div>
        <div class="history-card-meta">
          ${r.workshopName  ? `<span>🏪 ${escHtml(r.workshopName)}</span>`                            : ''}
          ${r.mechanicName  ? `<span>👨‍🔧 ${escHtml(r.mechanicName)}</span>`                           : ''}
          ${r.vehicleMake   ? `<span>🚗 ${escHtml(r.vehicleMake)}</span>`                             : ''}
          ${r.odometer      ? `<span>📍 ${r.odometer.toLocaleString()} km</span>`                    : ''}
          ${r.serviceCost   ? `<span>💰 $${r.serviceCost.toFixed(2)}</span>`                         : ''}
          ${r.nextServiceKm ? `<span>🔜 Next: ${r.nextServiceKm.toLocaleString()} km</span>`         : ''}
        </div>
        <div class="history-card-footer">View full details →</div>
      </div>
    `).join('');
  }

  show('historyResults');
}

// ═══════════════════════════════════════════════════════════
// History — Record Detail
// ═══════════════════════════════════════════════════════════

async function viewRecord(pageId) {
  showLoading(true, 'Loading record…');

  try {
    const result = await callApi('getRecord', { pageId });
    if (result.success) {
      renderDetail(result.record);
    } else {
      showToast('Error: ' + result.error, 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function renderDetail(rec) {
  hide('historyResults');
  hide('regoList');

  document.getElementById('detailTitle').textContent =
    `${rec.rego} — ${fmtDate(rec.serviceDate)}`;

  const checklistHtml = buildChecklistDetailHtml(rec.checklist);

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-grid">
      <div class="card">
        <h3>🚗 Vehicle &amp; Service</h3>
        ${dRow('Registration',    rec.rego)}
        ${dRow('Service Date',    fmtDate(rec.serviceDate))}
        ${dRow('Vehicle',         rec.vehicleMake)}
        ${dRow('Odometer',        rec.odometer      ? rec.odometer.toLocaleString() + ' km' : '')}
        ${dRow('Next Service',    rec.nextServiceKm ? rec.nextServiceKm.toLocaleString() + ' km' : '')}
        ${dRow('Next Srvc Date',  rec.nextServiceDate ? fmtDate(rec.nextServiceDate) : '')}
        ${dRow('Service Cost',    rec.serviceCost   ? '$' + rec.serviceCost.toFixed(2) : '')}
      </div>
      <div class="card">
        <h3>👨‍🔧 Mechanic &amp; Workshop</h3>
        ${dRow('Mechanic',    rec.mechanicName)}
        ${dRow('Phone',       rec.mechanicPhone)}
        ${dRow('Email',       rec.mechanicEmail)}
        ${dRow('Workshop',    rec.workshopName)}
        ${dRow('Address',     rec.workshopAddress)}
        ${dRow('Recorded By', rec.savedBy)}
        ${rec.mechanicEmail ? `
        <div style="margin-top:1rem;">
          <button class="btn btn-primary" onclick="sendMechanicEmailRequest('${escAttr(rec.pageId)}')">
            📧 Request Service Details
          </button>
        </div>` : ''}
      </div>
    </div>

    ${rec.generalNotes ? `
    <div class="card">
      <h3>📝 General Notes</h3>
      <p class="notes-text">${escHtml(rec.generalNotes)}</p>
    </div>` : ''}

    <div class="card">
      <h3>✅ Service Checklist</h3>
      ${checklistHtml}
    </div>
  `;

  show('recordDetail');
  window.scrollTo({ top: document.getElementById('detailTitle').offsetTop - 90, behavior: 'smooth' });
}

function buildChecklistDetailHtml(checklist) {
  if (!checklist) return '<p class="empty-state">No checklist data available</p>';

  return CHECKLIST_DATA.map(cat => {
    const catData = checklist[cat.id];
    if (!catData) return '';

    const itemsHtml = cat.items.map(item => {
      const d = (catData.items || {})[item] || {};
      // backward-compat: old records used `checked` bool
      const status = d.status || (d.checked ? 'inspected' : 'none');
      const icon   = status === 'replaced'  ? '🔧' :
                     status === 'inspected' ? '🔍' : '⬜';
      const label  = status === 'replaced'  ? 'Replaced' :
                     status === 'inspected' ? 'Inspected' : '';
      return `
        <div class="detail-checklist-item ${status !== 'none' ? 'checked' : ''}">
          <span class="check-icon">${icon}</span>
          <div class="item-content">
            <span class="item-name">${escHtml(item)}</span>
            ${label  ? `<span class="item-status-label status-${status}">${label}</span>` : ''}
            ${d.comment ? `<span class="item-comment-note">${escHtml(d.comment)}</span>` : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="detail-category">
        <h4 class="detail-category-title">${cat.icon} ${cat.label}</h4>
        ${itemsHtml}
      </div>`;
  }).join('');
}

function closeDetail() {
  hide('recordDetail');
  show('historyResults');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════════

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

function hideHistoryPanels() {
  ['regoList', 'historyResults', 'recordDetail'].forEach(hide);
}

function showLoading(visible, msg = 'Loading…') {
  document.getElementById('loadingMsg').textContent = msg;
  document.getElementById('loadingOverlay').classList.toggle('hidden', !visible);
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 4500);
}

function fmtDate(iso) {
  if (!iso) return '';
  // Append time to avoid timezone shift on date-only strings
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function dRow(label, value) {
  if (!value) return '';
  return `
    <div class="detail-row">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${escHtml(String(value))}</span>
    </div>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

// ═══════════════════════════════════════════════════════════
// Send Mechanic Email (owner side)
// ═══════════════════════════════════════════════════════════

async function sendMechanicEmailRequest(pageId) {
  showLoading(true, 'Sending email…');
  try {
    const result = await callApi('sendMechanicEmail', { pageId });
    if (result.success) {
      showToast('Email sent to mechanic ✓', 'success');
    } else {
      showToast('Failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ═══════════════════════════════════════════════════════════
// Mechanic Form (token-based, no Google auth)
// ═══════════════════════════════════════════════════════════

let _mechanicPageId  = null;
let _mechanicToken   = null;

async function loadMechanicForm(pageId, token) {
  _mechanicPageId = pageId;
  _mechanicToken  = token;

  try {
    const result = await callApiPublic('getMechanicForm', { pageId, token });
    if (!result.success) {
      hide('mechanicLoading');
      show('mechanicError');
      return;
    }
    renderMechanicForm(result.record);
  } catch (err) {
    hide('mechanicLoading');
    show('mechanicError');
    console.error('loadMechanicForm error:', err);
  }
}

function renderMechanicForm(rec) {
  hide('mechanicLoading');

  // Summary
  document.getElementById('mechanicSummary').innerHTML = `
    <div class="card" style="margin:0;">
      <h3>🚗 Vehicle &amp; Service</h3>
      ${dRow('Registration', rec.rego)}
      ${dRow('Service Date', fmtDate(rec.serviceDate))}
      ${dRow('Vehicle',      rec.vehicleMake)}
      ${dRow('Odometer',     rec.odometer ? rec.odometer.toLocaleString() + ' km' : '')}
    </div>
    <div class="card" style="margin:0;">
      <h3>👨‍🔧 Mechanic &amp; Workshop</h3>
      ${dRow('Mechanic',  rec.mechanicName)}
      ${dRow('Workshop',  rec.workshopName)}
      ${dRow('Address',   rec.workshopAddress)}
    </div>`;

  // Checklist — pre-fill from existing data
  const container = document.getElementById('mechanicChecklistContainer');
  container.innerHTML = CHECKLIST_DATA.map(cat => {
    const catData = (rec.checklist || {})[cat.id] || { items: {} };
    return `
      <div class="checklist-category">
        <h3 class="category-title">
          ${cat.icon} ${cat.label}
          <span class="category-progress" id="mprog-${cat.id}">0/${cat.items.length}</span>
        </h3>
        <div class="checklist-items">
          ${cat.items.map((item, i) => {
            const d = (catData.items || {})[item] || {};
            const status = d.status || (d.checked ? 'inspected' : 'none');
            return `
              <div class="checklist-item${status !== 'none' ? ' is-'+status : ''}" id="mrow-${cat.id}-${i}">
                <span class="item-text">${escHtml(item)}</span>
                <div class="status-btns">
                  <button class="status-btn btn-inspected${status === 'inspected' ? ' active' : ''}"
                          id="msinsp-${cat.id}-${i}"
                          onclick="onMechanicStatusChange('${cat.id}', ${i}, 'inspected')"
                          title="Mark as Inspected">🔍 Inspected</button>
                  <button class="status-btn btn-replaced${status === 'replaced' ? ' active' : ''}"
                          id="msrepl-${cat.id}-${i}"
                          onclick="onMechanicStatusChange('${cat.id}', ${i}, 'replaced')"
                          title="Mark as Replaced">🔧 Replaced</button>
                </div>
                <input type="text" class="item-comment" id="mcmt-${cat.id}-${i}"
                       placeholder="Add comment…" value="${escHtml(d.comment || '')}">
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }).join('');

  // Pre-fill notes
  document.getElementById('mechanicNotes').value = rec.generalNotes || '';

  // Update progress badges
  CHECKLIST_DATA.forEach(cat => updateMechanicProgress(cat.id));

  show('mechanicForm');
}

function onMechanicStatusChange(catId, idx, newStatus) {
  const current = getMechanicRowStatus(catId, idx);
  setMechanicRowStatus(catId, idx, current === newStatus ? 'none' : newStatus);
  updateMechanicProgress(catId);
}

function getMechanicRowStatus(catId, idx) {
  if (document.getElementById(`msinsp-${catId}-${idx}`)?.classList.contains('active')) return 'inspected';
  if (document.getElementById(`msrepl-${catId}-${idx}`)?.classList.contains('active')) return 'replaced';
  return 'none';
}

function setMechanicRowStatus(catId, idx, status) {
  const row  = document.getElementById(`mrow-${catId}-${idx}`);
  const insp = document.getElementById(`msinsp-${catId}-${idx}`);
  const repl = document.getElementById(`msrepl-${catId}-${idx}`);
  insp?.classList.toggle('active', status === 'inspected');
  repl?.classList.toggle('active', status === 'replaced');
  row?.classList.remove('is-inspected', 'is-replaced');
  if (status !== 'none') row?.classList.add(`is-${status}`);
}

function updateMechanicProgress(catId) {
  const cat  = CHECKLIST_DATA.find(c => c.id === catId);
  const done = cat.items.filter((_, i) => getMechanicRowStatus(catId, i) !== 'none').length;
  const el   = document.getElementById(`mprog-${catId}`);
  if (!el) return;
  el.textContent = `${done}/${cat.items.length}`;
  el.className = 'category-progress' + (done === cat.items.length ? ' complete' : done > 0 ? ' partial' : '');
}

function collectMechanicChecklist() {
  const data = {};
  CHECKLIST_DATA.forEach(cat => {
    data[cat.id] = { label: cat.label, items: {} };
    cat.items.forEach((item, i) => {
      data[cat.id].items[item] = {
        status:  getMechanicRowStatus(cat.id, i),
        comment: (document.getElementById(`mcmt-${cat.id}-${i}`)?.value || '').trim()
      };
    });
  });
  return data;
}

async function submitMechanicDetails() {
  const btn = document.getElementById('mechanicSubmitBtn');
  btn.disabled = true;
  showLoading(true, 'Submitting…');
  try {
    const result = await callApiPublic('submitMechanicUpdate', {
      pageId:       _mechanicPageId,
      token:        _mechanicToken,
      checklist:    collectMechanicChecklist(),
      generalNotes: (document.getElementById('mechanicNotes')?.value || '').trim()
    });
    if (result.success) {
      hide('mechanicForm');
      show('mechanicSuccess');
    } else {
      showToast('Failed: ' + (result.error || 'Unknown error'), 'error');
      btn.disabled = false;
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false;
  } finally {
    showLoading(false);
  }
}
