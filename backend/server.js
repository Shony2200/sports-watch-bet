// backend/server.js
import express from "express";
import cors from "cors";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

const app = express();

// ---- CORS (IMPORTANT) ----
const allowedOrigins = [
  process.env.FRONTEND_URL,      // your Vercel URL (set in Railway Variables)
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      // allow requests with no origin (curl/postman/mobile)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// ---- Health checks (so we can test Railway easily) ----
app.get("/", (req, res) => {
  res.status(200).send("Backend is running ✅");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- Your API routes (WRAP EVERYTHING in try/catch) ----
// IMPORTANT: Replace the inside of these routes with YOUR real logic,
// but KEEP the try/catch so Railway never crashes into 502.

app.get("/api/catalog", async (req, res) => {
  try {
    // TODO: put your real catalog logic here.
    // For now return a safe example so UI has regions/countries.
    // (This prevents blank dropdowns while your data source is fixed.)
    res.json({
      soccer: {
        Europe: {
          England: ["Premier League", "FA Cup", "EFL Cup"],
          Spain: ["La Liga", "Copa del Rey"],
          Italy: ["Serie A", "Coppa Italia"],
          Germany: ["Bundesliga", "DFB-Pokal"],
          France: ["Ligue 1", "Coupe de France"],
          Netherlands: ["Eredivisie"],
          Portugal: ["Primeira Liga"],
          Scotland: ["Premiership"],
          Belgium: ["Pro League"],
          Turkey: ["Süper Lig"],
        },
      },
    });
  } catch (err) {
    console.error("ERROR /api/catalog:", err?.message || err);
    res.status(500).json({ error: "catalog_failed", detail: String(err?.message || err) });
  }
});

app.get("/api/games", async (req, res) => {
  try {
    // TODO: put your real games logic here (axios calls, etc.)
    // Return empty list safely instead of crashing.
    res.json({ games: [] });
  } catch (err) {
    console.error("ERROR /api/games:", err?.message || err);
    res.status(500).json({ error: "games_failed", detail: String(err?.message || err) });
  }
});

// ---- Error handler (prevents silent crashes) ----
app.use((err, req, res, next) => {
  console.error("EXPRESS ERROR:", err?.message || err);
  res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
});

// ---- Server + Socket.IO ----
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  // console.log("socket connected:", socket.id);
  socket.on("disconnect", () => {});
});

// ---- Prevent Node from crashing on async errors ----
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

// ---- Listen (Railway provides PORT=8080) ----
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});