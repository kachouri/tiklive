import express from "express";
import cors from "cors";
import { TikTokLiveConnection } from "tiktok-live-connector";

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || "20", 10);
const BATCH_LIMIT = parseInt(process.env.BATCH_LIMIT || "300", 10);

// CORS + body parser (JSON limit releve pour batches)
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Single-user live check (kept for backward compat with cashback UI)
async function checkLive(username) {
  const u = (username || "").replace(/^@/, "").trim();
  if (!u) return { username: u, isLive: false };
  try {
    const conn = new TikTokLiveConnection(u);
    const isLive = await conn.fetchIsLive();
    return { username: u, isLive };
  } catch (err) {
    return { username: u, isLive: false };
  }
}

// Route unitaire (inchangee — utilisee par la page cashback)
app.get("/api/live-status", async (req, res) => {
  const username = (req.query.user || "").replace(/^@/, "");
  if (!username) {
    return res.status(400).json({ error: "Missing user param" });
  }
  try {
    const result = await checkLive(username);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Route batch (nouvelle — pour check_leads_live.py cron)
// POST body: { "users": ["user1","user2",...] } -> [ {username, isLive}, ... ]
app.post("/api/live-status/batch", async (req, res) => {
  const users = (req.body && req.body.users) || [];
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: "users must be an array" });
  }
  const sliced = users.slice(0, BATCH_LIMIT);
  const results = [];
  for (let i = 0; i < sliced.length; i += MAX_CONCURRENT) {
    const chunk = sliced.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.all(chunk.map(checkLive));
    results.push(...chunkResults);
  }
  res.json(results);
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT} (batch limit ${BATCH_LIMIT}, concurrency ${MAX_CONCURRENT})`);
});
