const VALID_SESSIONS = ["morning", "afternoon", "evening"];

const SESSION_LABELS = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening"
};

function normalize(value = "") {
  return String(value ?? "").trim();
}

function normalizeUpper(value = "") {
  return normalize(value).toUpperCase();
}

function normalizeLower(value = "") {
  return normalize(value).toLowerCase();
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

function canonicalPersonType(value = "") {
  const lowered = normalizeLower(value);
  if (lowered === "student" || lowered === "students") return "Student";
  if (lowered === "faculty") return "Faculty";
  if (lowered === "professional" || lowered === "profession") return "Professional";
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

  return {
    version,
    type:
      canonicalPersonType(plainValue(data, ["type", "TYPE", "personType", "PERSON_TYPE"])) ||
      canonicalPersonType(plainValue(fallback, ["type", "TYPE", "personType", "PERSON_TYPE"])),
    id:
      plainValue(data, ["id", "ID", "identifier", "IDENTIFIER", "usn", "USN", "studentId", "STUDENT_ID"]) ||
      plainValue(fallback, ["id", "ID", "identifier", "IDENTIFIER", "usn", "USN", "studentId", "STUDENT_ID"]),
    name: plainValue(data, ["name", "NAME"]) || plainValue(fallback, ["name", "NAME"]),
    phone: plainValue(data, ["phone", "PHONE"]) || plainValue(fallback, ["phone", "PHONE"]),
    email: plainValue(data, ["email", "EMAIL"]) || plainValue(fallback, ["email", "EMAIL"]),
    company: plainValue(data, ["company", "COMPANY"]) || plainValue(fallback, ["company", "COMPANY"]),
    designation:
      plainValue(data, ["designation", "DESIGNATION"]) || plainValue(fallback, ["designation", "DESIGNATION"])
  };
}

function mergeDecoded(primary, secondary) {
  return {
    version: secondary.version || primary.version,
    type: secondary.type || primary.type,
    id: secondary.id || primary.id,
    name: secondary.name || primary.name,
    phone: secondary.phone || primary.phone,
    email: secondary.email || primary.email,
    company: secondary.company || primary.company,
    designation: secondary.designation || primary.designation
  };
}

function finalizeDecoded(decoded) {
  const nested = parseJsonCandidate(decoded.id);
  if (!nested) {
    return {
      version: decoded.version,
      type: decoded.type,
      id: normalize(decoded.id),
      name: normalize(decoded.name),
      phone: normalize(decoded.phone),
      email: normalize(decoded.email).toLowerCase(),
      company: normalize(decoded.company),
      designation: normalize(decoded.designation)
    };
  }

  const nestedDecoded = decodeQrObject(nested, "json-in-id");
  return finalizeDecoded(mergeDecoded(decoded, nestedDecoded));
}

function parseQr(rawQr) {
  const text = normalize(rawQr);
  if (!text) throw new Error("QR is empty.");

  const jsonPayload = parseJsonCandidate(text);
  if (jsonPayload) return finalizeDecoded(decodeQrObject(jsonPayload, "json"));

  const parts = text.split("|");

  if (parts.length >= 5 && parts[0] === "v2") {
    return finalizeDecoded({
      version: "v2",
      type: "",
      id: normalize(parts[1]),
      name: normalize(parts[2]),
      phone: "",
      email: normalize(parts[3]),
      company: "",
      designation: ""
    });
  }

  if (parts.length >= 4 && parts[0] === "v1") {
    return finalizeDecoded({
      version: "v1",
      type: "",
      id: normalize(parts[1]),
      name: normalize(parts[2]),
      phone: "",
      email: "",
      company: "",
      designation: ""
    });
  }

  if (parts.length >= 2) {
    return finalizeDecoded({
      version: "legacy",
      type: "",
      id: normalize(parts[0]),
      name: normalize(parts[1]),
      phone: "",
      email: "",
      company: "",
      designation: ""
    });
  }

  return finalizeDecoded({
    version: "legacy",
    type: "",
    id: text,
    name: "",
    phone: "",
    email: "",
    company: "",
    designation: ""
  });
}

function detectPersonType(decoded) {
  if (decoded.type) return decoded.type;
  if (decoded.company || decoded.designation) return "Professional";

  const candidate = normalizeUpper(decoded.id);
  if (candidate.startsWith("FAC-")) return "Faculty";
  if (/^\d{10}$/.test(candidate)) return "Faculty";
  if (!candidate && (decoded.phone || decoded.email)) return "Faculty";
  return "Student";
}

function publicStudentId(decoded) {
  return normalize(decoded.id) || "Nil";
}

function buildLookupKey(personType, decoded, studentId, qrText) {
  const candidates = [];

  if (personType === "Student") {
    if (normalizeUpper(studentId) !== "NIL") candidates.push(normalizeUpper(studentId));
    candidates.push(normalizeLower(decoded.email));
    candidates.push(normalize(decoded.phone));
    candidates.push(normalizeUpper(decoded.name));
  } else if (personType === "Faculty") {
    candidates.push(normalize(decoded.phone));
    candidates.push(normalizeLower(decoded.email));
    candidates.push(normalizeUpper(decoded.name));
  } else {
    candidates.push(normalizeLower(decoded.email));
    candidates.push(normalize(decoded.phone));
    candidates.push(normalizeUpper(`${decoded.name}|${decoded.company}`));
    candidates.push(normalizeUpper(decoded.name));
  }

  const base = candidates.find(Boolean) || normalizeUpper(qrText);
  return `${personType}:${base}`;
}

function buildLegacyIdentifiers(qrText, personType, decoded, studentId) {
  const identityValue =
    (personType === "Student" ? normalize(studentId) : "") ||
    normalize(decoded.phone) ||
    normalizeLower(decoded.email) ||
    normalize(decoded.name);

  const upperIdentity = normalizeUpper(identityValue);
  const upperEmail = normalizeUpper(decoded.email);
  const upperName = normalizeUpper(decoded.name);
  const upperType = normalizeUpper(personType);
  const values = [
    normalize(qrText),
    normalizeUpper(qrText),
    normalize(decoded.id),
    normalizeUpper(decoded.id),
    JSON.stringify({
      TYPE: upperType,
      USN: upperIdentity,
      NAME: upperName,
      PHONE: normalize(decoded.phone),
      EMAIL: upperEmail
    }),
    JSON.stringify({
      TYPE: upperType,
      ID: upperIdentity,
      NAME: upperName,
      PHONE: normalize(decoded.phone),
      EMAIL: upperEmail
    })
  ].filter(Boolean);

  return [...new Set(values)];
}

function buildLookupCandidates(personType, payload, decoded, studentId) {
  const candidates = [];
  const hasStrongIdentity =
    (personType === "Student" && normalizeUpper(studentId) !== "NIL" && normalize(studentId)) ||
    normalize(payload.phone) ||
    normalizeLower(payload.email);

  if (personType === "Student") {
    candidates.push(normalize(studentId));
    candidates.push(normalizeUpper(studentId));
  }

  candidates.push(normalize(payload.phone));
  candidates.push(normalizeLower(payload.email));
  if (!hasStrongIdentity) {
    candidates.push(normalize(payload.name));
  }
  candidates.push(normalizeUpper(decoded.id));

  return [...new Set(candidates.filter(Boolean))];
}

function getDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function buildAttendancePayload(qrText, session, user, now = new Date()) {
  const safeSession = normalizeLower(session);
  if (!VALID_SESSIONS.includes(safeSession)) {
    throw new Error("Session must be morning, afternoon or evening.");
  }

  const decoded = parseQr(qrText);
  const personType = detectPersonType(decoded);
  const studentId = personType === "Student" ? publicStudentId(decoded) : "";
  const payload = {
    type: personType,
    name: normalize(decoded.name),
    phone: normalize(decoded.phone),
    email: normalizeLower(decoded.email),
    Session: SESSION_LABELS[safeSession],
    dateKey: getDateKey(now),
    lookupKey: buildLookupKey(personType, decoded, studentId, qrText),
    scannedAt: now,
    scannedBy: user?.username || user?.role || "volunteer",
    rawQr: normalize(qrText),
    decodedVersion: decoded.version
  };

  if (personType === "Student") {
    payload.id = studentId;
  }

  if (personType === "Professional") {
    payload.company = normalize(decoded.company);
    payload.designation = normalize(decoded.designation);
  }

  const storageGroup = personType === "Student" ? "student" : "faculty";

  return {
    payload,
    personType,
    storageGroup,
    dateKey: payload.dateKey,
    lookupCandidates: buildLookupCandidates(personType, payload, decoded, studentId),
    legacyIdentifiers: buildLegacyIdentifiers(qrText, personType, decoded, studentId)
  };
}

function uniqueQueryConditions(items, fields) {
  const seen = new Set();
  const conditions = [];

  for (const item of items) {
    const normalizedItem = normalize(item);
    if (!normalizedItem) continue;

    for (const field of fields) {
      const key = `${field}:${normalizedItem}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conditions.push({ [field]: normalizedItem });
    }
  }

  return conditions;
}

function buildAttendanceLookup(descriptor) {
  const { payload, personType, dateKey, lookupCandidates = [], legacyIdentifiers = [] } = descriptor;
  const conditions = [{ lookupKey: payload.lookupKey }];
  const hasStrongIdentity =
    (personType === "Student" && normalizeUpper(payload.id) !== "NIL" && normalize(payload.id)) ||
    normalize(payload.phone) ||
    normalizeLower(payload.email);

  if (personType === "Student") {
    conditions.push(...uniqueQueryConditions([payload.id], ["id", "USN", "usn"]));
  }

  conditions.push(...uniqueQueryConditions([payload.phone], ["phone", "phoneno"]));
  conditions.push(...uniqueQueryConditions([payload.email], ["email"]));
  if (!hasStrongIdentity) {
    conditions.push(...uniqueQueryConditions([payload.name], ["name"]));
  }
  conditions.push(...uniqueQueryConditions(lookupCandidates, ["id", "identifier", "USN", "usn", "phone", "phoneno", "email"]));
  conditions.push(...uniqueQueryConditions(legacyIdentifiers, ["id", "identifier", "USN", "usn"]));

  return {
    Session: payload.Session,
    dateKey,
    $or: conditions
  };
}

module.exports = {
  SESSION_LABELS,
  VALID_SESSIONS,
  buildAttendanceLookup,
  buildAttendancePayload,
  canonicalPersonType,
  parseQr
};
