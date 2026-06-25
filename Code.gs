/**
 * Sheet Webhook — turn any Google Sheet into a webhook endpoint.
 *
 * Paste the generated URL into any 3rd-party form's webhook field.
 * Every submission is appended as a row. Column headers are created
 * automatically from the incoming data keys (new keys add new columns).
 *
 * Optional, all controlled from the 🔗 Webhook menu / sidebar — no code edits:
 *   • Secret key  — reject POSTs that don't carry your private token.
 *   • Field mapping — rename, reorder, or drop columns via a config tab.
 *
 * Author: Mecaca Tech Support
 */

var TIMESTAMP_HEADER = 'Received At';     // first column on every sheet
var CONFIG_SHEET     = 'Webhook Config';  // field-mapping control tab
var SECRET_PROP      = 'WEBHOOK_SECRET';  // document property holding the token
var TARGET_PROP      = 'TARGET_SHEET';    // document property: where rows go
var SECRET_KEYS      = ['token', 'secret', '_secret']; // stripped from saved data

// ===========================================================================
// Webhook endpoints (the deployed Web App URL)
// ===========================================================================

/** Receives form/webhook POSTs and appends them to the target sheet. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // serialize writes so concurrent submits don't collide
  } catch (lockErr) {
    return jsonOut_({ ok: false, error: 'Busy, please retry' });
  }
  try {
    var data = parsePayload_(e);

    if (!checkSecret_(e, data)) {
      return jsonOut_({ ok: false, error: 'Unauthorized: missing or wrong token' });
    }
    stripSecretKeys_(data);

    if (isEmpty_(data)) {
      return jsonOut_({ ok: false, error: 'No data received' });
    }

    appendData_(getTargetSheet_(), data);
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/** Visiting the URL in a browser just confirms the webhook is live. */
function doGet() {
  return jsonOut_({ ok: true, message: 'Webhook is live. Send POST requests here.' });
}

// ===========================================================================
// Secret key (optional)
// ===========================================================================

/** True if no secret is set, or the request carries the correct token. */
function checkSecret_(e, data) {
  var secret = PropertiesService.getDocumentProperties().getProperty(SECRET_PROP);
  if (!secret) return true; // feature disabled

  var provided = '';
  if (e && e.parameter) {
    provided = e.parameter.token || e.parameter.secret || e.parameter._secret || '';
  }
  if (!provided && data) {
    provided = data.token || data.secret || data._secret || '';
  }
  return !!provided && provided === secret;
}

/** Never persist the token as a data column. */
function stripSecretKeys_(data) {
  SECRET_KEYS.forEach(function (k) { delete data[k]; });
}

// ===========================================================================
// Payload parsing
// ===========================================================================

/** Turn whatever the 3rd-party form sent into a flat key -> value object. */
function parsePayload_(e) {
  var obj = {};

  if (e && e.postData && e.postData.contents) {
    var raw = e.postData.contents;
    var type = String(e.postData.type || '').toLowerCase();

    if (type.indexOf('application/json') !== -1) {
      obj = tryJson_(raw);
    } else if (type.indexOf('x-www-form-urlencoded') !== -1) {
      obj = paramsToObj_(e);
    } else {
      obj = tryJson_(raw);
      if (isEmpty_(obj)) obj = paramsToObj_(e);
    }
  } else {
    obj = paramsToObj_(e);
  }

  if (isEmpty_(obj)) obj = paramsToObj_(e); // last-chance fallback
  return flatten_(obj, '', {});
}

function tryJson_(raw) {
  try {
    var parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : { value: parsed };
  } catch (_) {
    return {};
  }
}

/** Build an object from URL/query params (handles repeated keys). */
function paramsToObj_(e) {
  var out = {};
  if (e && e.parameters) {
    Object.keys(e.parameters).forEach(function (k) {
      var vals = e.parameters[k];
      out[k] = (vals && vals.length > 1) ? vals.join(', ') : (vals ? vals[0] : '');
    });
  } else if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (k) { out[k] = e.parameter[k]; });
  }
  return out;
}

/**
 * Flatten nested objects/arrays into dotted keys so any shape becomes columns.
 * { user: { name: 'A' }, tags: ['x','y'] } -> { 'user.name':'A', 'tags':'x, y' }
 */
function flatten_(obj, prefix, out) {
  if (obj === null || obj === undefined) {
    if (prefix) out[prefix] = '';
    return out;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) { out[prefix] = ''; return out; }
    var allPrimitive = obj.every(function (v) { return v === null || typeof v !== 'object'; });
    if (allPrimitive) {
      out[prefix] = obj.join(', ');
    } else {
      obj.forEach(function (v, i) {
        flatten_(v, prefix ? prefix + '.' + i : String(i), out);
      });
    }
    return out;
  }

  if (typeof obj === 'object') {
    Object.keys(obj).forEach(function (k) {
      flatten_(obj[k], prefix ? prefix + '.' + k : k, out);
    });
    return out;
  }

  out[prefix] = obj;
  return out;
}

