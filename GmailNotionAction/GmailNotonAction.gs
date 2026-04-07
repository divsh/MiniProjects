// ============================================================
//  Gmail → Notion Daily Email Actions  (v2 — learns from you)
//  Paste this into Google Apps Script (script.google.com)
//  Schedule a daily time-based trigger on runDailyEmailActions()
// ============================================================

// ── CONFIGURATION ────────────────────────────────────────────
const CONFIG = {
  ANTHROPIC_API_KEY:  "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",   // https://console.anthropic.com
  NOTION_API_KEY:     "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",       // https://www.notion.so/my-integrations
  NOTION_DATABASE_ID: "b35a8de604d94bb69628e2b2ea712887",
  LOOKBACK_DAYS:      7,
  MAX_EMAILS:         25,
  HISTORY_LIMIT:      30,   // max past actions to send to Claude as context
};
// ─────────────────────────────────────────────────────────────


// ── MAIN ENTRY POINT ─────────────────────────────────────────
function runDailyEmailActions() {
  log("=== Gmail → Notion run started ===");

  try {
    // 1. Fetch past completed actions (with Action Taken filled in)
    const actionHistory = fetchCompletedActions();
    log(`Loaded ${actionHistory.length} completed past actions as learning context`);

    // 2. Fetch recent emails
    const emails = fetchRecentEmails();
    log(`Fetched ${emails.length} emails from last ${CONFIG.LOOKBACK_DAYS} days`);

    // 3. Filter out already-logged emails using Gmail Message ID
    const existingIds = fetchExistingGmailIds();
    log(`Found ${existingIds.size} existing records in Notion`);

    const newEmails = emails.filter(e => !existingIds.has(e.id));
    log(`${newEmails.length} new emails to process`);

    if (newEmails.length === 0) {
      log("Nothing new to add. Done.");
      return;
    }

    // 4. Ask Claude to analyse emails, informed by past actions
    const actions = analyseEmailsWithClaude(newEmails, actionHistory);
    log(`Claude identified ${actions.length} action items`);

    if (actions.length === 0) {
      log("No actionable items found. Done.");
      return;
    }

    // 5. Insert into Notion
    const added = insertActionsToNotion(actions);
    log(`Inserted ${added} records into Notion`);
    log("=== Run complete ===");

  } catch (err) {
    log(`ERROR: ${err.message}`);
    throw err;
  }
}


// ── 1. FETCH COMPLETED PAST ACTIONS ──────────────────────────
// Reads records where "Action Taken" has been filled in.
// These teach Claude what kinds of emails you act on and how.
function fetchCompletedActions() {
  const history = [];
  let cursor    = undefined;
  let hasMore   = true;

  while (hasMore && history.length < CONFIG.HISTORY_LIMIT) {
    const body = {
      page_size: 50,
      filter: {
        property: "Action Taken",
        rich_text: { is_not_empty: true }
      },
      sorts: [{ timestamp: "created_time", direction: "descending" }]
    };
    if (cursor) body.start_cursor = cursor;

    const res  = notionRequest("POST", `/databases/${CONFIG.NOTION_DATABASE_ID}/query`, body);
    const data = JSON.parse(res);

    for (const page of data.results) {
      const props = page.properties;
      history.push({
        subject:      props["Subject"]?.rich_text?.[0]?.plain_text      || "",
        from:         props["From"]?.rich_text?.[0]?.plain_text          || "",
        type:         props["Type"]?.select?.name                        || "",
        action:       props["Action"]?.title?.[0]?.plain_text            || "",
        action_taken: props["Action Taken"]?.rich_text?.[0]?.plain_text  || "",
        priority:     props["Priority"]?.select?.name                    || "",
      });
      if (history.length >= CONFIG.HISTORY_LIMIT) break;
    }

    hasMore = data.has_more;
    cursor  = data.next_cursor;
  }

  return history;
}


