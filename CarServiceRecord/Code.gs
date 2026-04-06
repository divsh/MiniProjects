/**
 * Car Service Record — Google Apps Script Backend
 * ─────────────────────────────────────────────────────────
 * Paste this entire file into a new Google Apps Script project.
 *
 * Script Properties to set (Project Settings → Script Properties):
 *   NOTION_TOKEN       — your Notion Internal Integration secret
 *   NOTION_DB_ID       — ID of your Notion service-records database
 *   GOOGLE_CLIENT_ID   — your OAuth Client ID (same as in config.js)
 *   ALLOWED_EMAILS     — comma-separated list, e.g. "a@gmail.com,b@gmail.com"
 *
 * Deploy: Deploy → New Deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * ─────────────────────────────────────────────────────────
 */

// ── Entry points ────────────────────────────────────────────

function doPost(e) {
  try {
    const req     = JSON.parse(e.postData.contents);
    const payload = req.payload || {};

    // ── Mechanic token-based actions (no Google auth required) ──
    if (req.action === 'getMechanicForm') {
      return respond(getMechanicForm(payload.pageId, payload.token));
    }
    if (req.action === 'submitMechanicUpdate') {
      return respond(submitMechanicUpdate(payload.pageId, payload.token, payload));
    }

    // ── All other actions require Google auth ───────────────────
    const email = verifyToken(req.idToken);
    if (!email) return respond({ success: false, error: 'Invalid or expired token' });

    const allowed = prop('ALLOWED_EMAILS').split(',').map(s => s.trim().toLowerCase());
    if (!allowed.includes(email.toLowerCase())) {
      return respond({ success: false, error: 'Unauthorized email: ' + email });
    }

    switch (req.action) {
      case 'verifyAccess':      return respond({ success: true });
      case 'saveRecord':        return respond(saveRecord(payload, email));
      case 'getHistory':        return respond(getHistory(payload.rego));
      case 'getAllRegos':        return respond(getAllRegos());
      case 'getRecord':         return respond(getRecord(payload.pageId));
      case 'sendMechanicEmail': return respond(sendMechanicEmailAction(payload.pageId));
      default:                  return respond({ success: false, error: 'Unknown action: ' + req.action });
  
      }

  } catch (err) {
    console.error('doPost error:', err);
    return respond({ success: false, error: err.toString() });
  }
}

// Simple health-check endpoint
function doGet() {
  return respond({ success: true, message: 'Car Service Record API is online' });
}

// ── Auth ────────────────────────────────────────────────────

function verifyToken(idToken) {
  if (!idToken) return null;
  try {
    const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;

    const data = JSON.parse(res.getContentText());

    // Optionally verify audience matches our client ID
    const clientId = prop('GOOGLE_CLIENT_ID');
    if (clientId && data.aud !== clientId) return null;

    return data.email_verified === 'true' ? data.email : null;
  } catch (e) {
    console.error('Token verification failed:', e);
    return null;
  }
}

// ── Notion Helpers ──────────────────────────────────────────

function prop(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function notionHeaders() {
  return {
    'Authorization':  'Bearer ' + prop('NOTION_TOKEN'),
    'Content-Type':   'application/json',
    'Notion-Version': '2022-06-28'
  };
}

function notionFetch(url, method, body) {
  const opts = { method: method, headers: notionHeaders(), muteHttpExceptions: true };
  if (body) opts.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(url, opts);
  const code = res.getResponseCode();
  const text = res.getContentText();

  if (code >= 400) {
    throw new Error('Notion API ' + code + ': ' + text);
  }
  return JSON.parse(text);
}

/** Split long text into Notion rich_text chunks (max 2000 chars each). */
function notionChunks(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 1999) {
    chunks.push({ type: 'text', text: { content: text.slice(i, i + 1999) } });
  }
  return chunks.length ? chunks : [{ type: 'text', text: { content: '' } }];
}