// ===========================================================================
// Writing to the sheet (auto headers OR field mapping)
// ===========================================================================

/** Append one submission. Uses the config tab if present, else auto-headers. */
function appendData_(sheet, data) {
  var mapping = getMapping_();
  var pairs = mapping ? buildMappedPairs_(data, mapping) : buildAutoPairs_(data);
  appendRowByPairs_(sheet, pairs);
}

/** Auto mode: timestamp + every incoming key, in arrival order. */
function buildAutoPairs_(data) {
  var pairs = [[TIMESTAMP_HEADER, new Date()]];
  Object.keys(data).forEach(function (k) { pairs.push([k, data[k]]); });
  return pairs;
}

/** Mapped mode: honor config order/rename/include, then capture extras. */
function buildMappedPairs_(data, mapping) {
  var pairs = [[TIMESTAMP_HEADER, new Date()]];
  var used = {};

  mapping.rows.forEach(function (m) {
    used[m.field] = true;
    if (!m.include) return;
    var header = m.header || m.field;
    pairs.push([header, (m.field in data) ? data[m.field] : '']);
  });

  if (mapping.captureUnmapped) {
    Object.keys(data).forEach(function (k) {
      if (!used[k]) pairs.push([k, data[k]]); // never silently lose new fields
    });
  }
  return pairs;
}

/**
 * Write a row from [header, value] pairs, creating/extending the header row.
 * Headers already present keep their position; brand-new ones are appended.
 */
function appendRowByPairs_(sheet, pairs) {
  var headers = getHeaders_(sheet);

  if (headers.length === 0) {
    headers = pairs.map(function (p) { return p[0]; });
    writeHeaders_(sheet, headers);
  } else {
    var incoming = pairs.map(function (p) { return p[0]; });
    var newOnes = incoming.filter(function (h) { return headers.indexOf(h) === -1; });
    if (newOnes.length) {
      headers = headers.concat(newOnes);
      writeHeaders_(sheet, headers);
    }
  }

  var lookup = {};
  pairs.forEach(function (p) { lookup[p[0]] = p[1]; });

  var row = headers.map(function (h) {
    if (Object.prototype.hasOwnProperty.call(lookup, h)) return lookup[h];
    if (h === TIMESTAMP_HEADER) return new Date();
    return '';
  });
  sheet.appendRow(row);
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  var values = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (values.every(function (v) { return v === '' || v === null; })) return [];
  return values.map(function (v) { return String(v); });
}

function writeHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#4285F4')
    .setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
}

// ===========================================================================
// Field mapping (config tab)
// ===========================================================================

/** Read the config tab into a mapping object, or null if not set up. */
function getMapping_() {
  var cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET);
  if (!cfg || cfg.getLastRow() < 2) return null;

  var values = cfg.getRange(2, 1, cfg.getLastRow() - 1, 3).getValues();
  var rows = [];
  values.forEach(function (r) {
    var field = String(r[0]).trim();
    if (!field) return;
    var inc = String(r[2]).trim().toUpperCase();
    rows.push({
      field: field,
      header: String(r[1]).trim(),
      include: !(inc === 'N' || inc === 'NO' || inc === 'FALSE' || inc === '0')
    });
  });
  if (rows.length === 0) return null;
  return { rows: rows, captureUnmapped: true };
}

/** Create the config tab (pre-filled with known fields) and open it. */
function editFieldMapping() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = ss.getSheetByName(CONFIG_SHEET);

  if (!cfg) {
    cfg = ss.insertSheet(CONFIG_SHEET);
    cfg.getRange(1, 1, 1, 3)
      .setValues([['Incoming Field', 'Column Header (rename, optional)', 'Include? (Y/N)']])
      .setFontWeight('bold').setBackground('#34A853').setFontColor('#FFFFFF');
    cfg.setFrozenRows(1);
    cfg.setColumnWidth(1, 200);
    cfg.setColumnWidth(2, 230);
    cfg.setColumnWidth(3, 110);

    var known = getHeaders_(getTargetSheet_()).filter(function (h) {
      return h !== TIMESTAMP_HEADER;
    });
    if (known.length) {
      cfg.getRange(2, 1, known.length, 3).setValues(known.map(function (k) {
        return [k, '', 'Y'];
      }));
    }
  }

  ss.setActiveSheet(cfg);
  SpreadsheetApp.getUi().alert(
    'Field Mapping',
    'Edit this tab to control your columns — no code needed:\n\n' +
    '• Incoming Field  = the exact form field name\n' +
    '• Column Header   = rename it (leave blank to keep the field name)\n' +
    '• Include? (Y/N)  = put N to drop a field\n\n' +
    'Row order = column order. Any field not listed is still captured and ' +
    'added at the end (no data is ever lost). Delete this whole tab to go back ' +
    'to fully automatic headers.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ===========================================================================
// Target sheet
// ===========================================================================

/** The sheet rows are written to (defaults to the first non-config tab). */
function getTargetSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = PropertiesService.getDocumentProperties().getProperty(TARGET_PROP);
  var sheet = name ? ss.getSheetByName(name) : null;
  if (sheet) return sheet;

  var sheets = ss.getSheets().filter(function (s) { return s.getName() !== CONFIG_SHEET; });
  return sheets[0] || ss.getSheets()[0];
}

