import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || "15", 10);
const BATCH_LIMIT = parseInt(process.env.BATCH_LIMIT || "300", 10);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const TIKTOK_UA = "TikTok 33.0.3 rv:330003 (iPhone; iOS 17.0; en_US) Cronet";

// Check live by scraping profile HTML and matching roomId.
// More reliable than tiktok-live-connector for some users (some show roomId
// in profile page but are not detected via webcast.fetchIsLive).
async function checkLive(username) {
  const u = (username || "").replace(/^@/, "").trim();
  if (!u) return { username: u, isLive: false };
  try {
    const r = await axios.get(`https://www.tiktok.com/@${encodeURIComponent(u)}`, {
      headers: {
        "User-Agent": TIKTOK_UA,
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (r.status !== 200 || typeof r.data !== "string") {
      return { username: u, isLive: false };
    }
    const m = r.data.match(/"roomId":"([0-9]+)"/);
    const roomId = m ? m[1] : "";
    const isLive = !!(roomId && roomId !== "0");
    return { username: u, isLive, roomId };
  } catch (err) {
    return { username: u, isLive: false };
  }
}

// Route unitaire (inchangee — utilisee par la page cashback UI)
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

// Route batch (pour check_leads_live.py cron)
// POST body: { "users": ["user1","user2",...] } -> [ {username, isLive, roomId}, ... ]
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

// Health + diagnostic
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Diagnostic: voir ce que Render recoit depuis tiktok.com
// (utile pour debugger les faux negatifs)
app.get("/debug/fetch", async (req, res) => {
  const u = (req.query.user || "").replace(/^@/, "");
  if (!u) return res.status(400).json({ error: "Missing user" });
  try {
    const r = await axios.get(`https://www.tiktok.com/@${encodeURIComponent(u)}`, {
      headers: { "User-Agent": TIKTOK_UA, "Accept-Language": "en-US,en;q=0.9" },
      timeout: 10000,
      validateStatus: () => true,
    });
    const bodyStr = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    const m = bodyStr.match(/"roomId":"([0-9]+)"/);
    res.json({
      status: r.status,
      bodyLen: bodyStr.length,
      hasAccessDenied: bodyStr.includes("Access Denied"),
      hasUniversalData: bodyStr.includes("UNIVERSAL_DATA_FOR_REHYDRATION"),
      roomId: m ? m[1] : null,
      bodyPreview: bodyStr.slice(0, 300),
    });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT} (batch limit ${BATCH_LIMIT}, concurrency ${MAX_CONCURRENT})`);
});
