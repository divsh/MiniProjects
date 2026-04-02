/* ── Configuration ───────────────────────────────────────────────────────────
   Fill in both constants before deploying.

   APPS_SCRIPT_URL  — from Apps Script: Deploy → New deployment → Web app URL
   GOOGLE_CLIENT_ID — from Google Cloud Console: APIs & Services → Credentials
                      → OAuth 2.0 Client ID (type: Web application)
   ──────────────────────────────────────────────────────────────────────────── */
const APPS_SCRIPT_URL  = "https://script.google.com/macros/s/AKfycbxdLZbpwKm-qC5n4lXHOLbdYwHQxtteJFMuM-BmK1u7zhhaWpWzf9eg97B7H3t6d4aHFg/exec";
const GOOGLE_CLIENT_ID = "337027910929-fa9puqk832t4ut11gtrn0vahk53nog8p.apps.googleusercontent.com";

/* ── State ───────────────────────────────────────────────────────────────── */
let allAccounts      = [];
let allTransactions  = [];   // full cache — filtered client-side, no per-account fetch
let currentAccount   = null;
let idToken          = null;   // Google ID token, refreshed on each sign-in

/* ── Auth ─────────────────────────────────────────────────────────────────── */

function initAuth() {
  // Restore token from session (survives page refresh within tab)
  const stored = sessionStorage.getItem("id_token");
  if (stored) {
    idToken = stored;
    showApp(sessionStorage.getItem("user_email") || "");
    return;
  }

  // Render the Google Sign-In button
  google.accounts.id.initialize({
    client_id:         GOOGLE_CLIENT_ID,
    callback:          onSignIn,
    auto_select:       false,
    cancel_on_tap_outside: false,
  });

  document.getElementById("g_id_signin").style.display = "block";
  document.querySelector(".auth-box p").textContent    = "Sign in with your Google account to continue.";
  document.querySelector(".auth-box p").style.display  = "block";
  google.accounts.id.renderButton(
    document.getElementById("g_id_signin"),
    { theme: "outline", size: "large", text: "sign_in_with" }
  );
}

function onSignIn(response) {
  idToken = response.credential;

  // Decode email from JWT payload (no verification needed here — server verifies)
  const payload = JSON.parse(atob(idToken.split(".")[1]));
  const email   = payload.email || "";

  sessionStorage.setItem("id_token", idToken);
  sessionStorage.setItem("user_email", email);

  showApp(email);
}

function showApp(email) {
  // Keep overlay visible with a loading message until the first API call succeeds
  document.getElementById("auth-overlay").style.display = "flex";
  document.getElementById("g_id_signin").style.display  = "none";
  document.querySelector(".auth-box p").textContent     = "Verifying access…";

  loadAll().then(authorised => {
    if (!authorised) return; // access denied — overlay already updated
    document.getElementById("auth-overlay").style.display = "none";
    document.getElementById("app").style.display          = "block";
    document.getElementById("user-email").textContent     = email;
    loadPaymentMethods();
  });
}

function signOut() {
  sessionStorage.clear();
  idToken        = null;
  allAccounts    = [];
  currentAccount = null;

  google.accounts.id.disableAutoSelect();

  document.getElementById("app").style.display          = "none";
  document.getElementById("auth-overlay").style.display = "flex";
  document.getElementById("auth-error").style.display   = "none";

  // Re-render button
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback:  onSignIn,
  });
  google.accounts.id.renderButton(
    document.getElementById("g_id_signin"),
    { theme: "outline", size: "large", text: "sign_in_with" }
  );
}

/* ── API fetch (always includes token) ──────────────────────────────────────── */