/** Single rich_text element, capped at 2000 chars. */
function rt(value) {
  if (!value) return [];
  return [{ type: 'text', text: { content: String(value).slice(0, 2000) } }];
}

// ── Save Record ─────────────────────────────────────────────

function saveRecord(rec, savedBy) {
  const dbId = prop('NOTION_DB_ID');
  const rego = (rec.rego || '').toUpperCase().trim();
  const date = rec.serviceDate || Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');

  const properties = {
    'Name':            { title:     [{ text: { content: rego + ' — ' + date } }] },
    'Rego':            { rich_text: rt(rego) },
    'Service Date':    { date:      { start: date } },
    'Mechanic Name':   { rich_text: rt(rec.mechanicName) },
    'Mechanic Phone':  { rich_text: rt(rec.mechanicPhone) },
    'Mechanic Email':  { rich_text: rt(rec.mechanicEmail) },
    'Workshop':        { rich_text: rt(rec.workshopName) },
    'Workshop Address':{ rich_text: rt(rec.workshopAddress) },
    'Vehicle':         { rich_text: rt(rec.vehicleMake) },
    'Recorded By':     { rich_text: rt(savedBy) }
  };

  if (rec.odometer)       properties['Odometer KM']     = { number: parseInt(rec.odometer) };
  if (rec.nextServiceKm)  properties['Next Service KM'] = { number: parseInt(rec.nextServiceKm) };
  if (rec.serviceCost)    properties['Service Cost']    = { number: parseFloat(rec.serviceCost) };
  if (rec.nextServiceDate) properties['Next Service Date'] = { date: { start: rec.nextServiceDate } };

  const checklistJson = JSON.stringify(rec.checklist || {});

  const children = [
    {
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'Service Checklist' } }] }
    },
    {
      object: 'block', type: 'code',
      code: { rich_text: notionChunks(checklistJson), language: 'json' }
    },
    {
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'General Notes' } }] }
    },
    {
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: rt(rec.generalNotes || '') }
    }
  ];

  const result = notionFetch('https://api.notion.com/v1/pages', 'POST', {
    parent:     { database_id: dbId },
    properties: properties,
    children:   children
  });

  return { success: true, pageId: result.id };
}

// ── Get History ─────────────────────────────────────────────

function getHistory(rego) {
  const dbId = prop('NOTION_DB_ID');
  let hasMore = true;
  let cursor  = undefined;
  const records = [];

  while (hasMore) {
    const body = {
      filter: { property: 'Rego', rich_text: { equals: (rego || '').toUpperCase().trim() } },
      sorts:  [{ property: 'Service Date', direction: 'descending' }],
      page_size: 100
    };
    if (cursor) body.start_cursor = cursor;

    const result = notionFetch('https://api.notion.com/v1/databases/' + dbId + '/query', 'POST', body);
    (result.results || []).forEach(p => records.push(extractSummary(p)));

    hasMore = result.has_more;
    cursor  = result.next_cursor;
  }

  return { success: true, records: records };
}

// ── Get All Regos ───────────────────────────────────────────

function getAllRegos() {
  const dbId = prop('NOTION_DB_ID');
  let hasMore = true;
  let cursor  = undefined;
  const regoSet = {};   // use object as set to preserve insert order

  while (hasMore) {
    const body = {
      sorts: [{ property: 'Rego', direction: 'ascending' }],
      page_size: 100
    };
    if (cursor) body.start_cursor = cursor;

    const result = notionFetch('https://api.notion.com/v1/databases/' + dbId + '/query', 'POST', body);

    (result.results || []).forEach(p => {
      const r = (p.properties['Rego'] || {}).rich_text;
      const rego = (r && r[0]) ? r[0].plain_text : '';
      if (rego) regoSet[rego] = true;
    });

    hasMore = result.has_more;
    cursor  = result.next_cursor;

    if (Object.keys(regoSet).length > 1000) break; // safety
  }

  return { success: true, regos: Object.keys(regoSet).sort() };
}

