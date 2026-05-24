const crypto = require("crypto");
const fs = require("fs/promises");
const https = require("https");
const path = require("path");
const SheetQueue = require("../models/SheetQueue");
const { canonicalPersonType } = require("./attendancePayload");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_SPREADSHEET_ID = "1Np5OQHZ3ka4crTvNtma5FTpLZt5FORuei6xCAp_ntoM";

const SESSION_COLUMNS = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening"
};

const SHEET_LAYOUTS = {
  Student: {
    gidEnv: "GOOGLE_SHEETS_STUDENT_GID",
    titleEnv: "GOOGLE_SHEETS_STUDENT_TITLE",
    defaultGid: "0",
    fallbackTitles: ["Student", "Students", "students"],
    headers: ["USN/id", "Name", "Phone", "Email", "Morning", "Afternoon", "Evening"]
  },
  Faculty: {
    gidEnv: "GOOGLE_SHEETS_FACULTY_GID",
    titleEnv: "GOOGLE_SHEETS_FACULTY_TITLE",
    defaultGid: "1521276455",
    fallbackTitles: ["Faculty", "faculty"],
    headers: ["Name", "Phone", "Email", "Morning", "Afternoon", "Evening"]
  },
  Professional: {
    gidEnv: "GOOGLE_SHEETS_PROFESSIONAL_GID",
    titleEnv: "GOOGLE_SHEETS_PROFESSIONAL_TITLE",
    defaultGid: "70753684",
    fallbackTitles: ["Professional", "Profession", "professional", "profession"],
    headers: ["Name", "email", "company", "designation", "phoneno", "Morning", "Afternoon", "Evening"]
  }
};

let tokenCache = {
  accessToken: "",
  expiresAt: 0
};

const spreadsheetMetaCache = new Map();

function env(name) {
  return String(process.env[name] || "").trim();
}

function isSheetsEnabled() {
  return env("GOOGLE_SHEETS_ENABLED").toLowerCase() === "true";
}

function asPlainAttendance(attendance) {
  return typeof attendance?.toObject === "function" ? attendance.toObject() : attendance;
}

function normalizeCell(value = "") {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeEmail(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function sessionKeyFromValue(session) {
  const raw = String(session || "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (SESSION_COLUMNS[lower]) return lower;

  const match = Object.entries(SESSION_COLUMNS).find(([, label]) => label.toLowerCase() === lower);
  return match ? match[0] : "";
}

function getSheetLayout(personTypeInput) {
  const personType = canonicalPersonType(personTypeInput) || "Student";
  return {
    personType,
    ...SHEET_LAYOUTS[personType]
  };
}

function buildSheetRecord(attendanceInput, personTypeInput) {
  const attendance = asPlainAttendance(attendanceInput);
  const personType = canonicalPersonType(personTypeInput || attendance.type) || "Student";
  const sessionKey = sessionKeyFromValue(attendance.Session || attendance.session);

  return {
    personType,
    id: String(attendance.id || "Nil").trim(),
    name: String(attendance.name || "").trim(),
    phone: String(attendance.phone || attendance.phoneno || "").trim(),
    email: String(attendance.email || "").trim().toLowerCase(),
    company: String(attendance.company || "").trim(),
    designation: String(attendance.designation || "").trim(),
    sessionKey,
    lookupKey: String(attendance.lookupKey || "").trim()
  };
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body = text;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = text;
        }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }

        reject(new Error(`Google API ${res.statusCode}: ${typeof body === "string" ? body : JSON.stringify(body)}`));
      });
    });

    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key);
  return `${unsigned}.${base64Url(signature)}`;
}

async function getServiceAccount() {
  const jsonConfig = env("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (jsonConfig) {
    const jsonText = jsonConfig.startsWith("{") ? jsonConfig : await fs.readFile(path.resolve(process.cwd(), jsonConfig), "utf8");
    const parsed = JSON.parse(jsonText);
    return {
      client_email: parsed.client_email,
      private_key: String(parsed.private_key || "").replace(/\\n/g, "\n")
    };
  }

  const clientEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) return null;

  return {
    client_email: clientEmail,
    private_key: privateKey
  };
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  const serviceAccount = await getServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("Google Sheets service account credentials are not configured.");
  }

  const assertion = signJwt(serviceAccount);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  }).toString();

  const tokenResponse = await request(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body)
    },
    body
  });

  tokenCache = {
    accessToken: tokenResponse.access_token,
    expiresAt: Date.now() + Number(tokenResponse.expires_in || 3600) * 1000
  };

  return tokenCache.accessToken;
}

