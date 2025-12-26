// backend/server.js
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();

/**
 * ✅ CORS
 * Put your Vercel URL into Railway env var FRONTEND_URL
 * Example: https://sports-watch-bet-2qac.vercel.app
 */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3001",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (curl, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

app.use(express.json());

/** ✅ Health */
app.get("/", (req, res) => res.send("Backend running ✅"));
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * ✅ Soccer catalog (regions → countries → leagues)
 * This is a “curated” list that ESPN supports well.
 * You can add more league codes over time.
 */
const SOCCER_CATALOG = [
  {
    region: "Europe",
    countries: [
      {
        country: "England",
        leagues: [
          { league: "Premier League", leagueCode: "eng.1" },
          { league: "Championship", leagueCode: "eng.2" },
        ],
      },
      {
        country: "Spain",
        leagues: [
          { league: "LaLiga", leagueCode: "esp.1" },
          { league: "LaLiga 2", leagueCode: "esp.2" },
        ],
      },
      {
        country: "Italy",
        leagues: [
          { league: "Serie A", leagueCode: "ita.1" },
          { league: "Serie B", leagueCode: "ita.2" },
        ],
      },
      {
        country: "Germany",
        leagues: [
          { league: "Bundesliga", leagueCode: "ger.1" },
          { league: "2. Bundesliga", leagueCode: "ger.2" },
        ],
      },
      {
        country: "France",
        leagues: [
          { league: "Ligue 1", leagueCode: "fra.1" },
          { league: "Ligue 2", leagueCode: "fra.2" },
        ],
      },
      {
        country: "Portugal",
        leagues: [{ league: "Primeira Liga", leagueCode: "por.1" }],
      },
      {
        country: "Netherlands",
        leagues: [{ league: "Eredivisie", leagueCode: "ned.1" }],
      },
      {
        country: "Scotland",
        leagues: [{ league: "Premiership", leagueCode: "sco.1" }],
      },
      {
        country: "Turkey",
        leagues: [{ league: "Süper Lig", leagueCode: "tur.1" }],
      },
    ],
  },
  {
    region: "North America",
    countries: [
      {
        country: "USA/Canada",
        leagues: [
          { league: "MLS", leagueCode: "usa.1" },
          { league: "Liga MX", leagueCode: "mex.1" },
        ],
      },
    ],
  },
  {
    region: "South America",
    countries: [
      {
        country: "Brazil",
        leagues: [{ league: "Brasileirão", leagueCode: "bra.1" }],
      },
      {
        country: "Argentina",
        leagues: [{ league: "Liga Profesional", leagueCode: "arg.1" }],
      },
    ],
  },
  {
    region: "Asia",
    countries: [
      {
        country: "Saudi Arabia",
        leagues: [{ league: "Saudi Pro League", leagueCode: "ksa.1" }], // Al Nassr / Ronaldo
      },
      {
        country: "Japan",
        leagues: [{ league: "J1 League", leagueCode: "jpn.1" }],
      },
      {
        country: "South Korea",
        leagues: [{ league: "K League 1", leagueCode: "kor.1" }],
      },
    ],
  },
];

app.get("/api/catalog", (req, res) => {
  const sport = String(req.query.sport || "");
  if (sport !== "soccer") return res.json({ regions: [] });
  return res.json({ regions: SOCCER_CATALOG });
});

/** ✅ Helpers */
function isValidISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isoToEspnDate(iso) {
  // "2025-12-26" -> "20251226"
  return iso.replaceAll("-", "");
}

/**
 * ✅ ESPN fetch (works for NBA/NFL/NHL/MLB and Soccer)
 * Uses https://site.api.espn.com which is the most reliable.
 */
async function fetchEspnScoreboard({ sportKey, leagueKey, dateYYYYMMDD }) {
  // Examples:
  // NBA:   https://site.api.espn.com/apis/v2/sports/basketball/nba/scoreboard?dates=20251226
  // Soccer: https://site.api.espn.com/apis/v2/sports/soccer/esp.1/scoreboard?dates=20251226
  const url = `https://site.api.espn.com/apis/v2/sports/${sportKey}/${leagueKey}/scoreboard?dates=${dateYYYYMMDD}`;
  const r = await axios.get(url, { timeout: 15000 });
  return r.data;
}

