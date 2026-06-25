# 🔗 Sheet Webhook

Turn any Google Sheet into a webhook endpoint. Generate a URL, paste it into any
3rd-party form (Typeform, Jotform, Tally, Webflow, etc.), and every submission is
appended as a new row. **Column headers are created automatically** from the
incoming field names — no manual setup.

---

## What it does

- One click → get a webhook URL from the sidebar.
- Paste that URL into your form's "webhook" / "POST to URL" field.
- On submit, data is written to the sheet.
- First submission builds the header row from the data keys; new fields add new columns.
- A `Received At` timestamp column is added to every row.
- Accepts JSON, form-urlencoded, and nested payloads (`{user:{name}}` → `user.name` column).
- **Secret key** (optional): reject any POST that doesn't carry your private token.
- **Field mapping** (optional): rename, reorder, or drop columns from an in-sheet tab — no code.

Everything is controlled from the **🔗 Webhook** menu / sidebar.

---

## Install

Two ways. Pick one.

### Option A — Manual paste (no tools, ~3 min)

You do this **once** per sheet.

1. Open your Google Sheet.
2. Menu: **Extensions ▸ Apps Script**.
3. Delete any code in `Code.gs`, paste the contents of **`Code.gs`** from this folder.
4. Click **+** next to "Files" ▸ **HTML** ▸ name it exactly `Sidebar` ▸ paste **`Sidebar.html`**.
5. (Recommended) Gear ⚙ **Project Settings** ▸ tick *"Show appsscript.json manifest file"*,
   open `appsscript.json`, paste the contents of **`appsscript.json`** from this folder.
6. **Save** (💾), then reload the Sheet tab. A new **🔗 Webhook** menu appears.

### Option B — One command (clasp) — closest to "template sheet"

Needs Node + the Google `clasp` CLI. This creates a **brand-new Sheet + bound script**
and pushes all the code in one shot.

```bash
npm install -g @google/clasp
clasp login
# from inside this folder:
clasp create --type sheets --title "Webhook Sheet"
clasp push
```

Then open the created sheet (`clasp open --addon` or the URL clasp prints), reload, done.
`.claspignore` makes sure only `Code.gs`, `Sidebar.html`, and `appsscript.json` get pushed.

---

## Deploy & get your URL (one-time)

> Apps Script requires this one manual deploy. After it, everything is plug-and-play.

1. In the Sheet: **🔗 Webhook ▸ Get Webhook URL** → sidebar opens.
2. First time it says *"Not deployed."* In the Apps Script editor:
   - **Deploy ▸ New deployment** ▸ gear ⚙ ▸ **Web app**
   - **Execute as:** Me · **Who has access:** Anyone
   - **Deploy** ▸ **Authorize access** ▸ allow.
3. Reopen **🔗 Webhook ▸ Get Webhook URL**.
4. Click **📋 Copy URL** → that's your webhook.
5. Click **⚡ Send Test Row** to confirm — a test row should appear.

---

## Use it

Paste the copied URL into your 3rd-party form's webhook field. Submit. Row shows up,
headers auto-generated.

### Send rows to a specific tab
Open the tab you want → **🔗 Webhook ▸ Use Current Tab as Target**.

---

## 🔒 Secret key (optional, recommended)

The endpoint is public by default — anyone with the URL can POST. To lock it:

1. Sidebar → **🔒 Secret key** card → **Enable**.
2. A token is generated and **appended to the URL** as `?token=...`.
3. Copy the new URL (with token) and paste it into your form.

Now any POST without the correct token is rejected. The token can also be sent as a
body field `token`, `secret`, or `_secret`. Toggle **Disable** to remove it.
Keep the tokenized URL private.

> Apps Script web apps can't read custom request headers, so the token rides in the
> query string / body rather than an `Authorization` header.

---

## 🧩 Field mapping (optional)

By default columns are auto-named from incoming field keys. To control them:

1. Sidebar → **🧩 Field mapping** card → **Edit** (or menu **Edit Field Mapping**).
2. A **`Webhook Config`** tab is created, pre-filled with the fields seen so far.
3. Edit the three columns:

   | Incoming Field | Column Header (rename, optional) | Include? (Y/N) |
   |----------------|----------------------------------|----------------|
   | `email`        | `Email Address`                  | Y              |
   | `user.name`    | `Full Name`                      | Y              |
   | `_source`      |                                  | N              |

   - **Row order = column order.**
   - Blank "Column Header" keeps the field name.
   - `N` drops that field.
   - Any incoming field **not listed** is still captured and appended at the end — no data is ever lost.
4. Delete the whole `Webhook Config` tab to return to fully automatic headers.

---

## Notes

- **Updating the code?** After editing `Code.gs`:
  **Deploy ▸ Manage deployments ▸ ✏ Edit ▸ Version: New version ▸ Deploy**.
  The URL stays the same.
- **Timestamp timezone** is set in `appsscript.json` (`Asia/Kuala_Lumpur`).

---

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Webhook logic, auto-headers, secret check, field mapping, menu, sidebar server functions |
| `Sidebar.html` | The "extension" UI — URL, copy, test, secret toggle, mapping |
| `appsscript.json` | Manifest: web-app deployment config + OAuth scopes |
| `.claspignore` | Limits `clasp push` to the three files above |