async function googleJson(method, url, accessToken, body) {
  const textBody = body ? JSON.stringify(body) : "";
  return request(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(textBody)
    },
    body: textBody
  });
}

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function encodeRange(sheetTitle, a1Range) {
  return encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!${a1Range}`);
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

async function getSpreadsheetMetadata(spreadsheetId, accessToken) {
  if (spreadsheetMetaCache.has(spreadsheetId)) {
    return spreadsheetMetaCache.get(spreadsheetId);
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`;
  const response = await googleJson("GET", url, accessToken);
  const sheets = response.sheets || [];
  spreadsheetMetaCache.set(spreadsheetId, sheets);
  return sheets;
}

async function resolveSheetTitle(personTypeInput, spreadsheetId, accessToken) {
  const layout = getSheetLayout(personTypeInput);
  const explicitTitle = env(layout.titleEnv);
  if (explicitTitle) return explicitTitle;

  const sheets = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  const wantedGid = Number(env(layout.gidEnv) || layout.defaultGid);
  const gidMatch = sheets.find((sheet) => Number(sheet?.properties?.sheetId) === wantedGid);
  if (gidMatch?.properties?.title) return gidMatch.properties.title;

  for (const fallbackTitle of layout.fallbackTitles) {
    const titleMatch = sheets.find(
      (sheet) => String(sheet?.properties?.title || "").trim().toLowerCase() === fallbackTitle.toLowerCase()
    );
    if (titleMatch?.properties?.title) return titleMatch.properties.title;
  }

  throw new Error(`Could not resolve sheet tab for ${layout.personType}.`);
}

async function getValues(spreadsheetId, sheetTitle, a1Range, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeRange(
    sheetTitle,
    a1Range
  )}?valueRenderOption=UNFORMATTED_VALUE`;
  const response = await googleJson("GET", url, accessToken);
  return response.values || [];
}

async function updateValues(spreadsheetId, sheetTitle, a1Range, values, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeRange(
    sheetTitle,
    a1Range
  )}?valueInputOption=USER_ENTERED`;
  return googleJson("PUT", url, accessToken, { values });
}

async function appendValues(spreadsheetId, sheetTitle, values, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeRange(
    sheetTitle,
    "A:Z"
  )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  return googleJson("POST", url, accessToken, { values });
}

async function ensureHeaders(spreadsheetId, sheetTitle, layout, accessToken) {
  const lastColumn = columnName(layout.headers.length - 1);
  await updateValues(spreadsheetId, sheetTitle, `A1:${lastColumn}1`, [layout.headers], accessToken);
  return layout.headers;
}

function rowToObject(headers, row = []) {
  return headers.reduce((acc, header, index) => {
    acc[header] = row[index] || "";
    return acc;
  }, {});
}

function setSessionFlags(rowMap, sessionKey) {
  for (const label of Object.values(SESSION_COLUMNS)) {
    if (!rowMap[label]) rowMap[label] = "";
  }

  const targetColumn = SESSION_COLUMNS[sessionKey];
  if (targetColumn) rowMap[targetColumn] = "Y";
}

function buildSheetRow(personTypeInput, existingRow, record) {
  const layout = getSheetLayout(personTypeInput);
  const rowMap = rowToObject(layout.headers, existingRow);

  if (layout.personType === "Student") {
    rowMap["USN/id"] = record.id || "Nil";
    rowMap.Name = record.name || "";
    rowMap.Phone = record.phone || "";
    rowMap.Email = record.email || "";
  } else if (layout.personType === "Faculty") {
    rowMap.Name = record.name || "";
    rowMap.Phone = record.phone || "";
    rowMap.Email = record.email || "";
  } else {
    rowMap.Name = record.name || "";
    rowMap.email = record.email || "";
    rowMap.company = record.company || "";
    rowMap.designation = record.designation || "";
    rowMap.phoneno = record.phone || "";
  }

  setSessionFlags(rowMap, record.sessionKey);
  return layout.headers.map((header) => rowMap[header] || "");
}