function useCurrentSheet() {
  var name = SpreadsheetApp.getActiveSheet().getName();
  if (name === CONFIG_SHEET) {
    SpreadsheetApp.getUi().alert('That is the config tab. Pick a data tab instead.');
    return;
  }
  PropertiesService.getDocumentProperties().setProperty(TARGET_PROP, name);
  SpreadsheetApp.getActiveSpreadsheet().toast('Submissions will be saved to: ' + name, 'Webhook', 5);
}

// ===========================================================================
// Menu + sidebar (the "extension" UI)
// ===========================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔗 Webhook')
    .addItem('Get Webhook URL', 'showSidebar')
    .addSeparator()
    .addItem('Edit Field Mapping', 'editFieldMapping')
    .addItem('Use Current Tab as Target', 'useCurrentSheet')
    .addItem('Send Test Row', 'sendTestFromMenu')
    .addToUi();
}

function onInstall() {
  onOpen();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Webhook')
    .setWidth(330);
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Full status for the sidebar. */
function getWebhookInfo() {
  var deployedUrl = '';
  try { deployedUrl = ScriptApp.getService().getUrl() || ''; } catch (_) {}
  var secret = PropertiesService.getDocumentProperties().getProperty(SECRET_PROP);

  return {
    url: webhookUrl_(),
    deployed: !!deployedUrl,
    // Real reachability: UrlFetchApp makes an ANONYMOUS external call (no owner
    // cookies), so this behaves exactly like a 3rd-party form. Catches the
    // "deployed but not set to Anyone / wrong deployment" trap.
    reachable: deployedUrl ? checkReachable_(deployedUrl) : false,
    secretEnabled: !!secret,
    hasMapping: !!getMapping_(),
    targetSheet: getTargetSheet_().getName()
  };
}

/** GET the /exec anonymously and confirm our doGet JSON comes back. */
function checkReachable_(url) {
  try {
    if (!url) return false;
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    var body = res.getContentText() || '';
    return body.indexOf('"ok":true') !== -1 || body.indexOf('Webhook is live') !== -1;
  } catch (e) {
    return false;
  }
}

/** Deployed URL, with ?token=... appended when a secret is enabled. */
function webhookUrl_() {
  var base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch (_) {}
  if (!base) return '';
  var secret = PropertiesService.getDocumentProperties().getProperty(SECRET_PROP);
  return secret ? base + '?token=' + encodeURIComponent(secret) : base;
}

/** Sidebar: turn secret protection on (generates a token) or off. */
function setSecretEnabled(enabled) {
  var props = PropertiesService.getDocumentProperties();
  if (enabled) {
    if (!props.getProperty(SECRET_PROP)) {
      props.setProperty(SECRET_PROP, Utilities.getUuid().replace(/-/g, ''));
    }
  } else {
    props.deleteProperty(SECRET_PROP);
  }
  return getWebhookInfo();
}

/** Fire a sample POST at our own webhook so the user can see it work. */
function sendTest() {
  var url = webhookUrl_();
  if (!url) throw new Error('Deploy the web app first (see the sidebar).');
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      name: 'Test User',
      email: 'test@example.com',
      message: 'Hello from setup test',
      _source: 'setup-test'
    }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  var body = res.getContentText() || '';
  // Only a real {"ok":true} counts. A "Page not found" / login page means the
  // active deployment isn't reachable by outside forms.
  if (body.indexOf('"ok":true') === -1) {
    throw new Error(
      'Webhook is NOT reachable for outside requests. Fix: Deploy ▸ Manage ' +
      'deployments ▸ archive extras, keep ONE Web app with access = "Anyone".'
    );
  }
  return body;
}

function sendTestFromMenu() {
  try {
    sendTest();
    SpreadsheetApp.getActiveSpreadsheet().toast('Test row added ✔', 'Webhook', 5);
  } catch (err) {
    SpreadsheetApp.getUi().alert(String(err && err.message || err));
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isEmpty_(obj) {
  return !obj || Object.keys(obj).length === 0;
}
