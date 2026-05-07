const mongoose = require("mongoose");

const studentAttendanceSchema = new mongoose.Schema(
  {
    type: { type: String, default: "student", enum: ["student", "faculty"] },
    id: { type: String, required: true, index: true },
    identifier: { type: String, required: true, index: true }, // kept for compatibility
    USN: { type: String, default: "", index: true },
    name: { type: String, default: "" },
    phoneno: { type: String, default: "" },
    email: { type: String, default: "" },
    session: { type: String, enum: ["morning", "afternoon", "evening"], required: true },
    dateKey: { type: String, required: true },
    scannedAt: { type: Date, default: Date.now },
    scannedBy: { type: String, default: "volunteer" },
    rawQr: { type: String, default: "" },
    decodedVersion: { type: String, default: "legacy" }
  },
  { timestamps: true }
);

studentAttendanceSchema.index({ id: 1, session: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model("StudentAttendance", studentAttendanceSchema);
