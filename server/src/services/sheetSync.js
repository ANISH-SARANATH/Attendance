const crypto = require("crypto");
const fs = require("fs/promises");
const https = require("https");
const path = require("path");
const SheetQueue = require("../models/SheetQueue"); // NEW: Import the Mongo Model

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SESSION_COLUMNS = ["morning", "afternoon", "evening"];

// UPDATED: Added company and designation
const BASE_HEADERS = ["USN", "name", "email", "phoneno", "company", "designation", "dateKey", "FirstScannedAt"];


let tokenCache = {
  accessToken: "",
  expiresAt: 0
};

const sheetTitleCache = new Map();

function env(name) {
  return String(process.env[name] || "").trim();
}

function isSheetsEnabled() {
  return env("GOOGLE_SHEETS_ENABLED").toLowerCase() === "true";
}

function asPlainAttendance(attendance) {
  return typeof attendance?.toObject === "function" ? attendance.toObject() : attendance;
}

function buildSheetRecord(attendanceInput) {
  const attendance = asPlainAttendance(attendanceInput);
  
  return {
    USN: String(attendance.USN || attendance.usn || attendance.id || attendance.phoneno || attendance.email || "").trim().toUpperCase(),
    name: String(attendance.name || "").trim().toUpperCase(),
    email: String(attendance.email || "").trim().toUpperCase(),
    phoneno: String(attendance.phoneno || attendance.phone || "").trim(),
    company: String(attendance.company || "").trim(),
    designation: String(attendance.designation || "").trim(),
    dateKey: String(attendance.dateKey || "").trim(),
    // Renamed to make more sense for append-only
    FirstScannedAt: attendance.scannedAt ? new Date(attendance.scannedAt).toISOString() : new Date().toISOString()
  };
}

function envSafeSession(session) {
  const value = String(session || "").trim().toLowerCase();
  return SESSION_COLUMNS.includes(value) ? value : "";
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

function mergeHeaders(existingHeaders) {
  const headers = existingHeaders.map((header) => String(header || "").trim()).filter(Boolean);
  const lower = new Set(headers.map((header) => header.toLowerCase()));

  for (const header of BASE_HEADERS) {
    if (!lower.has(header.toLowerCase())) {
      headers.push(header);
      lower.add(header.toLowerCase());
    }
  }

  return headers;
}

// FIX: Maps directly to the 3 exact tab names (Student, Faculty, Professional)
async function resolveSheetTitle(personType) {
  const lowerType = String(personType).toLowerCase();
  if (lowerType === "faculty") return "Faculty";
  if (lowerType === "professional") return "Professional";
  return "Student"; 
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

async function ensureHeaders(spreadsheetId, sheetTitle, accessToken) {
  const existingRows = await getValues(spreadsheetId, sheetTitle, "A1:Z1", accessToken);
  const headers = mergeHeaders(existingRows[0] || []);
  await updateValues(spreadsheetId, sheetTitle, `A1:${columnName(headers.length - 1)}1`, [headers], accessToken);
  return headers;
}

function rowToObject(headers, row) {
  return headers.reduce((acc, header, index) => {
    acc[header] = row[index] || "";
    return acc;
  }, {});
}

function buildSheetRow(headers, existingRow, record) {
  const existing = rowToObject(headers, existingRow || []);
  const merged = {
    ...existing,
    ...record
  };

  for (const session of SESSION_COLUMNS) {
    merged[session] = existing[session] === "Y" || record[session] === "Y" ? "Y" : "";
  }

  return headers.map((header) => merged[header] || "");
}

// NEW: Queue logic using MongoDB instead of local files
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
  // FIX: Trusts the input type instead of forcing faculty/student
  const personType = input.personType; 
  const record = input.record || buildSheetRecord(input.attendance);
  const queueEntry = {
    personType,
    mode: input.mode || "scan",
    recordId: String(input.recordId || ""),
    record
  };

  if (!record.USN) {
    if (options.queueOnFailure === false) {
      return { ok: false, queued: false, reason: "Missing USN for sheet sync." };
    }
    return queueSheetSync(queueEntry, "Missing USN for sheet sync.");
  }

  if (!isSheetsEnabled()) {
    if (options.queueOnFailure === false) {
      return { ok: false, queued: false, reason: "Google Sheets sync is disabled." };
    }
    return queueSheetSync(queueEntry, "Google Sheets sync is disabled.");
  }

  try {
    const spreadsheetId = env("GOOGLE_SHEETS_SPREADSHEET_ID");
    const accessToken = await getAccessToken();
    const sheetTitle = await resolveSheetTitle(personType); // Uses simplified resolver
    const headers = await ensureHeaders(spreadsheetId, sheetTitle, accessToken);
    const lastColumn = columnName(headers.length - 1);
    const rows = await getValues(spreadsheetId, sheetTitle, `A2:${lastColumn}`, accessToken);
    
    const usnIndex = headers.findIndex((header) => header.toLowerCase() === "usn");
    const existingIndex = rows.findIndex((row) => String(row[usnIndex] || "").trim().toUpperCase() === record.USN);
    const nextRow = buildSheetRow(headers, existingIndex >= 0 ? rows[existingIndex] : [], record);

    if (existingIndex >= 0) {
      return {
        ok: true,
        queued: false,
        action: "skipped_already_present", // Let the server know we skipped them
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

// NEW: Flush logic using MongoDB
async function flushQueuedSheetSync() {
  const queue = await SheetQueue.find({});
  const synced = [];
  const remaining = [];

  for (const entry of queue) {
    const result = await syncAttendanceToSheet(entry, { queueOnFailure: false });
    if (result.ok) {
      synced.push({ recordId: entry.recordId, USN: entry.record?.USN, result });
      // Delete from MongoDB upon successful sync
      await SheetQueue.findByIdAndDelete(entry._id);
    } else {
      remaining.push({ ...entry.toObject(), reason: result.reason });
      // Update the reason and timestamp in case it changed
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
  flushQueuedSheetSync,
  syncAttendanceToSheet
};