function findMatchingRowIndex(personTypeInput, rows, record) {
  const layout = getSheetLayout(personTypeInput);
  const headers = layout.headers;

  return rows.findIndex((row) => {
    const rowMap = rowToObject(headers, row);

    if (layout.personType === "Student") {
      const rowId = String(rowMap["USN/id"] || "").trim();
      if (record.id && normalizeCell(record.id) !== "NIL" && normalizeCell(rowId) === normalizeCell(record.id)) {
        return true;
      }
      if (record.phone && normalizeCell(rowMap.Phone) === normalizeCell(record.phone)) return true;
      if (record.email && normalizeEmail(rowMap.Email) === normalizeEmail(record.email)) return true;
      return Boolean(record.name) && normalizeCell(rowMap.Name) === normalizeCell(record.name);
    }

    if (layout.personType === "Faculty") {
      if (record.phone && normalizeCell(rowMap.Phone) === normalizeCell(record.phone)) return true;
      if (record.email && normalizeEmail(rowMap.Email) === normalizeEmail(record.email)) return true;
      return Boolean(record.name) && normalizeCell(rowMap.Name) === normalizeCell(record.name);
    }

    if (record.email && normalizeEmail(rowMap.email) === normalizeEmail(record.email)) return true;
    if (record.phone && normalizeCell(rowMap.phoneno) === normalizeCell(record.phone)) return true;

    const rowComposite = `${normalizeCell(rowMap.Name)}|${normalizeCell(rowMap.company)}`;
    const recordComposite = `${normalizeCell(record.name)}|${normalizeCell(record.company)}`;
    return Boolean(recordComposite.replace("|", "")) && rowComposite === recordComposite;
  });
}

async function queueSheetSync(entry, reason) {
  await SheetQueue.create({
    ...entry,
    reason
  });

  return {
    ok: false,
    queued: true,
    reason,
    queuePath: "mongodb"
  };
}

async function syncAttendanceToSheet(input, options = {}) {
  const personType = canonicalPersonType(input.personType || input.attendance?.type) || "Student";
  const record = input.record || buildSheetRecord(input.attendance, personType);
  const queueEntry = {
    personType,
    mode: input.mode || "scan",
    recordId: String(input.recordId || ""),
    record
  };

  if (!record.sessionKey) {
    if (options.queueOnFailure === false) {
      return { ok: false, queued: false, reason: "Missing session for sheet sync." };
    }
    return queueSheetSync(queueEntry, "Missing session for sheet sync.");
  }

  if (personType === "Student" && !record.id && !record.phone && !record.email) {
    if (options.queueOnFailure === false) {
      return { ok: false, queued: false, reason: "Missing student identity for sheet sync." };
    }
    return queueSheetSync(queueEntry, "Missing student identity for sheet sync.");
  }

  if (!isSheetsEnabled()) {
    if (options.queueOnFailure === false) {
      return { ok: false, queued: false, reason: "Google Sheets sync is disabled." };
    }
    return queueSheetSync(queueEntry, "Google Sheets sync is disabled.");
  }

  try {
    const spreadsheetId = env("GOOGLE_SHEETS_SPREADSHEET_ID") || DEFAULT_SPREADSHEET_ID;
    const accessToken = await getAccessToken();
    const sheetTitle = await resolveSheetTitle(personType, spreadsheetId, accessToken);
    const layout = getSheetLayout(personType);
    const headers = await ensureHeaders(spreadsheetId, sheetTitle, layout, accessToken);
    const lastColumn = columnName(headers.length - 1);
    const rows = await getValues(spreadsheetId, sheetTitle, `A2:${lastColumn}`, accessToken);
    const existingIndex = findMatchingRowIndex(personType, rows, record);
    const nextRow = buildSheetRow(personType, existingIndex >= 0 ? rows[existingIndex] : [], record);

    if (existingIndex >= 0) {
      const rowNumber = existingIndex + 2;
      await updateValues(spreadsheetId, sheetTitle, `A${rowNumber}:${lastColumn}${rowNumber}`, [nextRow], accessToken);
      return {
        ok: true,
        queued: false,
        action: "updated",
        sheet: sheetTitle
      };
    }

    await appendValues(spreadsheetId, sheetTitle, [nextRow], accessToken);
    return {
      ok: true,
      queued: false,
      action: "appended",
      sheet: sheetTitle
    };
  } catch (error) {
    if (options.queueOnFailure === false) {
      return { ok: false, queued: false, reason: error.message };
    }
    return queueSheetSync(queueEntry, error.message);
  }
}

async function flushQueuedSheetSync() {
  const queue = await SheetQueue.find({});
  const synced = [];
  const remaining = [];

  for (const entry of queue) {
    const result = await syncAttendanceToSheet(entry, { queueOnFailure: false });
    if (result.ok) {
      synced.push({ recordId: entry.recordId, result });
      await SheetQueue.findByIdAndDelete(entry._id);
    } else {
      remaining.push({ ...entry.toObject(), reason: result.reason });
      await SheetQueue.findByIdAndUpdate(entry._id, { reason: result.reason, queuedAt: new Date() });
    }
  }

  return {
    ok: remaining.length === 0,
    synced: synced.length,
    remaining: remaining.length
  };
}

module.exports = {
  buildSheetRecord,
  buildSheetRow,
  findMatchingRowIndex,
  flushQueuedSheetSync,
  getSheetLayout,
  sessionKeyFromValue,
  syncAttendanceToSheet
};