// ── Get Single Record ───────────────────────────────────────

function getRecord(pageId) {
  const page   = notionFetch('https://api.notion.com/v1/pages/' + pageId, 'GET');
  const blocks = notionFetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=50', 'GET');

  let checklist    = null;
  let generalNotes = '';
  let captureNotes = false;

  for (const block of (blocks.results || [])) {
    if (block.type === 'code') {
      try {
        const text = (block.code.rich_text || []).map(t => t.plain_text).join('');
        checklist = JSON.parse(text);
      } catch (e) { /* malformed JSON — skip */ }
    }
    if (block.type === 'heading_2') {
      const hText = (block.heading_2.rich_text || []).map(t => t.plain_text).join('');
      captureNotes = (hText === 'General Notes');
    }
    if (block.type === 'paragraph' && captureNotes) {
      generalNotes = (block.paragraph.rich_text || []).map(t => t.plain_text).join('');
      captureNotes = false;
    }
  }

  return {
    success: true,
    record: Object.assign({}, extractSummary(page), { checklist: checklist, generalNotes: generalNotes })
  };
}

// ── Shared Helpers ──────────────────────────────────────────

function extractSummary(page) {
  const p = page.properties || {};
  function txt(prop)  { return (prop && prop.rich_text  && prop.rich_text[0])  ? prop.rich_text[0].plain_text  : ''; }
  function num(prop)  { return (prop && prop.number  != null)                  ? prop.number                  : null; }
  function dt(prop)   { return (prop && prop.date    && prop.date.start)        ? prop.date.start              : ''; }

  return {
    pageId:         page.id,
    rego:           txt(p['Rego']),
    serviceDate:    dt(p['Service Date']),
    mechanicName:   txt(p['Mechanic Name']),
    mechanicPhone:  txt(p['Mechanic Phone']),
    workshopName:   txt(p['Workshop']),
    workshopAddress:txt(p['Workshop Address']),
    mechanicEmail:  txt(p['Mechanic Email']),
    vehicleMake:    txt(p['Vehicle']),
    odometer:       num(p['Odometer KM']),
    nextServiceKm:  num(p['Next Service KM']),
    nextServiceDate: dt(p['Next Service Date']),
    serviceCost:    num(p['Service Cost']),
    savedBy:        txt(p['Recorded By'])
  };
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Mechanic Email ──────────────────────────────────────────

function sendMechanicEmailAction(pageId) {
  const rec = getRecord(pageId);
  if (!rec.success) return { success: false, error: 'Record not found' };
  const r = rec.record;

  if (!r.mechanicEmail) return { success: false, error: 'No mechanic email address on this record' };

  // Generate one-time token and store it on the Notion page
  const token = Utilities.getUuid();
  notionFetch('https://api.notion.com/v1/pages/' + pageId, 'PATCH', {
    properties: { 'Mechanic Token': { rich_text: rt(token) } }
  });

  const baseUrl = 'https://divsh.github.io/MiniProjects/CarServiceRecord/';
  const formUrl = baseUrl + '?token=' + encodeURIComponent(token) + '&pageId=' + encodeURIComponent(pageId);

  const subject = 'Service Details Request — ' + r.rego + ' (' + (r.serviceDate || '') + ')';
  GmailApp.sendEmail(r.mechanicEmail, subject, 'Please open this email in an HTML-capable client.', {
    htmlBody: buildEmailHtml(r, formUrl),
    name:     'Car Service Record'
  });

  return { success: true };
}

function getMechanicForm(pageId, token) {
  if (!pageId || !token) return { success: false, error: 'Missing pageId or token' };

  const page = notionFetch('https://api.notion.com/v1/pages/' + pageId, 'GET');
  const storedToken = ((page.properties['Mechanic Token'] || {}).rich_text || []);
  const stored = storedToken.length ? storedToken[0].plain_text : '';

  if (!stored || stored !== token) return { success: false, error: 'Invalid or expired link' };

  const blocks = notionFetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=50', 'GET');
  let checklist = null, generalNotes = '', captureNotes = false;

  for (const block of (blocks.results || [])) {
    if (block.type === 'code') {
      try { checklist = JSON.parse((block.code.rich_text || []).map(t => t.plain_text).join('')); } catch (e) {}
    }
    if (block.type === 'heading_2') {
      captureNotes = ((block.heading_2.rich_text || []).map(t => t.plain_text).join('') === 'General Notes');
    }
    if (block.type === 'paragraph' && captureNotes) {
      generalNotes = (block.paragraph.rich_text || []).map(t => t.plain_text).join('');
      captureNotes = false;
    }
  }

  return { success: true, record: Object.assign({}, extractSummary(page), { checklist, generalNotes }) };
}

function submitMechanicUpdate(pageId, token, payload) {
  if (!pageId || !token) return { success: false, error: 'Missing pageId or token' };

  const page = notionFetch('https://api.notion.com/v1/pages/' + pageId, 'GET');
  const storedToken = ((page.properties['Mechanic Token'] || {}).rich_text || []);
  const stored = storedToken.length ? storedToken[0].plain_text : '';

  if (!stored || stored !== token) return { success: false, error: 'Invalid or expired link — already submitted?' };

  // Find child block IDs to update
  const blocks = notionFetch('https://api.notion.com/v1/blocks/' + pageId + '/children?page_size=50', 'GET');
  let checklistBlockId = null, notesBlockId = null, captureNotes = false;

  for (const block of (blocks.results || [])) {
    if (block.type === 'code')     checklistBlockId = block.id;
    if (block.type === 'heading_2') {
      captureNotes = ((block.heading_2.rich_text || []).map(t => t.plain_text).join('') === 'General Notes');
    }
    if (block.type === 'paragraph' && captureNotes) { notesBlockId = block.id; captureNotes = false; }
  }

  const checklistJson = JSON.stringify(payload.checklist || {});
  if (checklistBlockId) {
    notionFetch('https://api.notion.com/v1/blocks/' + checklistBlockId, 'PATCH', {
      code: { rich_text: notionChunks(checklistJson), language: 'json' }
    });
  }
  if (notesBlockId) {
    notionFetch('https://api.notion.com/v1/blocks/' + notesBlockId, 'PATCH', {
      paragraph: { rich_text: rt(payload.generalNotes || '') }
    });
  }

  // Clear token (one-time use)
  notionFetch('https://api.notion.com/v1/pages/' + pageId, 'PATCH', {
    properties: { 'Mechanic Token': { rich_text: rt('') } }
  });

  return { success: true };
}

function buildEmailHtml(rec, formUrl) {
  const checklist = rec.checklist || {};
  let checklistRows = '';

  const CATS = [
    { id: 'engine',     icon: '🔧', label: 'Engine & Drivetrain' },
    { id: 'hybrid',     icon: '⚡', label: 'Hybrid System' },
    { id: 'brakes',     icon: '🛞', label: 'Brakes & Suspension' },
    { id: 'cooling',    icon: '🌡️', label: 'Cooling & Fluids' },
    { id: 'charging',   icon: '🔌', label: 'Charging System' },
    { id: 'tires',      icon: '🚗', label: 'Tires & Wheels' },
    { id: 'electrical', icon: '💡', label: 'Electrical & Safety' },
    { id: 'ac',         icon: '🌬️', label: 'AC & Heating' }
  ];

  CATS.forEach(function(cat) {
    const catData = checklist[cat.id] || { items: {} };
    let itemRows = '';
    Object.keys(catData.items || {}).forEach(function(itemName) {
      const d = catData.items[itemName] || {};
      const status = d.status || (d.checked ? 'inspected' : 'none');
      const icon   = status === 'replaced'  ? '🔧' : status === 'inspected' ? '🔍' : '⬜';
      const badge  = status === 'replaced'
        ? '<span style="font-size:11px;padding:1px 6px;border-radius:4px;background:#F0FDF4;color:#16A34A;font-weight:600;margin-left:6px;">Replaced</span>'
        : status === 'inspected'
        ? '<span style="font-size:11px;padding:1px 6px;border-radius:4px;background:#EFF6FF;color:#2563EB;font-weight:600;margin-left:6px;">Inspected</span>'
        : '';
      const comment = d.comment ? '<br><span style="color:#64748B;font-size:12px;">💬 ' + d.comment + '</span>' : '';
      itemRows += '<tr><td style="padding:6px 8px;border-bottom:1px solid #F1F5F9;font-size:14px;">' +
                  icon + ' ' + itemName + badge + comment + '</td></tr>';
    });
    if (itemRows) {
      checklistRows += '<tr><td style="padding:10px 8px 4px;font-weight:600;font-size:13px;color:#2563EB;background:#EFF6FF;">' +
                       cat.icon + ' ' + cat.label + '</td></tr>' + itemRows;
    }
  });

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#F1F5F9;font-family:Arial,sans-serif;">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:32px 0;">' +
  '<tr><td align="center">' +
  '<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.1);">' +

  // Header
  '<tr><td style="background:linear-gradient(135deg,#1E3A5F,#2563EB);padding:28px 32px;text-align:center;">' +
  '<h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">🔧 Service Details Request</h1>' +
  '<p style="color:#BFDBFE;margin:6px 0 0;font-size:14px;">Please fill in the service checklist for the following vehicle</p>' +
  '</td></tr>' +

  // Vehicle summary
  '<tr><td style="padding:24px 32px;">' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:8px;padding:16px;margin-bottom:24px;">' +
  '<tr><td style="padding:4px 8px;font-size:14px;color:#475569;"><strong>Rego:</strong> ' + (rec.rego || '') + '</td>' +
  '<td style="padding:4px 8px;font-size:14px;color:#475569;"><strong>Date:</strong> ' + (rec.serviceDate || '') + '</td></tr>' +
  '<tr><td style="padding:4px 8px;font-size:14px;color:#475569;"><strong>Vehicle:</strong> ' + (rec.vehicleMake || '') + '</td>' +
  '<td style="padding:4px 8px;font-size:14px;color:#475569;"><strong>Workshop:</strong> ' + (rec.workshopName || '') + '</td></tr>' +
  '</table>' +

  // CTA button
  '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;">' +
  '<a href="' + formUrl + '" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:.3px;">📝 Fill in Service Details</a>' +
  '</td></tr></table>' +
  '<p style="text-align:center;color:#94A3B8;font-size:12px;margin-bottom:24px;">Or copy this link into your browser:<br><span style="color:#2563EB;">' + formUrl + '</span></p>' +

  // Checklist snapshot
  '<h3 style="color:#0F172A;font-size:16px;margin:0 0 12px;">Current Checklist Status</h3>' +
  '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">' +
  checklistRows +
  '</table>' +

  (rec.generalNotes ? '<div style="margin-top:20px;padding:16px;background:#FFFBEB;border-radius:8px;border-left:4px solid #D97706;">' +
  '<strong style="font-size:13px;">Notes:</strong><p style="margin:6px 0 0;font-size:13px;color:#475569;">' + rec.generalNotes + '</p></div>' : '') +

  '</td></tr>' +

  // Footer
  '<tr><td style="padding:20px 32px;text-align:center;background:#F8FAFC;border-top:1px solid #E2E8F0;">' +
  '<p style="color:#94A3B8;font-size:12px;margin:0;">This link can only be used once. Sent by Car Service Record.</p>' +
  '</td></tr>' +

  '</table></td></tr></table></body></html>';
}
