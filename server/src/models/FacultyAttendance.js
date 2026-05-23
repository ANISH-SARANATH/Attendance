const mongoose = require("mongoose");

const facultyAttendanceSchema = new mongoose.Schema(
  {
    // Updated enum to allow Professional
    type: { type: String, default: "faculty", enum: ["student", "faculty", "Professional", "professional"] },
    id: { type: String, required: true, index: true },
    identifier: { type: String, required: true, index: true }, 
    USN: { type: String, default: "", index: true },
    name: { type: String, default: "" },
    phoneno: { type: String, default: "" },
    email: { type: String, default: "" },
    // Added company and designation for Professionals
    company: { type: String, default: "" },
    designation: { type: String, default: "" },
    session: { type: String, enum: ["morning", "afternoon", "evening"], required: true },
    dateKey: { type: String, required: true },
    scannedAt: { type: Date, default: Date.now },
    scannedBy: { type: String, default: "volunteer" },
    rawQr: { type: String, default: "" },
    decodedVersion: { type: String, default: "legacy" }
  },
  { timestamps: true }
);

facultyAttendanceSchema.index({ id: 1, session: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model("FacultyAttendance", facultyAttendanceSchema);