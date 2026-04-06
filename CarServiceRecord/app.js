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
  const payload = parseJwt(credential);

  if (CONFIG.ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(payload.email.toLowerCase())) {
    currentUser = {
      email:      payload.email,
      name:       payload.name,
      picture:    payload.picture,
      credential: credential
    };
    showApp();
  } else {
    showScreen('deniedScreen');
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
  ['loginScreen', 'deniedScreen', 'appScreen'].forEach(s => {
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
            <label class="checkbox-label">
              <input type="checkbox"
                     id="chk-${cat.id}-${i}"
                     onchange="onCheckChange('${cat.id}', ${i})">
              <span class="item-text">${escHtml(item)}</span>
            </label>
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

function onCheckChange(catId, idx) {
  const row = document.getElementById(`row-${catId}-${idx}`);
  const checked = document.getElementById(`chk-${catId}-${idx}`).checked;
  row.classList.toggle('is-checked', checked);
  updateProgress(catId);
}

function updateProgress(catId) {
  const cat = CHECKLIST_DATA.find(c => c.id === catId);
  const total = cat.items.length;
  const done = cat.items.filter((_, i) =>
    document.getElementById(`chk-${catId}-${i}`)?.checked
  ).length;

  const el = document.getElementById(`prog-${catId}`);
  if (!el) return;
  el.textContent = `${done}/${total}`;
  el.className = 'category-progress' +
    (done === total ? ' complete' : done > 0 ? ' partial' : '');
}

function selectAll(state) {
  CHECKLIST_DATA.forEach(cat => {
    cat.items.forEach((_, i) => {
      const chk = document.getElementById(`chk-${cat.id}-${i}`);
      if (chk) {
        chk.checked = state;
        document.getElementById(`row-${cat.id}-${i}`)?.classList.toggle('is-checked', state);
      }
    });
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
        checked: document.getElementById(`chk-${cat.id}-${i}`)?.checked || false,
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
  ['rego','vehicleMake','mechanicName','mechanicPhone',
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
      const chk = document.getElementById(`chk-${cat.id}-${i}`);
      const cmt = document.getElementById(`cmt-${cat.id}-${i}`);
      const row = document.getElementById(`row-${cat.id}-${i}`);
      if (chk) chk.checked = false;
      if (cmt) cmt.value = '';
      if (row) row.classList.remove('is-checked');
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
        ${dRow('Workshop',    rec.workshopName)}
        ${dRow('Address',     rec.workshopAddress)}
        ${dRow('Recorded By', rec.savedBy)}
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
      const d = (catData.items || {})[item] || { checked: false, comment: '' };
      return `
        <div class="detail-checklist-item ${d.checked ? 'checked' : ''}">
          <span class="check-icon">${d.checked ? '✅' : '⬜'}</span>
          <div class="item-content">
            <span class="item-name">${escHtml(item)}</span>
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