// ── 2. FETCH EMAILS FROM GMAIL ────────────────────────────────
function fetchRecentEmails() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CONFIG.LOOKBACK_DAYS);

  const y = cutoff.getFullYear();
  const m = String(cutoff.getMonth() + 1).padStart(2, "0");
  const d = String(cutoff.getDate()).padStart(2, "0");
  const query = `after:${y}/${m}/${d} -category:promotions -category:social`;

  const threads = GmailApp.search(query, 0, CONFIG.MAX_EMAILS);
  const emails  = [];

  for (const thread of threads) {
    const msg = thread.getMessages()[thread.getMessageCount() - 1];
    emails.push({
      id:      msg.getId(),
      subject: msg.getSubject() || "(no subject)",
      from:    msg.getFrom(),
      date:    msg.getDate().toISOString().split("T")[0],
      snippet: msg.getPlainBody().substring(0, 800).replace(/\s+/g, " ").trim(),
    });
  }

  return emails;
}


// ── 3. FETCH EXISTING GMAIL IDS FROM NOTION ──────────────────
function fetchExistingGmailIds() {
  const ids   = new Set();
  let cursor  = undefined;
  let hasMore = true;

  while (hasMore) {
    const body = {
      page_size: 100,
      filter: { property: "Gmail Message ID", rich_text: { is_not_empty: true } }
    };
    if (cursor) body.start_cursor = cursor;

    const res  = notionRequest("POST", `/databases/${CONFIG.NOTION_DATABASE_ID}/query`, body);
    const data = JSON.parse(res);

    for (const page of data.results) {
      const gmailId = page.properties["Gmail Message ID"]?.rich_text?.[0]?.plain_text;
      if (gmailId) ids.add(gmailId);
    }

    hasMore = data.has_more;
    cursor  = data.next_cursor;
  }

  return ids;
}


// ── 4. ANALYSE EMAILS WITH CLAUDE ────────────────────────────
// Passes your past "Action Taken" history so Claude learns your
// preferences — e.g. if you always ignore certain senders, or
// always reply to certain types of email, it mirrors that pattern.
function analyseEmailsWithClaude(emails, actionHistory) {

  const historyBlock = actionHistory.length > 0
    ? actionHistory.map(h =>
        `- From: ${h.from} | Subject: "${h.subject}" | Type: ${h.type} | Priority: ${h.priority}\n  Suggested action: ${h.action}\n  What you actually did: "${h.action_taken}"`
      ).join("\n\n")
    : "No history yet — use your best judgement.";

  const emailList = emails.map((e, i) =>
    `[${i + 1}] ID:${e.id} | Date:${e.date} | From:${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`
  ).join("\n\n---\n\n");

  const prompt = `You are an intelligent email action extractor. Your job is to decide which emails require action and what that action should be.

## Learning context — what this person has actually done with past emails:
Use this to calibrate your judgement. If they consistently ignore a type of email, skip it.
If they always take a specific action for a sender, match that pattern and priority.

${historyBlock}

## Instructions:
Analyse the new emails below and return a JSON array of action items.
- Only include emails that genuinely require action, informed by content AND past behaviour above.
- Skip anything the history shows they consistently ignore or mark as not actionable.
- For familiar senders or patterns, mirror the priority and action style from history.
- Skip newsletters, promotions, and automated notifications with no real action required.

For each actionable email return an object with exactly these fields:
{
  "gmail_message_id": "the ID value from ID: in the email header",
  "subject": "email subject",
  "from": "sender name and email",
  "date": "YYYY-MM-DD",
  "type": one of ["Reply", "Task", "Deadline", "FYI"],
  "priority": one of ["High", "Medium", "Low"],
  "action": "clear 1-sentence description of what needs to be done",
  "due_date": "YYYY-MM-DD if a specific date is mentioned, otherwise null",
  "notes": "any extra context, steps, or reference numbers — keep under 300 chars"
}

Return ONLY a valid JSON array. No markdown, no explanation, no preamble.

## New emails to analyse:
${emailList}`;

  const payload = JSON.stringify({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages:   [{ role: "user", content: prompt }],
    system:     "You return only valid JSON arrays. No markdown fences, no preamble, no explanation.",
  });

  const options = {
    method:      "post",
    contentType: "application/json",
    headers: {
      "x-api-key":         CONFIG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload:            payload,
    muteHttpExceptions: true,
  };

  const res  = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", options);
  const data = JSON.parse(res.getContentText());

  if (data.error) throw new Error(`Claude API error: ${data.error.message}`);

  const raw = data.content[0].text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    log(`Failed to parse Claude response: ${raw.substring(0, 200)}`);
    return [];
  }
}


