const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

// ---------- CORS (Vercel + local) ----------
const allowedOrigins = [
  process.env.FRONTEND_URL,      // e.g. https://sports-watch-bet-2qac.vercel.app
  "http://localhost:3001",
  "http://localhost:3000",
].filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    // allow requests with no origin (curl, mobile apps)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(express.json());

// ---------- Socket.io (optional) ----------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
});

// ---------- Simple health check ----------
app.get("/", (req, res) => res.send("backend is running"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

/**
 * Catalog:
 * You can expand this list safely without touching ESPN.
 * “key” is what frontend sends back in /api/games?sport=soccer&leagueKey=...
 */
const SOCCER_CATALOG = {
  Europe: {
    England: [
      { name: "Premier League", key: "eng.1" },
      { name: "Championship", key: "eng.2" },
      { name: "FA Cup", key: "eng.fa" },
      { name: "EFL Cup", key: "eng.league_cup" },
    ],
    Spain: [
      { name: "LaLiga", key: "esp.1" },
      { name: "LaLiga 2", key: "esp.2" },
      { name: "Copa del Rey", key: "esp.copa_del_rey" },
      { name: "Supercopa", key: "esp.super_cup" },
    ],
    Italy: [
      { name: "Serie A", key: "ita.1" },
      { name: "Serie B", key: "ita.2" },
      { name: "Coppa Italia", key: "ita.coppa_italia" },
      { name: "Supercoppa", key: "ita.super_cup" },
    ],
    Germany: [
      { name: "Bundesliga", key: "ger.1" },
      { name: "2. Bundesliga", key: "ger.2" },
      { name: "DFB-Pokal", key: "ger.dfb_pokal" },
    ],
    France: [
      { name: "Ligue 1", key: "fra.1" },
      { name: "Ligue 2", key: "fra.2" },
      { name: "Coupe de France", key: "fra.coupe_de_france" },
    ],
    Netherlands: [
      { name: "Eredivisie", key: "ned.1" },
    ],
    Portugal: [
      { name: "Primeira Liga", key: "por.1" },
    ],
    Turkey: [
      { name: "Süper Lig", key: "tur.1" },
    ],
    Greece: [
      { name: "Super League", key: "gre.1" },
    ],
    Scotland: [
      { name: "Premiership", key: "sco.1" },
    ],
    Belgium: [
      { name: "Pro League", key: "bel.1" },
    ],
    Switzerland: [
      { name: "Super League", key: "sui.1" },
    ],
  },

  Americas: {
    USA: [{ name: "MLS", key: "usa.1" }],
    Brazil: [{ name: "Brasileirão", key: "bra.1" }],
    Argentina: [{ name: "Primera División", key: "arg.1" }],
    Mexico: [{ name: "Liga MX", key: "mex.1" }],
  },

  "International": {
    "UEFA": [
      { name: "Champions League", key: "uefa.champions" },
      { name: "Europa League", key: "uefa.europa" },
    ],
  },
};

app.get("/api/catalog", (req, res) => {
  const sport = (req.query.sport || "soccer").toLowerCase();

  if (sport !== "soccer") {
    return res.json({ sport, regions: [], countriesByRegion: {}, leaguesByCountry: {} });
  }

  const regions = Object.keys(SOCCER_CATALOG);
  const countriesByRegion = {};
  const leaguesByCountry = {};

  for (const region of regions) {
    const countries = Object.keys(SOCCER_CATALOG[region]);
    countriesByRegion[region] = countries;
    for (const country of countries) {
      leaguesByCountry[country] = SOCCER_CATALOG[region][country];
    }
  }

  res.json({ sport, regions, countriesByRegion, leaguesByCountry });
});

// ---------- ESPN helpers ----------
async function safeGet(url) {
  try {
    const r = await axios.get(url, { timeout: 15000 });
    return r.data;
  } catch (e) {
    // ESPN often returns 404 when “no games”
    const status = e?.response?.status;
    if (status === 404) return null;
    // Other failures still shouldn’t crash your server:
    console.error("ESPN request failed:", status || e.message, url);
    return null;
  }
}

function normalizeESPNEvents(data) {
  if (!data || !data.events) return [];
  return data.events.map(ev => ({
    id: ev.id,
    name: ev.name,
    date: ev.date,
    status: ev?.status?.type?.description || "",
    shortStatus: ev?.status?.type?.shortDetail || "",
    competitions: ev.competitions || [],
  }));
}

// ---------- Games endpoint ----------
app.get("/api/games", async (req, res) => {
  const sport = (req.query.sport || "nba").toLowerCase();
  const date = req.query.date; // YYYY-MM-DD
  const leagueKey = req.query.leagueKey; // for soccer

  // ESPN wants YYYYMMDD for many scoreboards
  const yyyymmdd = date ? date.replaceAll("-", "") : null;

  try {
    // Soccer
    if (sport === "soccer") {
      // If no leagueKey, return empty list rather than error
      if (!leagueKey) return res.json({ sport, events: [] });

      const url = `https://site.web.api.espn.com/apis/v2/sports/soccer/${leagueKey}/scoreboard` +
        (yyyymmdd ? `?dates=${yyyymmdd}` : "");

      const data = await safeGet(url);
      return res.json({ sport, leagueKey, events: normalizeESPNEvents(data) });
    }

    // NBA / NFL / NHL / MLB
    const sportPath = {
      nba: "basketball/nba",
      nfl: "football/nfl",
      nhl: "hockey/nhl",
      mlb: "baseball/mlb",
    }[sport];

    if (!sportPath) {
      return res.status(400).json({ error: "Unknown sport" });
    }

    const url = `https://site.web.api.espn.com/apis/v2/sports/${sportPath}/scoreboard` +
      (yyyymmdd ? `?dates=${yyyymmdd}` : "");

    const data = await safeGet(url);
    return res.json({ sport, events: normalizeESPNEvents(data) });
  } catch (err) {
    console.error("api/games unexpected error:", err.message);
    // Never 500 the whole frontend for one bad request:
    return res.json({ sport, events: [] });
  }
});

// ---------- start ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});