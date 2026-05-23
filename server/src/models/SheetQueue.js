const mongoose = require("mongoose");

const sheetQueueSchema = new mongoose.Schema({
  personType: String,
  mode: String,
  recordId: String,
  record: mongoose.Schema.Types.Mixed, // Stores the exact JSON payload
  reason: String,
  queuedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("SheetQueue", sheetQueueSchema);