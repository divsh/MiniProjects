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
    const req    = JSON.parse(e.postData.contents);
    const email  = verifyToken(req.idToken);

    if (!email) return respond({ success: false, error: 'Invalid or expired token' });

    const allowed = prop('ALLOWED_EMAILS').split(',').map(s => s.trim().toLowerCase());
    if (!allowed.includes(email.toLowerCase())) {
      return respond({ success: false, error: 'Unauthorized email: ' + email });
    }

    const payload = req.payload || {};

    switch (req.action) {
      case 'saveRecord': return respond(saveRecord(payload, email));
      case 'getHistory': return respond(getHistory(payload.rego));
      case 'getAllRegos': return respond(getAllRegos());
      case 'getRecord':  return respond(getRecord(payload.pageId));
      default:           return respond({ success: false, error: 'Unknown action: ' + req.action });
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
