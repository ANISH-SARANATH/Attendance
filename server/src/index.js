const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const StudentAttendance = require("./models/StudentAttendance");
const FacultyAttendance = require("./models/FacultyAttendance");
const { authRequired, adminOnly } = require("./middleware/auth");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://anishsaranathcs24_db_user:27051939@cluster0.2undrzy.mongodb.net/?appName=Cluster0";
const MONGODB_URI_FALLBACK =
  process.env.MONGODB_URI_FALLBACK ||
  "mongodb://anishsaranathcs24_db_user:27051939@ac-menpg4i-shard-00-00.2undrzy.mongodb.net:27017,ac-menpg4i-shard-00-01.2undrzy.mongodb.net:27017,ac-menpg4i-shard-00-02.2undrzy.mongodb.net:27017/?ssl=true&authSource=admin&replicaSet=atlas-xe98dr-shard-0&retryWrites=true&w=majority&appName=Cluster0";
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || "").trim();

const VOLUNTEER_USERNAME = process.env.VOLUNTEER_USERNAME || "volunteer";
const VOLUNTEER_PASSWORD = process.env.VOLUNTEER_PASSWORD || "VolunteerSigmod";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "271939";

function signToken(role, username) {
  return jwt.sign({ role, username }, process.env.JWT_SECRET || "dev-secret", {
    expiresIn: "12h"
  });
}

function getDateKey() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function normalize(value = "") {
  return String(value).trim();
}