async function apiFetch(params) {
  if (!idToken) throw new Error("Not signed in");

  const url = APPS_SCRIPT_URL + "?" + new URLSearchParams({ ...params, token: idToken }).toString();
  const res  = await fetch(url);
  const data = await res.json();

  if (data.error) {
    if (data.error.includes("Access denied")) {
      sessionStorage.clear();
      idToken = null;
      document.getElementById("app").style.display          = "none";
      document.getElementById("auth-overlay").style.display = "flex";
      document.getElementById("g_id_signin").style.display  = "none";
      const p = document.querySelector(".auth-box p");
      if (p) p.style.display = "none";
      showAuthError("⛔ Access denied. Your account is not authorised to use this app.");
    } else if (data.error.includes("expired") || data.error.includes("Invalid or expired")) {
      sessionStorage.clear();
      idToken = null;
      showAuthError("Your session expired. Please sign in again.");
      document.getElementById("app").style.display          = "none";
      document.getElementById("auth-overlay").style.display = "flex";
    }
    throw new Error(data.error);
  }

  return data;
}

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent  = msg;
  el.style.display = "block";
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmtAmount(val, currency) {
  if (val === null || val === undefined) return "—";
  const prefix = currency ? currency + " " : "";
  const abs = Math.abs(val).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return val < 0 ? `(${prefix}${abs})` : `${prefix}${abs}`;
}

function amountClass(val) {
  if (!val && val !== 0) return "";
  return val > 0 ? "amount-positive" : val < 0 ? "amount-negative" : "";
}

function balanceClass(val) {
  if (val === null || val === undefined) return "";
  if (val > 0) return "balance-positive";
  if (val < 0) return "balance-negative";
  return "balance-zero";
}

function escHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Account name helpers ───────────────────────────────────────────────────── */

const CURRENCY_RE = /^(.+?)\s*\(([A-Z]{3})\)\s*$/i;

// Parse raw input into {name, currency} or null if format invalid
function parseAccountInput(raw) {
  const m = raw.trim().match(CURRENCY_RE);
  if (!m) return null;
  return { name: m[1].trim(), currency: m[2].toUpperCase() };
}