// ── 5. INSERT ACTIONS INTO NOTION ────────────────────────────
function insertActionsToNotion(actions) {
  let inserted = 0;

  for (const action of actions) {
    try {
      const properties = {
        "Action":           { title:     [{ text: { content: action.action || "" } }] },
        "Type":             { select:    { name: action.type || "FYI" } },
        "Priority":         { select:    { name: action.priority || "Medium" } },
        "Status":           { select:    { name: "To Do" } },
        "From":             { rich_text: [{ text: { content: action.from || "" } }] },
        "Subject":          { rich_text: [{ text: { content: action.subject || "" } }] },
        "Gmail Message ID": { rich_text: [{ text: { content: action.gmail_message_id || "" } }] },
        "Email Link":       { url: action.gmail_message_id ? `https://mail.google.com/mail/u/0/#all/${action.gmail_message_id}` : null },
        "Notes":            { rich_text: [{ text: { content: action.notes || "" } }] },
        "Action Taken":     { rich_text: [{ text: { content: "" } }] }, // you fill this in
        "Date Added":       { date:      { start: new Date().toISOString().split("T")[0] } },
      };

      if (action.due_date) {
        properties["Due Date"] = { date: { start: action.due_date } };
      }

      const body = {
        parent:     { database_id: CONFIG.NOTION_DATABASE_ID },
        properties: properties,
      };

      const res = notionRequest("POST", "/pages", body);
      JSON.parse(res);
      inserted++;
      Utilities.sleep(300); // respect Notion rate limits

    } catch (err) {
      log(`Failed to insert action "${action.subject}": ${err.message}`);
    }
  }

  return inserted;
}


// ── HELPERS ───────────────────────────────────────────────────
function notionRequest(method, path, body) {
  const options = {
    method:      method.toLowerCase(),
    contentType: "application/json",
    headers: {
      "Authorization":  `Bearer ${CONFIG.NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
    },
    muteHttpExceptions: true,
  };
  if (body) options.payload = JSON.stringify(body);

  const res = UrlFetchApp.fetch(`https://api.notion.com/v1${path}`, options);
  if (res.getResponseCode() >= 400) {
    throw new Error(`Notion API ${res.getResponseCode()}: ${res.getContentText().substring(0, 300)}`);
  }
  return res.getContentText();
}

function log(msg) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${msg}`);
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Log") || ss.insertSheet("Log");
    sheet.appendRow([new Date(), msg]);
  } catch (e) { /* no spreadsheet context, fine */ }
}


// ── SETUP HELPER (run once manually to verify config) ─────────
function testRun() {
  log("--- TEST RUN ---");
  log(`Anthropic key set: ${CONFIG.ANTHROPIC_API_KEY !== "YOUR_ANTHROPIC_API_KEY"}`);
  log(`Notion key set:    ${CONFIG.NOTION_API_KEY !== "YOUR_NOTION_API_KEY"}`);

  const history = fetchCompletedActions();
  log(`Completed actions available as learning context: ${history.length}`);

  const emails = fetchRecentEmails();
  log(`Found ${emails.length} emails in last ${CONFIG.LOOKBACK_DAYS} days`);

  const ids = fetchExistingGmailIds();
  log(`Found ${ids.size} existing Notion records`);

  log("Config looks good — schedule your daily trigger on runDailyEmailActions()");
}

function createDailyTrigger() {
  // Remove any existing triggers first to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  
  ScriptApp.newTrigger("runDailyEmailActions")
    .timeBased()
    .everyDays(1)
    .atHour(7)        // 7am — change this to whatever hour you want (0–23)
    .create();
  
  Logger.log("Daily trigger created for 7am.");
}