function normalizeEventsToGames({ data, sport, leagueLabel, country }) {
  const events = data?.events || [];
  return events.map((ev) => {
    const comp = ev?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");

    return {
      id: ev.id,
      sport,
      league: leagueLabel || data?.leagues?.[0]?.name || "",
      country: country || "",
      startTime: ev.date,
      status: comp?.status?.type?.shortDetail || comp?.status?.type?.description || "",
      home: home?.team?.displayName || "Home",
      away: away?.team?.displayName || "Away",
      homeScore: home?.score != null ? Number(home.score) : null,
      awayScore: away?.score != null ? Number(away.score) : null,
      penalties: null,
    };
  });
}

/**
 * ✅ /api/games
 * Query: sport=soccer|nba|nfl|nhl|mlb
 * date=YYYY-MM-DD
 * optional: leagueCode (soccer only)
 */
app.get("/api/games", async (req, res) => {
  try {
    const sport = String(req.query.sport || "").toLowerCase();
    const date = String(req.query.date || "");

    if (!isValidISODate(date)) {
      return res.status(400).json({ error: "Games request failed", details: "Bad date (use YYYY-MM-DD)" });
    }
    const dateYYYYMMDD = isoToEspnDate(date);

    // Map sports to ESPN sport/league keys
    const map = {
      nba: { sportKey: "basketball", leagueKey: "nba", label: "NBA", country: "United States" },
      nfl: { sportKey: "football", leagueKey: "nfl", label: "NFL", country: "United States" },
      nhl: { sportKey: "hockey", leagueKey: "nhl", label: "NHL", country: "United States/Canada" },
      mlb: { sportKey: "baseball", leagueKey: "mlb", label: "MLB", country: "United States" },
    };

    if (sport === "soccer") {
      // Soccer: if leagueCode provided, fetch that league only
      const leagueCode = String(req.query.leagueCode || "").trim();
      const codes = leagueCode
        ? [leagueCode]
        : [
            // “Popular mix” fallback
            "eng.1",
            "esp.1",
            "ita.1",
            "ger.1",
            "fra.1",
            "usa.1",
            "mex.1",
            "ksa.1",
          ];

      const all = [];

      for (const code of codes) {
        // Find label/country from catalog
        let leagueLabel = code;
        let country = "";
        for (const region of SOCCER_CATALOG) {
          for (const c of region.countries) {
            const found = c.leagues.find((l) => l.leagueCode === code);
            if (found) {
              leagueLabel = found.league;
              country = c.country;
            }
          }
        }

        try {
          const data = await fetchEspnScoreboard({
            sportKey: "soccer",
            leagueKey: code,
            dateYYYYMMDD,
          });
          const games = normalizeEventsToGames({ data, sport: "soccer", leagueLabel, country });
          all.push(...games);
        } catch (e) {
          const status = e?.response?.status;
          console.log("ESPN soccer league failed:", code, status || e?.message);
          // skip bad leagues
        }
      }

      return res.json({ games: all });
    }

    // Other sports
    const m = map[sport];
    if (!m) {
      return res.status(400).json({ error: "Games request failed", details: "Unknown sport" });
    }

    const data = await fetchEspnScoreboard({
      sportKey: m.sportKey,
      leagueKey: m.leagueKey,
      dateYYYYMMDD,
    });

    const games = normalizeEventsToGames({
      data,
      sport,
      leagueLabel: m.label,
      country: m.country,
    });

    res.json({ games });
  } catch (e) {
    console.log("API /api/games error:", e?.response?.status, e?.message);
    return res.status(500).json({
      error: "Games request failed",
      details: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 200) : e?.message || "Server error",
    });
  }
});

/** ✅ Socket.IO */
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

const rooms = {}; // roomId -> { users:[], bets:[], match }

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, username, match }) => {
    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = { users: [], bets: [], match: match || null };
    rooms[roomId].match = match || rooms[roomId].match;

    // add user if not already
    const exists = rooms[roomId].users.find((u) => u.id === socket.id);
    if (!exists) rooms[roomId].users.push({ id: socket.id, username, credits: 1000 });

    io.to(roomId).emit("room-state", rooms[roomId]);
    socket.to(roomId).emit("peer-joined", { peerId: socket.id });
  });

  socket.on("chatMessage", ({ roomId, user, text }) => {
    io.to(roomId).emit("message", { user, text });
  });

  socket.on("signal", ({ to, from, data }) => {
    io.to(to).emit("signal", { from, data });
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const before = rooms[roomId].users.length;
      rooms[roomId].users = rooms[roomId].users.filter((u) => u.id !== socket.id);
      if (rooms[roomId].users.length !== before) {
        io.to(roomId).emit("room-state", rooms[roomId]);
        io.to(roomId).emit("peer-left", { peerId: socket.id });
      }
      if (rooms[roomId].users.length === 0) delete rooms[roomId];
    }
  });
});

/** ✅ Listen */
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});