const mongoose = require("mongoose");

const facultyAttendanceSchema = new mongoose.Schema(
  {
    type: { type: String, default: "Faculty", enum: ["Faculty", "Professional"] },
    id: { type: String, default: undefined, select: false },
    name: { type: String, default: "" },
    phone: { type: String, default: "", alias: "phoneno" },
    email: { type: String, default: "" },
    company: { type: String, default: "" },
    designation: { type: String, default: "" },
    Session: { type: String, enum: ["Morning", "Afternoon", "Evening"], required: true, alias: "session" },
    dateKey: { type: String, required: true },
    lookupKey: { type: String, required: true, index: true },
    scannedAt: { type: Date, default: Date.now },
    scannedBy: { type: String, default: "volunteer" },
    rawQr: { type: String, default: "" },
    decodedVersion: { type: String, default: "legacy" },
    identifier: { type: String, default: undefined, select: false },
    USN: { type: String, default: undefined, select: false },
    usn: { type: String, default: undefined, select: false }
  },
  { timestamps: true }
);

facultyAttendanceSchema.index({ lookupKey: 1, Session: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model("FacultyAttendance", facultyAttendanceSchema);
