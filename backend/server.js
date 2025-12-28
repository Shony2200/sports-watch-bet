// backend/server.js
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// ----- CORS -----
const allowedOrigins = [
  process.env.FRONTEND_URL,        // your Vercel URL
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    // allow requests with no origin (curl/postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS: " + origin));
  },
  credentials: true,
}));

app.use(express.json());

// ----- Health / root -----
app.get("/", (req, res) => res.status(200).send("Backend is running ✅"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ----- STATIC CATALOG (regions -> countries -> leagues) -----
// This guarantees your dropdowns populate again.
const catalog = {
  soccer: {
    Europe: {
      England: ["Premier League", "Championship", "FA Cup", "EFL Cup"],
      Spain: ["La Liga", "Segunda División", "Copa del Rey", "Supercopa de España"],
      Italy: ["Serie A", "Serie B", "Coppa Italia", "Supercoppa Italiana"],
      Germany: ["Bundesliga", "2. Bundesliga", "DFB-Pokal"],
      France: ["Ligue 1", "Ligue 2", "Coupe de France"],
      Portugal: ["Primeira Liga", "Taça de Portugal"],
      Netherlands: ["Eredivisie", "KNVB Beker"],
      Belgium: ["Pro League", "Croky Cup"],
      Scotland: ["Premiership", "Scottish Cup"],
      Turkey: ["Süper Lig", "Turkish Cup"],
      Greece: ["Super League", "Greek Cup"],
      Ukraine: ["Premier League"],
      Poland: ["Ekstraklasa", "Polish Cup"],
      Austria: ["Bundesliga", "ÖFB-Cup"],
      Switzerland: ["Super League", "Swiss Cup"],
      Sweden: ["Allsvenskan", "Svenska Cupen"],
      Norway: ["Eliteserien", "NM Cup"],
      Denmark: ["Superliga", "DBU Pokalen"],
    },
    Americas: {
      USA: ["MLS", "US Open Cup"],
      Mexico: ["Liga MX", "Copa MX"],
      Brazil: ["Brasileirão Série A", "Copa do Brasil"],
      Argentina: ["Liga Profesional", "Copa Argentina"],
      Colombia: ["Categoría Primera A"],
    },
    Asia: {
      Japan: ["J1 League"],
      SouthKorea: ["K League 1"],
      SaudiArabia: ["Saudi Pro League", "King's Cup"],
    },
    Africa: {
      Egypt: ["Egyptian Premier League"],
      Morocco: ["Botola Pro"],
      SouthAfrica: ["Premier Division"],
    },
    International: {
      UEFA: ["Champions League", "Europa League", "Conference League", "Euro Qualifiers", "Nations League"],
      FIFA: ["World Cup Qualifiers"],
    }
  },
  nba: { leagues: ["NBA"] },
  nfl: { leagues: ["NFL"] },
  nhl: { leagues: ["NHL"] },
  mlb: { leagues: ["MLB"] },
};

// Return catalog the frontend can use
app.get("/api/catalog", (req, res) => {
  const sport = (req.query.sport || "soccer").toLowerCase();
  const data = catalog[sport];
  if (!data) return res.status(404).json({ error: "Unknown sport" });
  res.json({ sport, data });
});

// ----- SAMPLE GAMES -----
// You’ll see games again instead of errors. Replace this later with your real provider.
const sampleGames = [
  { id: "1", sport: "soccer", league: "Premier League", home: "Arsenal", away: "Chelsea", status: "Today", time: "20:00" },
  { id: "2", sport: "soccer", league: "Copa del Rey", home: "Real Madrid", away: "Valencia", status: "Today", time: "19:00" },
  { id: "3", sport: "soccer", league: "Coppa Italia", home: "Inter", away: "Juventus", status: "Live", time: "55'" },
  { id: "4", sport: "nba", league: "NBA", home: "Lakers", away: "Warriors", status: "Today", time: "22:00" },
  { id: "5", sport: "nfl", league: "NFL", home: "Chiefs", away: "Bills", status: "Finished", time: "24-21" },
  { id: "6", sport: "mlb", league: "MLB", home: "Yankees", away: "Red Sox", status: "Today", time: "18:10" },
];

app.get("/api/games", (req, res) => {
  const sport = (req.query.sport || "soccer").toLowerCase();
  const region = req.query.region;
  const country = req.query.country;
  const league = req.query.league;
  const status = req.query.status; // Today | Live | Finished

  let out = sampleGames.filter(g => g.sport === sport);
  if (league) out = out.filter(g => g.league === league);
  if (status) out = out.filter(g => g.status.toLowerCase() === status.toLowerCase());

  // (region/country are not used in sampleGames, but kept for API compatibility)
  res.json({ sport, region, country, league, status, games: out });
});

// ----- Socket.IO -----
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});

io.on("connection", (socket) => {
  socket.emit("hello", { ok: true });
});

// ----- Start -----
const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});

// Catch crashes so Railway logs show them
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));