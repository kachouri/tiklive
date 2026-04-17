import express from "express";
import cors from "cors";
import { TikTokLiveConnection } from "tiktok-live-connector";

const app = express();
const PORT = process.env.PORT || 10000;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || "15", 10);
const BATCH_LIMIT = parseInt(process.env.BATCH_LIMIT || "300", 10);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Live check via tiktok-live-connector (bypasse Akamai — utilise webcast + signature Eulerstream).
// Produit parfois des faux negatifs (users avec roomId dans HTML mais fetchIsLive=false)
// MAIS c'est la seule methode qui passe sur Render (www.tiktok.com est bloque par Akamai).
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

// Route batch (nouvelle)
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

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT} (batch limit ${BATCH_LIMIT}, concurrency ${MAX_CONCURRENT})`);
});
