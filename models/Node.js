const mongoose = require("mongoose");

const nodeSchema = new mongoose.Schema({
  userId: String,
  nodeId: {
    type: String,
    required: true,
  },

  type: {
    type: String, // "source" | "analysis" 
    required: true,
  },

  subject: String,
  section: String,

  title: String,
  content: String,
  quote: String, // Legacy: kept for migration compatibility
  analysis: String, // For source nodes

  // For analysis nodes:
  // NEW: stores array of quote references
  quoteRefs: [{
    quoteId: String,
    section: String,
    quote: String
  }],

  link: {
    quote: String,
    analysis: String,
  },

  meta: Object,
  updatedAt: {
    type: Date,
    default: Date.now,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

nodeSchema.index({ userId: 1, nodeId: 1 }, { unique: true });
nodeSchema.index({ userId: 1, type: 1 });
nodeSchema.index({ userId: 1, subject: 1 });

// Create separate Quote schema for backend
const quoteSchema = new mongoose.Schema({
  userId: String,
  quoteId: {
    type: String,
    required: true,
  },

  type: {
    type: String,
    default: "quote",
    required: true,
  },

  subject: String,
  section: String,
  title: String,

  quote: String, // The actual quoted text

  // Source reference: where this quote comes from
  link: {
    sourceId: String,
    start: Number,  // Character position in source
    end: Number,
  },

  meta: {
    hierarchyPath: [String],
    sourceOrder: Number,
    tags: [String],
    analysisNodeIds: [String], // Which analyses reference this quote
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

quoteSchema.index({ userId: 1, quoteId: 1 }, { unique: true });
quoteSchema.index({ userId: 1, subject: 1 });
quoteSchema.index({ userId: 1, "link.sourceId": 1 });

module.exports = mongoose.model("Node", nodeSchema);
module.exports.Quote = mongoose.model("Quote", quoteSchema);