function parseJsonCandidate(value) {
  const text = normalize(value);
  if (!text) return null;

  const candidates = [text];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  const unescaped = text.replace(/\\"/g, '"');
  if (unescaped !== text) candidates.push(unescaped);

  for (const candidate of candidates) {
    let current = candidate;
    for (let i = 0; i < 3; i += 1) {
      try {
        const parsed = JSON.parse(current);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        if (typeof parsed !== "string") break;

        const next = normalize(parsed);
        if (!next || next === current) break;
        current = next;
      } catch {
        break;
      }
    }
  }

  return null;
}

function plainValue(source, keys) {
  if (!source) return "";

  for (const key of keys) {
    const value = source[key];
    const text = normalize(value);
    if (!text) continue;
    if (parseJsonCandidate(text)) continue;
    return text;
  }

  return "";
}

function nestedQrObject(source) {
  const keys = ["id", "ID", "identifier", "IDENTIFIER", "usn", "USN", "studentId", "STUDENT_ID"];

  for (const key of keys) {
    const parsed = parseJsonCandidate(source?.[key]);
    if (parsed) return parsed;
  }

  return null;
}

function decodeQrObject(source, version) {
  const nested = nestedQrObject(source);
  const data = nested || source;
  const fallback = nested ? source : null;

  const typeRaw =
    plainValue(data, ["type", "TYPE", "personType", "PERSON_TYPE"]) ||
    plainValue(fallback, ["type", "TYPE", "personType", "PERSON_TYPE"]);
  const qrType = typeRaw.toLowerCase();
  const identifier =
    plainValue(data, ["id", "ID", "identifier", "IDENTIFIER", "usn", "USN", "studentId", "STUDENT_ID"]) ||
    plainValue(fallback, ["id", "ID", "identifier", "IDENTIFIER", "usn", "USN", "studentId", "STUDENT_ID"]);
  const usn =
    plainValue(data, ["usn", "USN", "studentId", "STUDENT_ID", "id", "ID", "identifier", "IDENTIFIER"]) ||
    plainValue(fallback, ["usn", "USN", "studentId", "STUDENT_ID", "id", "ID", "identifier", "IDENTIFIER"]);

  return {
    version,
    type: qrType === "faculty" ? "faculty" : qrType === "student" ? "student" : "",
    identifier: normalize(identifier).toUpperCase(),
    usn: normalize(usn || identifier).toUpperCase(),
    name: plainValue(data, ["name", "NAME"]) || plainValue(fallback, ["name", "NAME"]),
    phone: plainValue(data, ["phone", "PHONE"]) || plainValue(fallback, ["phone", "PHONE"]),
    email: plainValue(data, ["email", "EMAIL"]) || plainValue(fallback, ["email", "EMAIL"])
  };
}

function finalizeDecoded(decoded) {
  const nested = parseJsonCandidate(decoded.identifier);
  if (!nested) {
    return {
      ...decoded,
      identifier: normalize(decoded.identifier).toUpperCase(),
      usn: normalize(decoded.usn || decoded.identifier).toUpperCase(),
      email: normalize(decoded.email)
    };
  }

  const nestedDecoded = decodeQrObject(nested, "json-in-id");
  return {
    version: nestedDecoded.version,
    type: nestedDecoded.type || decoded.type,
    identifier: nestedDecoded.identifier || normalize(decoded.identifier).toUpperCase(),
    usn: nestedDecoded.usn || nestedDecoded.identifier,
    name: nestedDecoded.name || decoded.name,
    phone: nestedDecoded.phone || decoded.phone,
    email: nestedDecoded.email || decoded.email
  };
}

function parseQr(rawQr) {
  const text = normalize(rawQr);
  if (!text) throw new Error("QR is empty.");

  // JSON QR payload support, including escaped or nested JSON in the ID field.
  const jsonPayload = parseJsonCandidate(text);
  if (jsonPayload) return decodeQrObject(jsonPayload, "json");

  const parts = text.split("|");

  // v2|identifier|name|email|signature
  if (parts.length >= 5 && parts[0] === "v2") {
    return finalizeDecoded({
      version: "v2",
      type: "",
      identifier: normalize(parts[1]).toUpperCase(),
      usn: normalize(parts[1]).toUpperCase(),
      name: normalize(parts[2]),
      phone: "",
      email: normalize(parts[3])
    });
  }

  // v1|identifier|name|signature
  if (parts.length >= 4 && parts[0] === "v1") {
    return finalizeDecoded({
      version: "v1",
      type: "",
      identifier: normalize(parts[1]).toUpperCase(),
      usn: normalize(parts[1]).toUpperCase(),
      name: normalize(parts[2]),
      phone: "",
      email: ""
    });
  }

  // identifier|name
  if (parts.length >= 2) {
    return finalizeDecoded({
      version: "legacy",
      type: "",
      identifier: normalize(parts[0]).toUpperCase(),
      usn: normalize(parts[0]).toUpperCase(),
      name: normalize(parts[1]),
      phone: "",
      email: ""
    });
  }

  return finalizeDecoded({
    version: "legacy",
    type: "",
    identifier: text.toUpperCase(),
    usn: text.toUpperCase(),
    name: "",
    phone: "",
    email: ""
  });
}

function detectPersonType(identifier = "") {
  if (identifier.startsWith("FAC-")) return "faculty";
  if (/^\d{10}$/.test(identifier)) return "faculty";
  return "student";
}

function getPhoneFromId(personType, id) {
  if (personType === "faculty" && /^\d{10}$/.test(id)) return id;
  return "";
}

function buildIdentifierObject(decoded) {
  const usn = normalize(decoded.usn || decoded.identifier).toUpperCase();

  return {
    TYPE: normalize(decoded.type || detectPersonType(usn)).toUpperCase(),
    USN: usn,
    NAME: normalize(decoded.name).toUpperCase(),
    PHONE: normalize(decoded.phone),
    EMAIL: normalize(decoded.email).toUpperCase()
  };
}

function buildStoredIdentifier(decoded, qrText) {
  if (decoded.type || decoded.identifier || decoded.name || decoded.phone || decoded.email) {
    return JSON.stringify(buildIdentifierObject(decoded));
  }

  return normalize(qrText);
}

function buildLegacyIdIdentifier(decoded) {
  const identifier = buildIdentifierObject(decoded);

  return JSON.stringify({
    TYPE: identifier.TYPE,
    ID: identifier.USN,
    NAME: identifier.NAME,
    PHONE: identifier.PHONE,
    EMAIL: identifier.EMAIL
  });
}

function getIdentifierFields(identifier) {
  const parsed = parseJsonCandidate(identifier);
  if (!parsed) {
    return {
      type: "",
      USN: "",
      name: "",
      phoneno: "",
      email: ""
    };
  }

  const decoded = decodeQrObject(parsed, "identifier");

  return {
    type: decoded.type,
    USN: normalize(decoded.usn || decoded.identifier).toUpperCase(),
    name: normalize(decoded.name).toUpperCase(),
    phoneno: normalize(decoded.phone),
    email: normalize(decoded.email).toUpperCase()
  };
}

function getLegacyIdentifiers(qrText, decoded, storedIdentifier) {
  const candidates = [
    normalize(qrText),
    normalize(qrText).toUpperCase(),
    normalize(decoded.identifier),
    normalize(decoded.usn),
    buildLegacyIdIdentifier(decoded),
    storedIdentifier
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function buildAttendanceLookup(payload, dateKey, legacyIdentifiers = []) {
  const identifiers = [payload.id, payload.identifier, payload.USN, payload.usn, ...legacyIdentifiers]
    .map(normalize)
    .filter(Boolean);
  const uniqueIdentifiers = [...new Set(identifiers)];

  return {
    session: payload.session,
    dateKey,
    $or: uniqueIdentifiers.flatMap((value) => [{ id: value }, { identifier: value }, { USN: value }, { usn: value }])
  };
}

function buildAttendancePayload(qrText, session, user) {
  if (!["morning", "afternoon", "evening"].includes(session)) {
    throw new Error("Session must be morning, afternoon or evening.");
  }

  const firstPass = parseQr(qrText);
  const storedIdentifier = buildStoredIdentifier(firstPass, qrText);
  const decoded = parseQr(storedIdentifier);

  if (!decoded.identifier) {
    throw new Error("Invalid QR identifier.");
  }

  const personType = decoded.type || detectPersonType(decoded.identifier);
  const Model = personType === "faculty" ? FacultyAttendance : StudentAttendance;
  const dateKey = getDateKey();
  const identifierFields = getIdentifierFields(storedIdentifier);

  const payload = {
    type: personType,
    id: storedIdentifier,
    identifier: storedIdentifier,
    USN: identifierFields.USN,
    name: identifierFields.name,
    phoneno: identifierFields.phoneno || getPhoneFromId(personType, identifierFields.USN),
    email: identifierFields.email,
    session,
    dateKey,
    scannedAt: new Date(),
    scannedBy: user?.username || user?.role || "volunteer",
    rawQr: qrText,
    decodedVersion: decoded.version
  };

  return { payload, personType, Model, dateKey, legacyIdentifiers: getLegacyIdentifiers(qrText, decoded, storedIdentifier) };
}

function toCsv(rows) {
  const headers = ["name", "email", "USN", "phoneno", "session"];

  function getExportFields(row) {
    const identifierFields = getIdentifierFields(row.identifier || row.id);

    return {
      name: row.name || identifierFields.name,
      email: row.email || identifierFields.email,
      USN: row.USN || row.usn || identifierFields.USN,
      phoneno: row.phoneno || row.phone || identifierFields.phoneno,
      session: row.session
    };
  }

  function getExportValue(row, key) {
    return getExportFields(row)[key];
  }

  const escaped = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((key) => {
          return escaped(getExportValue(row, key));
        })
        .join(",")
    );
  }
  return lines.join("\n");
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    database: {
      readyState: mongoose.connection.readyState,
      name: mongoose.connection.name || null
    }
  });
});

