const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const TESTS_PATH = process.env.TESTS_PATH || path.join(__dirname, "tests.json");

function getAssignedVariant(userId, experimentId) {
  try {
    const data = JSON.parse(fs.readFileSync(TESTS_PATH, "utf-8"));
    const experiment = data.experiments.find((e) => e.id === experimentId);
    if (!experiment || !experiment.active) return null;
    const hash = crypto.createHash("md5").update(userId + experimentId).digest("hex");
    const bucket = parseInt(hash.substring(0, 8), 16) % 100;
    return bucket < 50 ? experiment.variants[0] : experiment.variants[1];
  } catch (err) {
    console.error("Error reading tests.json:", err);
    return null;
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "analytics" });
});

app.get("/variant", (req, res) => {
  const userId = req.query.userId;
  const experimentId = req.query.experimentId;
  if (!userId || !experimentId) {
    return res.status(400).json({ error: "userId and experimentId required" });
  }
  const variant = getAssignedVariant(userId, experimentId);
  res.json({ variant });
});

app.post("/exposure", (req, res) => {
  const { userId, experimentId, variant } = req.body || {};
  if (!userId || !experimentId || !variant) {
    return res.status(400).json({ error: "userId, experimentId, variant required" });
  }
  const timestamp = new Date().toISOString();
  console.log(`[AB_LOG_EXPOSURE] ${timestamp} | User: ${userId} | Test: ${experimentId} | Variant: ${variant}`);
  res.json({ ok: true });
});

app.post("/event", (req, res) => {
  const { userId, eventName, variant } = req.body || {};
  if (!userId || !eventName || !variant) {
    return res.status(400).json({ error: "userId, eventName, variant required" });
  }
  const timestamp = new Date().toISOString();
  console.log(`[AB_LOG_EVENT] ${timestamp} | User: ${userId} | Event: ${eventName} | Variant: ${variant}`);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Analytics service listening on port ${PORT}`);
});
