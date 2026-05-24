const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

dotenv.config();

const StudentAttendance = require("./models/StudentAttendance");
const FacultyAttendance = require("./models/FacultyAttendance");
const { authRequired, adminOnly } = require("./middleware/auth");
const { buildAttendanceLookup, buildAttendancePayload } = require("./services/attendancePayload");
const { flushQueuedSheetSync, syncAttendanceToSheet } = require("./services/sheetSync");

const app = express();
app.use(cors());
app.use(express.json());

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required in server/.env`);
  return value;
}

function optionalEnv(name) {
  return String(process.env[name] || "").trim();
}

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const MONGODB_URI = requiredEnv("MONGODB_URI");
const MONGODB_URI_FALLBACK = optionalEnv("MONGODB_URI_FALLBACK");
const MONGODB_DB_NAME = (process.env.MONGODB_DB_NAME || "test").trim();

const VOLUNTEER_USERNAME = process.env.VOLUNTEER_USERNAME || "volunteer";
const VOLUNTEER_PASSWORD = requiredEnv("VOLUNTEER_PASSWORD");
const ADMIN_PASSWORD = requiredEnv("ADMIN_PASSWORD");
const JWT_SECRET = requiredEnv("JWT_SECRET");

function signToken(role, username) {
  return jwt.sign({ role, username }, JWT_SECRET, {
    expiresIn: "12h"
  });
}

// function toCsv(rows) {
//   const headers = ["name", "email", "USN", "phoneno", "session"];

//   function getExportFields(row) {
//     const identifierFields = getIdentifierFields(row.identifier || row.id);

//     return {
//       name: row.name || identifierFields.name,
//       email: row.email || identifierFields.email,
//       USN: row.USN || row.usn || identifierFields.USN,
//       phoneno: row.phoneno || row.phone || identifierFields.phoneno,
//       session: row.session
//     };
//   }

//   function getExportValue(row, key) {
//     return getExportFields(row)[key];
//   }

//   const escaped = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
//   const lines = [headers.join(",")];
//   for (const row of rows) {
//     lines.push(
//       headers
//         .map((key) => {
//           return escaped(getExportValue(row, key));
//         })
//         .join(",")
//     );
//   }
//   return lines.join("\n");
// }

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
  if ((username && username !== VOLUNTEER_USERNAME) || password !== VOLUNTEER_PASSWORD) {
    return res.status(401).json({ message: "Invalid volunteer credentials." });
  }
  return res.json({ token: signToken("volunteer", VOLUNTEER_USERNAME), role: "volunteer" });
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
    const descriptor = buildAttendancePayload(qrText, session, req.user);
    const Model = descriptor.storageGroup === "student" ? StudentAttendance : FacultyAttendance;
    const existing = await Model.findOne(buildAttendanceLookup(descriptor));

    if (existing) {
      return res.status(409).json({
        message: "Attendance already exists for this person/session/date. Use PATCH to update.",
        type: descriptor.personType
      });
    }

    const result = await Model.create(descriptor.payload);
    const sheetSync = await syncAttendanceToSheet({
      personType: descriptor.personType,
      attendance: result,
      mode: "created",
      recordId: result._id
    });
    const confirmation = {
      saved: true,
      action: "created",
      message: `Saved ${descriptor.personType} ${result.name || result.id || result.phone || result.email} for ${result.Session} at ${new Date(
        result.scannedAt
      ).toLocaleTimeString()}.`,
      recordId: result._id,
      sheetSync
    };

    return res.status(201).json({
      ok: true,
      mode: "created",
      type: descriptor.personType,
      data: result,
      confirmation,
      sheetSync
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to process scan." });
  }
});

app.patch("/api/attendance/scan", authRequired, async (req, res) => {
  try {
    const { qrText, session } = req.body || {};
    const descriptor = buildAttendancePayload(qrText, session, req.user);
    const Model = descriptor.storageGroup === "student" ? StudentAttendance : FacultyAttendance;

    const result = await Model.findOneAndUpdate(
      buildAttendanceLookup(descriptor),
      { $set: descriptor.payload },
      { new: true }
    );

    if (!result) {
      return res.status(404).json({
        message: "Attendance record not found for patch. Use POST first.",
        type: descriptor.personType
      });
    }

    const sheetSync = await syncAttendanceToSheet({
      personType: descriptor.personType,
      attendance: result,
      mode: "updated",
      recordId: result._id
    });

    return res.json({
      ok: true,
      mode: "updated",
      type: descriptor.personType,
      data: result,
      confirmation: {
        saved: true,
        action: "updated",
        message: `Updated ${descriptor.personType} ${result.name || result.id || result.phone || result.email} for ${result.Session} at ${new Date(
          result.scannedAt
        ).toLocaleTimeString()}.`,
        recordId: result._id,
        sheetSync
      },
      sheetSync
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

// app.get("/api/attendance/export/:type", authRequired, adminOnly, async (req, res) => {
//   const { type } = req.params;
//   let rows = [];
//   let filename = "attendance.csv";

//   if (type === "students") {
//     rows = await StudentAttendance.find().sort({ scannedAt: -1 }).lean();
//     filename = "students-attendance.csv";
//   } else if (type === "faculty") {
//     rows = await FacultyAttendance.find().sort({ scannedAt: -1 }).lean();
//     filename = "faculty-attendance.csv";
//   } else if (type === "all") {
//     const [students, faculty] = await Promise.all([
//       StudentAttendance.find().lean(),
//       FacultyAttendance.find().lean()
//     ]);
//     rows = [
//       ...students.map((r) => ({ ...r, group: "student" })),
//       ...faculty.map((r) => ({ ...r, group: "faculty" }))
//     ];
//     filename = "all-attendance.csv";
//   } else {
//     return res.status(400).json({ message: "Invalid export type." });
//   }

//   const csv = toCsv(rows);
//   res.setHeader("Content-Type", "text/csv");
//   res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
//   return res.send(csv);
// });

app.post("/api/attendance/sheet-sync/retry", authRequired, adminOnly, async (_req, res) => {
  const result = await flushQueuedSheetSync();
  res.json(result);
});

async function connectMongo() {
  const mongoOptions = MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {};

  try {
    await mongoose.connect(MONGODB_URI, mongoOptions);
    console.log(`MongoDB connected using SRV URI. Database: ${mongoose.connection.name}.`);
  } catch (error) {
    console.warn(`SRV connection failed: ${error.message}`);
    if (!MONGODB_URI_FALLBACK) throw error;
    await mongoose.connect(MONGODB_URI_FALLBACK, mongoOptions);
    console.log(`MongoDB connected using fallback URI. Database: ${mongoose.connection.name}.`);
  }

  await Promise.all([StudentAttendance.syncIndexes(), FacultyAttendance.syncIndexes()]);
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