app.post("/api/auth/volunteer-login", (req, res) => {
  const { username, password } = req.body || {};
  if (username !== VOLUNTEER_USERNAME || password !== VOLUNTEER_PASSWORD) {
    return res.status(401).json({ message: "Invalid volunteer credentials." });
  }
  return res.json({ token: signToken("volunteer", username), role: "volunteer" });
});

app.post("/api/auth/admin-login", (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Invalid admin password." });
  }
  return res.json({ token: signToken("admin", "admin"), role: "admin" });
});

app.post("/api/attendance/scan", authRequired, async (req, res) => {
  try {
    const { qrText, session } = req.body || {};
    const { payload, personType, Model, dateKey, legacyIdentifiers } = buildAttendancePayload(qrText, session, req.user);
    const existing = await Model.findOne(buildAttendanceLookup(payload, dateKey, legacyIdentifiers));

    if (existing) {
      return res.status(409).json({
        message: "Attendance already exists for this person/session/date. Use PATCH to update.",
        type: personType
      });
    }

    const result = await Model.create(payload);
    const confirmation = {
      saved: true,
      action: "created",
      message: `Saved ${personType} ${result.name || result.id} for ${result.session} at ${new Date(
        result.scannedAt
      ).toLocaleTimeString()}.`,
      recordId: result._id
    };

    return res.status(201).json({
      ok: true,
      mode: "created",
      type: personType,
      data: result,
      confirmation
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to process scan." });
  }
});

app.patch("/api/attendance/scan", authRequired, async (req, res) => {
  try {
    const { qrText, session } = req.body || {};
    const { payload, personType, Model, dateKey, legacyIdentifiers } = buildAttendancePayload(qrText, session, req.user);

    const result = await Model.findOneAndUpdate(
      buildAttendanceLookup(payload, dateKey, legacyIdentifiers),
      { $set: payload },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({
        message: "Attendance record not found for patch. Use POST first.",
        type: personType
      });
    }

    return res.json({
      ok: true,
      mode: "updated",
      type: personType,
      data: result,
      confirmation: {
        saved: true,
        action: "updated",
        message: `Updated ${personType} ${result.name || result.id} for ${result.session} at ${new Date(
          result.scannedAt
        ).toLocaleTimeString()}.`,
        recordId: result._id
      }
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to process scan." });
  }
});

app.get("/api/attendance/students", authRequired, adminOnly, async (_req, res) => {
  const rows = await StudentAttendance.find().sort({ scannedAt: -1 }).lean();
  res.json(rows);
});

app.get("/api/attendance/faculty", authRequired, adminOnly, async (_req, res) => {
  const rows = await FacultyAttendance.find().sort({ scannedAt: -1 }).lean();
  res.json(rows);
});

app.get("/api/attendance/export/:type", authRequired, adminOnly, async (req, res) => {
  const { type } = req.params;
  let rows = [];
  let filename = "attendance.csv";

  if (type === "students") {
    rows = await StudentAttendance.find().sort({ scannedAt: -1 }).lean();
    filename = "students-attendance.csv";
  } else if (type === "faculty") {
    rows = await FacultyAttendance.find().sort({ scannedAt: -1 }).lean();
    filename = "faculty-attendance.csv";
  } else if (type === "all") {
    const [students, faculty] = await Promise.all([
      StudentAttendance.find().lean(),
      FacultyAttendance.find().lean()
    ]);
    rows = [
      ...students.map((r) => ({ ...r, group: "student" })),
      ...faculty.map((r) => ({ ...r, group: "faculty" }))
    ];
    filename = "all-attendance.csv";
  } else {
    return res.status(400).json({ message: "Invalid export type." });
  }

  const csv = toCsv(rows);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  return res.send(csv);
});

async function connectMongo() {
  const mongoOptions = MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {};

  try {
    await mongoose.connect(MONGODB_URI, mongoOptions);
    console.log(`MongoDB connected using SRV URI. Database: ${mongoose.connection.name}.`);
    return;
  } catch (error) {
    console.warn(`SRV connection failed: ${error.message}`);
    await mongoose.connect(MONGODB_URI_FALLBACK, mongoOptions);
    console.log(`MongoDB connected using fallback URI. Database: ${mongoose.connection.name}.`);
  }
}

connectMongo()
  .then(() => {
    app.listen(PORT, HOST, () => {
      const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
      console.log(`Server running on http://${displayHost}:${PORT} (bound to ${HOST})`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });
