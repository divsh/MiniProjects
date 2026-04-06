# Car Service Record

A single-page web application for tracking vehicle service history, stored in Notion.

**Features:** Google Sign-In with email whitelist · full service checklist with comments · mechanic/workshop details · service history view per rego · hosted on GitHub Pages.

---

## Architecture

```
GitHub Pages (static)
  ├── index.html / style.css / app.js / config.js
  │       │  Google Identity Services (OAuth)
  │       └──────────────────────────────────────────────────────►  Google Apps Script (Web App)
  │                                                                        │  verifies ID token
  │                                                                        └────────────────────► Notion API
  │                                                                                                (database)
  └── (all secrets live in Apps Script, never in the browser)
```

---

## Setup — Step by Step

### Step 1 — Notion Database

1. Go to [notion.so](https://notion.so) and create a new **full-page database** (Table view).  
   Name it something like `Car Service Records`.

2. Add the following **properties** (the `Name` title column is created automatically):

   | Property Name      | Type        |
   |--------------------|-------------|
   | Rego               | Text        |
   | Service Date       | Date        |
   | Mechanic Name      | Text        |
   | Mechanic Phone     | Text        |
   | Workshop           | Text        |
   | Workshop Address   | Text        |
   | Vehicle            | Text        |
   | Odometer KM        | Number      |
   | Next Service KM    | Number      |
   | Next Service Date  | Date        |
   | Service Cost       | Number      |
   | Recorded By        | Text        |

3. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) → **New integration**.  
   - Name: `Car Service Record`  
   - Access: Read + Write content  
   - Copy the **Internal Integration Secret** (starts with `secret_…`)

4. Open your database page in Notion → `⋯` menu → **Add connections** → select your integration.

5. Copy the **Database ID** from the URL:  
   `https://notion.so/yourworkspace/**DATABASE_ID**?v=…`

---

### Step 2 — Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create or select a project.

2. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.  
   - Application type: **Web application**  
   - Name: `Car Service Record`  
   - **Authorized JavaScript origins** — add:
     - `http://localhost` (for local testing)
     - `https://YOUR_GITHUB_USERNAME.github.io` (your GitHub Pages domain)

3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

---

### Step 3 — Google Apps Script

1. Go to [script.google.com](https://script.google.com) → **New project**.

2. Rename the project to `Car Service Record API`.

3. Delete the default `myFunction()` and paste the entire contents of **`Code.gs`** from this repo.

4. Go to **Project Settings** (gear icon) → **Script Properties** → add these four properties:

   | Key               | Value                                     |
   |-------------------|-------------------------------------------|
   | NOTION_TOKEN      | `secret_xxxxx` (your integration secret)  |
   | NOTION_DB_ID      | your Notion database ID                   |
   | GOOGLE_CLIENT_ID  | your OAuth Client ID                      |
   | ALLOWED_EMAILS    | `your@gmail.com` (comma-separate multiple)|

5. **Deploy** → **New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy** → authorise when prompted.

6. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/AKfy…/exec`).

> **Important:** Every time you change `Code.gs` you must create a **new deployment** (not just save). The URL changes each time — update `config.js` accordingly.

---

### Step 4 — Configure the Website

Open **`config.js`** and fill in the three values:

```js
const CONFIG = {
  GOOGLE_CLIENT_ID: 'xxxxxxx.apps.googleusercontent.com',
  ALLOWED_EMAILS:   ['your.email@gmail.com'],
  APPS_SCRIPT_URL:  'https://script.google.com/macros/s/AKfy.../exec'
};
```

---

### Step 5 — Deploy to GitHub Pages

1. Create a new **public** GitHub repository (e.g. `car-service-record`).

2. Push these files to the repo root:
   ```
   index.html
   style.css
   app.js
   config.js
   ```
   > Do **not** push `Code.gs` — it contains no secrets but isn't needed on GitHub Pages.

3. Go to **Settings → Pages**:
   - Source: `Deploy from a branch`
   - Branch: `main` / `root`
   - Save.

4. Your site will be live at `https://YOUR_USERNAME.github.io/car-service-record/` within a minute or two.

5. Go back to Google Cloud Console → your OAuth Client ID → add the full GitHub Pages URL  
   (`https://YOUR_USERNAME.github.io`) to **Authorized JavaScript origins** → Save.

---

## Usage

| Action | How |
|--------|-----|
| Sign in | Click **Sign in with Google** — only authorised emails can proceed |
| New service | Fill in vehicle details, mechanic details, and tick off the checklist |
| Comments | Type in the comment box next to any checklist item |
| Save | Click **Save Service Record** at the bottom |
| View history | Switch to **Service History** tab → enter a rego or click **All Vehicles** |
| Record detail | Click any history card to see the full checklist and all details |
| Sign out | Click **Sign Out** in the top-right corner |

---

## Security Notes

- The Notion token and database ID are stored **only** in Google Apps Script properties — they are never sent to the browser or committed to the repository.
- Every API request includes the user's Google ID token, which the Apps Script verifies against Google's token-info endpoint before processing.
- The email whitelist is enforced both client-side (instant UX feedback) and server-side (Apps Script), so the Notion database is protected even if someone bypasses the frontend.
- `config.js` contains only the OAuth Client ID and allowed emails — neither is a secret (the Client ID is visible to any website visitor, which is normal for browser-based OAuth).

---

## Adding More Authorised Users

Edit the `ALLOWED_EMAILS` script property in Apps Script (comma-separated) **and** update `ALLOWED_EMAILS` in `config.js`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Sign in with Google" button doesn't appear | Check that `GOOGLE_CLIENT_ID` in `config.js` is correct and the GitHub Pages URL is in Authorized JavaScript origins |
| "Access Denied" after signing in | Your email is not in `ALLOWED_EMAILS` in `config.js` |
| Save fails with network error | Apps Script URL may be wrong, or you need to redeploy after code changes |
| Save fails with "Notion API 404" | Check `NOTION_DB_ID` script property and that the integration is connected to the database |
| History shows no records | Ensure the Rego property in Notion is spelled exactly `Rego` (case-sensitive) |
