// backend/server.js
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// ---------- CORS allowlist ----------
const allowed = [
  process.env.FRONTEND_URL,          // your Vercel URL
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    // allow requests with no origin (curl, mobile apps)
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  },
  credentials: true,
}));

app.use(express.json());

// ---------- Health / root ----------
app.get("/", (req, res) => {
  res.status(200).send("Backend is running ✅");
});

// ---------- A BIG catalog (static, stable) ----------
const SOCCER_CATALOG = [
  {
    region: "Europe",
    countries: [
      {
        country: "England",
        leagues: ["Premier League", "Championship", "FA Cup", "EFL Cup"],
      },
      {
        country: "Spain",
        leagues: ["La Liga", "Segunda División", "Copa del Rey", "Supercopa de España"],
      },
      {
        country: "Italy",
        leagues: ["Serie A", "Serie B", "Coppa Italia", "Supercoppa Italiana"],
      },
      {
        country: "Germany",
        leagues: ["Bundesliga", "2. Bundesliga", "DFB-Pokal", "DFL-Supercup"],
      },
      {
        country: "France",
        leagues: ["Ligue 1", "Ligue 2", "Coupe de France", "Trophée des Champions"],
      },
      {
        country: "Netherlands",
        leagues: ["Eredivisie", "KNVB Cup"],
      },
      {
        country: "Portugal",
        leagues: ["Primeira Liga", "Taça de Portugal"],
      },
      {
        country: "Scotland",
        leagues: ["Premiership", "Scottish Cup"],
      },
      {
        country: "Belgium",
        leagues: ["Pro League", "Belgian Cup"],
      },
      {
        country: "Turkey",
        leagues: ["Süper Lig", "Turkish Cup"],
      },
      {
        country: "Greece",
        leagues: ["Super League Greece", "Greek Cup"],
      },
      {
        country: "Austria",
        leagues: ["Austrian Bundesliga", "Austrian Cup"],
      },
      {
        country: "Switzerland",
        leagues: ["Swiss Super League", "Swiss Cup"],
      },
      {
        country: "Denmark",
        leagues: ["Danish Superliga", "Danish Cup"],
      },
      {
        country: "Sweden",
        leagues: ["Allsvenskan", "Svenska Cupen"],
      },
      {
        country: "Norway",
        leagues: ["Eliteserien", "NM Cupen"],
      },
      {
        country: "Poland",
        leagues: ["Ekstraklasa", "Polish Cup"],
      },
      {
        country: "Czech Republic",
        leagues: ["Czech First League", "Czech Cup"],
      },
      {
        country: "Ukraine",
        leagues: ["Ukrainian Premier League", "Ukrainian Cup"],
      },
      {
        country: "Croatia",
        leagues: ["HNL", "Croatian Cup"],
      },
    ],
  },
  {
    region: "North America",
    countries: [
      { country: "USA", leagues: ["MLS", "US Open Cup"] },
      { country: "Canada", leagues: ["Canadian Premier League"] },
      { country: "Mexico", leagues: ["Liga MX", "Copa MX"] },
    ],
  },
  {
    region: "South America",
    countries: [
      { country: "Brazil", leagues: ["Brasileirão", "Copa do Brasil"] },
      { country: "Argentina", leagues: ["Liga Profesional", "Copa Argentina"] },
    ],
  },
  {
    region: "Asia",
    countries: [
      { country: "Japan", leagues: ["J1 League"] },
      { country: "South Korea", leagues: ["K League 1"] },
      { country: "Saudi Arabia", leagues: ["Saudi Pro League"] },
    ],
  },
  {
    region: "Africa",
    countries: [
      { country: "South Africa", leagues: ["PSL"] },
      { country: "Egypt", leagues: ["Egyptian Premier League"] },
    ],
  },
  {
    region: "Oceania",
    countries: [
      { country: "Australia", leagues: ["A-League"] },
      { country: "New Zealand", leagues: ["National League"] },
    ],
  },
];

// ---------- API routes ----------
app.get("/api/catalog", async (req, res) => {
  try {
    const sport = (req.query.sport || "soccer").toLowerCase();

    if (sport === "soccer") {
      return res.json({ sport, regions: SOCCER_CATALOG });
    }

    // Non-soccer can be simple (your frontend can still render tabs)
    if (sport === "nba") return res.json({ sport, regions: [] });
    if (sport === "nfl") return res.json({ sport, regions: [] });
    if (sport === "nhl") return res.json({ sport, regions: [] });
    if (sport === "mlb") return res.json({ sport, regions: [] });

    return res.json({ sport, regions: [] });
  } catch (err) {
    console.error("catalog error:", err);
    return res.status(500).json({ error: "catalog_failed", detail: String(err?.message || err) });
  }
});

app.get("/api/games", async (req, res) => {
  try {
    // IMPORTANT:
    // This endpoint must NEVER crash. If your real sports API fails,
    // return [] with a clear error message.
    //
    // For now, return an empty list so your site stops breaking.
    // Later we can wire this to your real data provider.
    return res.json({ games: [] });
  } catch (err) {
    console.error("games error:", err);
    return res.status(500).json({ error: "games_failed", detail: String(err?.message || err), games: [] });
  }
});

// ---------- socket.io ----------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowed,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  // no-op; keep it alive so /socket.io stops 502-ing
  socket.emit("hello", { ok: true });
});

// ---------- start ----------
const PORT = process.env.PORT || 8080;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});