const mongoose = require("mongoose");

const studentAttendanceSchema = new mongoose.Schema(
  {
    type: { type: String, default: "Student", enum: ["Student"] },
    id: { type: String, default: "Nil", index: true },
    name: { type: String, default: "" },
    phone: { type: String, default: "", alias: "phoneno" },
    email: { type: String, default: "" },
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

studentAttendanceSchema.index({ lookupKey: 1, Session: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model("StudentAttendance", studentAttendanceSchema);