// Convert a name string to camelCase (no spaces): "john smith" → "johnSmith"
function toCamelCase(str) {
  return str.trim().split(/\s+/).map((w, i) =>
    i === 0
      ? w.charAt(0).toLowerCase() + w.slice(1).toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join("");
}

// Format a new account name in canonical form: camelCase name + uppercase currency
function formatNewAccount(raw) {
  const parts = parseAccountInput(raw);
  if (!parts) return null;
  return `${toCamelCase(parts.name)} (${parts.currency})`;
}

// Case-insensitive match against existing accounts
function findAccount(raw) {
  const lower = raw.trim().toLowerCase();
  return allAccounts.find(a => a.account.toLowerCase() === lower) || null;
}

/* ── Account field helpers ──────────────────────────────────────────────────── */

function setAccountSelection(name) {
  document.getElementById("form-account-input").value = name;
  onAccountChange(name);
  localStorage.setItem("lastAccount", name);
}

/* ── Load accounts ──────────────────────────────────────────────────────────── */

// Fetch accounts + all transactions in parallel — single load, no per-account round trip
async function loadAll() {
  try {
    [allAccounts, allTransactions] = await Promise.all([
      apiFetch({ action: "accounts" }),
      apiFetch({ action: "transactions" }),
    ]);
    populateAccountList();
    restoreLastAccount();
    return true;
  } catch (e) {
    if (!e.message.includes("Access denied")) {
      showError("Failed to load data: " + e.message);
    }
    return false;
  }
}

const ALL_ACCOUNTS = "All Accounts";

function populateAccountList() {
  const dl = document.getElementById("account-list");
  dl.innerHTML = `<option value="${ALL_ACCOUNTS}">` +
    allAccounts.map(a => `<option value="${escHtml(a.account)}">`).join("");
}

function restoreLastAccount() {
  const saved = localStorage.getItem("lastAccount");
  if (!saved) return;
  const match = allAccounts.find(a => a.account.toLowerCase() === saved.toLowerCase());
  if (match && match.account !== currentAccount) {
    setAccountSelection(match.account);
  }
}

/* ── Show transactions (client-side filter, no network call) ────────────────── */

function showTransactions(account) {
  const txns = account
    ? allTransactions.filter(t => t.account === account)
    : allTransactions;
  renderTable(txns);
  renderBalance();
}

function renderTable(txns) {
  txns = [...txns].sort((a, b) =>
    (b.entry_date || "").localeCompare(a.entry_date || "") ||
    (b.trans_date || "").localeCompare(a.trans_date || "")
  );
  const tbody    = document.getElementById("txn-body");
  const currency = currentAccountInfo()?.currency || "";
  document.getElementById("txn-count").textContent =
    `${txns.length} transaction${txns.length !== 1 ? "s" : ""}`;

  if (!txns.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="no-data">No transactions found for this account.</td></tr>`;
    return;
  }

  tbody.innerHTML = txns.map(t => `
    <tr>
      <td data-label="Entry Date">${escHtml(t.entry_date) || "—"}</td>
      <td data-label="Trans. Date">${escHtml(t.trans_date) || "—"}</td>
      <td data-label="Amount" class="${amountClass(t.amount)}">${fmtAmount(t.amount, currency)}</td>
      <td data-label="Purpose" class="purpose">${escHtml(t.purpose) || "—"}</td>
      <td data-label="Payment">${escHtml(t.payment_method) || "—"}</td>
      <td data-label="From / To">${escHtml(t.sent_from_to) || "—"}</td>
      <td data-label="Balance" class="${balanceClass(t.balance)}">${fmtAmount(t.balance, currency)}</td>
    </tr>
  `).join("");
}

function renderBalance() {
  const info = currentAccountInfo();
  const card = document.getElementById("balance-card");
  if (!info) { card.style.display = "none"; return; }

  const cls = balanceClass(info.balance);
  card.style.display = "flex";
  document.getElementById("balance-account-name").textContent = info.account;
  const el = document.getElementById("balance-value");
  el.innerHTML   = "";
  el.textContent = fmtAmount(info.balance, info.currency);
  el.className   = `balance-value ${cls}`;
}

function currentAccountInfo() {
  return allAccounts.find(a => a.account === currentAccount) || null;
}

/* ── Account change ─────────────────────────────────────────────────────────── */

function onAccountChange(account) {
  currentAccount = account || null;
  localStorage.setItem("lastAccount", account || "");

  const summarySection = document.getElementById("summary-section");
  const tableSection   = document.getElementById("table-section");
  const balanceCard    = document.getElementById("balance-card");

  if (account === ALL_ACCOUNTS) {
    tableSection.style.display   = "none";
    summarySection.style.display = "block";
    balanceCard.style.display    = "flex";
    document.getElementById("balance-account-name").textContent = "All Accounts";
    const byCurrency = {};
    allAccounts.forEach(a => {
      const cur = a.currency || "?";
      byCurrency[cur] = (byCurrency[cur] || 0) + (a.balance || 0);
    });
    const balEl = document.getElementById("balance-value");
    balEl.className = "balance-value";
    balEl.innerHTML = Object.entries(byCurrency).map(([cur, total]) =>
      `<div class="${balanceClass(total)}">${fmtAmount(total, cur)}</div>`
    ).join("");
    renderAccountsSummary();
    return;
  }

  summarySection.style.display = "none";
  tableSection.style.display   = "block";

  if (!account) {
    balanceCard.style.display = "none";
    document.getElementById("txn-body").innerHTML =
      `<tr><td colspan="7" class="no-data">Select an account to view transactions.</td></tr>`;
    document.getElementById("txn-count").textContent = "";
    return;
  }

  showTransactions(account);
}

function renderAccountsSummary() {
  const tbody = document.getElementById("summary-body");
  document.getElementById("summary-count").textContent =
    `${allAccounts.length} account${allAccounts.length !== 1 ? "s" : ""}`;

  if (!allAccounts.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="no-data">No accounts found.</td></tr>`;
    return;
  }

  tbody.innerHTML = allAccounts.map(a => `
    <tr>
      <td>${escHtml(a.account)}</td>
      <td style="text-align:right;" class="${balanceClass(a.balance)}">
        ${fmtAmount(a.balance, a.currency)}
      </td>
    </tr>
  `).join("");
}

/* ── Payment methods ────────────────────────────────────────────────────────── */

async function loadPaymentMethods() {
  try {
    const methods = await apiFetch({ action: "payment-methods" });
    const dl = document.getElementById("payment-methods-list");
    dl.innerHTML = methods.map(m => `<option value="${escHtml(m)}">`).join("");
  } catch (_) { /* not critical */ }
}

/* ── Form submission ────────────────────────────────────────────────────────── */

async function submitTransaction(e) {
  e.preventDefault();
  const btn      = document.getElementById("save-btn");
  const statusEl = document.getElementById("form-status");

  const rawAccount = document.getElementById("form-account-input").value.trim();

  // Resolve account: exact match (case-insensitive) or new name in valid format
  let resolvedAccount = "";
  if (rawAccount) {
    const existing = findAccount(rawAccount);
    if (existing) {
      resolvedAccount = existing.account;
    } else {
      const canonical = formatNewAccount(rawAccount);
      if (!canonical) {
        showFormStatus('Account must include a currency code, e.g. "johnSmith (NZD)"', "error");
        return;
      }
      resolvedAccount = canonical;
    }
  }

  document.getElementById("ac-hint").textContent = "";

  const payload = {
    account:         resolvedAccount,
    trans_date:      document.getElementById("form-trans-date").value.trim(),
    amount:          document.getElementById("form-amount").value.trim(),
    purpose:         document.getElementById("form-purpose").value.trim(),
    sent_from_to:    document.getElementById("form-from-to").value.trim(),
    payment_method:  document.getElementById("form-payment").value.trim(),
  };

  if (!payload.account) { showFormStatus("Please select or create an account.", "error"); return; }
  if (!payload.amount)  { showFormStatus("Amount is required.", "error"); return; }

  btn.disabled    = true;
  btn.textContent = "Saving…";
  statusEl.textContent = "";

  try {
    const encoded = btoa(
      new TextEncoder().encode(JSON.stringify(payload))
        .reduce((s, b) => s + String.fromCharCode(b), "")
    );
    await apiFetch({ action: "add", data: encoded });

    showFormStatus("Saved!", "success");
    document.getElementById("txn-form").reset();
    document.getElementById("ac-hint").textContent = "";

    await loadAll();   // refresh cache after save
    setAccountSelection(payload.account);
    showTransactions(payload.account);
    renderBalance();

  } catch (err) {
    showFormStatus("Error: " + err.message, "error");
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save Transaction";
  }
}

function showFormStatus(msg, type) {
  const el = document.getElementById("form-status");
  el.textContent = msg;
  el.className   = "status-msg " + type;
}

function showError(msg) {
  const el = document.getElementById("global-error");
  el.textContent    = msg;
  el.style.display  = "block";
}

/* ── Init ───────────────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  if (APPS_SCRIPT_URL === "PASTE_YOUR_APPS_SCRIPT_URL_HERE" ||
      GOOGLE_CLIENT_ID === "PASTE_YOUR_GOOGLE_CLIENT_ID_HERE") {
    document.getElementById("auth-overlay").innerHTML =
      `<div class="auth-box"><h1>Ledger</h1>
       <p class="auth-error">Configuration missing — set APPS_SCRIPT_URL and GOOGLE_CLIENT_ID in app.js</p></div>`;
    return;
  }

  document.getElementById("sign-out-btn").addEventListener("click", signOut);

  const acInput = document.getElementById("form-account-input");
  const acHint  = document.getElementById("ac-hint");

  acInput.addEventListener("input", () => {
    const val = acInput.value.trim();
    acHint.className   = "field-hint";
    acHint.textContent = "";

    if (!val || val === ALL_ACCOUNTS || findAccount(val)) return;

    const canonical = formatNewAccount(val);
    if (canonical) {
      acHint.className   = "field-hint hint-create";
      acHint.textContent = `New ledger will be created: "${canonical}"`;
    } else if (val.length > 2) {
      acHint.className   = "field-hint hint-error";
      acHint.textContent = `Include a currency code, e.g. "johnSmith (NZD)"`;
    }
  });

  acInput.addEventListener("change", e => {
    const val = e.target.value.trim();
    if (val === ALL_ACCOUNTS) { setAccountSelection(ALL_ACCOUNTS); return; }
    const match = findAccount(val);
    if (match) { acHint.textContent = ""; setAccountSelection(match.account); }
  });

  document.getElementById("txn-form").addEventListener("submit", submitTransaction);

  // GIS may not be loaded yet (async script), so wait for it
  const ready = () => typeof google !== "undefined" && google.accounts
    ? initAuth()
    : setTimeout(ready, 50);
  ready();
});
