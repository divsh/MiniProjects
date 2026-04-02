// ── Script Properties required ────────────────────────────────────────────────
// Set in Apps Script: Extensions → Apps Script → Project Settings → Script Properties
//   SPREADSHEET_ID  = (your spreadsheet ID from the URL)
//   SHEET_NAME      = Common Ledger
//   GOOGLE_CLIENT_ID = (OAuth 2.0 Client ID from Google Cloud Console)
//   ALLOWED_EMAILS  = user1@gmail.com,user2@gmail.com   (comma-separated)

function getConfig() {
  const props = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: props.getProperty('SPREADSHEET_ID'),
    sheetName:     props.getProperty('SHEET_NAME') || 'Sheet1',
    clientId:      props.getProperty('GOOGLE_CLIENT_ID'),
    allowedEmails: (props.getProperty('ALLOWED_EMAILS') || '')
                     .split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(idToken) {
  if (!idToken) throw new Error('No token provided');

  const cfg = getConfig();

  // Verify token with Google and get claims
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );

  if (res.getResponseCode() !== 200) throw new Error('Invalid or expired token — please sign in again');

  const info = JSON.parse(res.getContentText());

  if (info.error_description) throw new Error('Token error: ' + info.error_description);

  // Confirm the token was issued for our app
  if (cfg.clientId && info.aud !== cfg.clientId) throw new Error('Token audience mismatch');

  const email = (info.email || '').toLowerCase();
  if (!email) throw new Error('Could not determine email from token');

  if (cfg.allowedEmails.length && !cfg.allowedEmails.includes(email)) {
    throw new Error('Access denied: ' + email + ' is not authorised');
  }

  return email;
}

// ── Entry points ──────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    // Every request must carry a valid Google ID token
    checkAuth(e.parameter.token || '');

    const action = (e.parameter.action || '').trim();
    if (action === 'accounts')        return jsonOk(getAccounts());
    if (action === 'transactions')    return jsonOk(getTransactions(e.parameter.account || ''));
    if (action === 'payment-methods') return jsonOk(getPaymentMethods());
    if (action === 'add')             return jsonOk(addTransaction(JSON.parse(Utilities.newBlob(Utilities.base64Decode(e.parameter.data)).getDataAsString())));
    return jsonErr('Unknown action');
  } catch (err) {
    return jsonErr(err.message);
  }
}

function jsonOk(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonErr(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function getSheet() {
  const cfg = getConfig();
  const ss  = SpreadsheetApp.openById(cfg.spreadsheetId);
  return ss.getSheetByName(cfg.sheetName);
}

function getAllRows() {
  const sheet = getSheet();
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  return data.slice(1)
    .map(row => ({
      account:        String(row[0] || '').trim(),
      entry_date:     formatDate(row[1]),
      trans_date:     formatDate(row[2]),
      amount:         parseAmount(row[3]),
      purpose:        String(row[4] || '').trim(),
      sent_from_to:   String(row[5] || '').trim(),
      payment_method: String(row[6] || '').trim(),
      balance:        parseAmount(row[7]),
    }))
    .filter(r => r.account);
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(val).trim();
}

function parseAmount(val) {
  if (val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (!s) return null;
  const negative = s.startsWith('(') && s.endsWith(')');
  const clean = s.replace(/[()\$,]/g, '');
  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

function parseCurrency(accountStr) {
  const m = accountStr.match(/\(([A-Z]{3})\)\s*$/);
  return m ? m[1] : '';
}

// ── API handlers ──────────────────────────────────────────────────────────────

function getAccounts() {
  const rows = getAllRows();
  const map  = {};
  rows.forEach(r => {
    map[r.account] = {
      account:  r.account,
      currency: parseCurrency(r.account),
      balance:  r.balance,
    };
  });
  return Object.values(map);
}

function getTransactions(account) {
  const rows = getAllRows();
  return account ? rows.filter(r => r.account === account) : rows;
}

function getPaymentMethods() {
  const rows    = getAllRows();
  const methods = [...new Set(rows.map(r => r.payment_method).filter(Boolean))].sort();
  return methods;
}

function addTransaction(data) {
  const account        = String(data.account        || '').trim();
  const trans_date     = String(data.trans_date      || '').trim();
  const amount         = String(data.amount          || '').trim();
  const purpose        = String(data.purpose         || '').trim();
  const sent_from_to   = String(data.sent_from_to    || '').trim();
  const payment_method = String(data.payment_method  || '').trim();

  if (!account || !amount) throw new Error('account and amount are required');

  const entry_date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Append columns A–G only; column H (Balance) is formula-driven — do not overwrite
  getSheet().appendRow([account, entry_date, trans_date, amount, purpose, sent_from_to, payment_method]);

  return { ok: true, entry_date };
}
