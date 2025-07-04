import express from "express";
import cors from "cors";
import { TikTokLiveConnection } from "tiktok-live-connector";

const app = express();
const PORT = process.env.PORT || 10000;

// Activer CORS pour tous les domaines (modifiable pour restreindre)
app.use(cors());

// Route API pour vérifier le statut LIVE TikTok
app.get("/api/live-status", async (req, res) => {
  const username = (req.query.user || "").replace(/^@/, "");
  if (!username) {
    return res.status(400).json({ error: "Missing user param" });
  }

  try {
    const conn = new TikTokLiveConnection(username);
    const isLive = await conn.fetchIsLive();
    res.json({ username, isLive });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});
