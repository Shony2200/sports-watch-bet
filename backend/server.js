// backend/server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const axios = require("axios");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3001"
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (mobile apps, curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

// ---------- Helpers ----------
function yyyymmddFromISO(isoDate) {
  const [y, m, d] = String(isoDate || "").split("-");
  if (!y || !m || !d) return null;
  return `${y}${m}${d}`;
}

function safeNum(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normStatus(statusType) {
  // ESPN status object: event.status.type.*
  const name = String(statusType?.name || "").toUpperCase(); // e.g. STATUS_FINAL, STATUS_IN_PROGRESS
  const detail = String(statusType?.detail || "").toUpperCase(); // e.g. "Final", "2nd Half", "9:00 PM"

  if (name.includes("FINAL") || detail.includes("FINAL")) return "FT";
  if (name.includes("IN_PROGRESS") || detail.includes("IN PROGRESS") || detail.includes("LIVE")) return "LIVE";
  if (detail.includes("HALF")) return "HT";
  if (name.includes("SCHEDULED") || name.includes("PRE") || detail.includes("PM") || detail.includes("AM")) return "SCHEDULED";
  return statusType?.detail || statusType?.name || "";
}

function pickSoccerPenInfo(competition) {
  // ESPN sometimes returns shootoutScore on competitors for pen shootouts
  try {
    const comps = competition?.competitors || [];
    const home = comps.find((c) => c.homeAway === "home");
    const away = comps.find((c) => c.homeAway === "away");
    const hs = safeNum(home?.shootoutScore);
    const as = safeNum(away?.shootoutScore);
    if (hs === null || as === null) return null;
    return { homePens: hs, awayPens: as };
  } catch {
    return null;
  }
}

function mapEspnEventToGame({ event, sportKey, leagueLabel, country, leagueCode }) {
  const comp = event?.competitions?.[0];
  const competitors = comp?.competitors || [];
  const homeC = competitors.find((c) => c.homeAway === "home");
  const awayC = competitors.find((c) => c.homeAway === "away");

  const home = homeC?.team?.displayName || homeC?.team?.name || "Home";
  const away = awayC?.team?.displayName || awayC?.team?.name || "Away";

  const homeScore = safeNum(homeC?.score);
  const awayScore = safeNum(awayC?.score);

  const startTime = comp?.date || event?.date || "";
  const status = normStatus(comp?.status?.type || event?.status?.type || {});

  const pens = sportKey === "soccer" ? pickSoccerPenInfo(comp) : null;

  return {
    id: String(event?.id || ""),
    sport: sportKey,
    home,
    away,
    startTime,
    status,
    homeScore,
    awayScore,
    league: leagueLabel || "",
    leagueCode: leagueCode || "",
    country: country || "",
    penalties: pens, // {homePens, awayPens} | null
  };
}

// ---------- Soccer Catalog (you can add more rows anytime) ----------
const SOCCER_CATALOG = [
  // CONTINENT / INTERNATIONAL
  { region: "Europe", country: "Europe", league: "UEFA Champions League", leagueCode: "uefa.champions" },
  { region: "Europe", country: "Europe", league: "UEFA Europa League", leagueCode: "uefa.europa" },
  { region: "Europe", country: "Europe", league: "UEFA Conference League", leagueCode: "uefa.conf" },

  { region: "Asia", country: "Asia", league: "AFC Champions League Elite", leagueCode: "afc.champions" },
  { region: "Africa", country: "Africa", league: "CAF Champions League", leagueCode: "caf.champions" },

  { region: "North America", country: "North America", league: "CONCACAF Champions Cup", leagueCode: "concacaf.champions" },
  { region: "South America", country: "South America", league: "CONMEBOL Libertadores", leagueCode: "conmebol.libertadores" },

  // EUROPE
  { region: "Europe", country: "England", league: "Premier League", leagueCode: "eng.1" },
  { region: "Europe", country: "England", league: "Championship", leagueCode: "eng.2" },
  { region: "Europe", country: "England", league: "FA Cup", leagueCode: "eng.fa" },
  { region: "Europe", country: "England", league: "EFL Cup", leagueCode: "eng.lcup" },

  { region: "Europe", country: "Spain", league: "LaLiga", leagueCode: "esp.1" },
  { region: "Europe", country: "Spain", league: "LaLiga 2", leagueCode: "esp.2" },
  { region: "Europe", country: "Spain", league: "Copa del Rey", leagueCode: "esp.copa_del_rey" },

  { region: "Europe", country: "Italy", league: "Serie A", leagueCode: "ita.1" },
  { region: "Europe", country: "Germany", league: "Bundesliga", leagueCode: "ger.1" },
  { region: "Europe", country: "France", league: "Ligue 1", leagueCode: "fra.1" },
  { region: "Europe", country: "Portugal", league: "Primeira Liga", leagueCode: "por.1" },

  // AMERICAS
  { region: "North America", country: "United States", league: "MLS", leagueCode: "usa.1" },
  { region: "North America", country: "Mexico", league: "Liga MX", leagueCode: "mex.1" },
  { region: "South America", country: "Brazil", league: "Brazil Serie A", leagueCode: "bra.1" },
  { region: "South America", country: "Argentina", league: "Argentina Primera", leagueCode: "arg.1" },

  // ASIA / MIDDLE EAST
  { region: "Asia", country: "Saudi Arabia", league: "Saudi Pro League", leagueCode: "ksa.1" },
  { region: "Asia", country: "Japan", league: "J1 League", leagueCode: "jpn.1" },
];

function buildSoccerCatalogTree() {
  const regions = new Map(); // region -> Map(country -> leagues[])
  for (const item of SOCCER_CATALOG) {
    if (!regions.has(item.region)) regions.set(item.region, new Map());
    const countries = regions.get(item.region);
    if (!countries.has(item.country)) countries.set(item.country, []);
    countries.get(item.country).push({ league: item.league, leagueCode: item.leagueCode });
  }

  const out = [];
  for (const [region, countriesMap] of regions.entries()) {
    const countriesArr = [];
    for (const [country, leagues] of countriesMap.entries()) {
      leagues.sort((a, b) => a.league.localeCompare(b.league));
      countriesArr.push({ country, leagues });
    }
    countriesArr.sort((a, b) => a.country.localeCompare(b.country));
    out.push({ region, countries: countriesArr });
  }

  const priority = ["Europe", "Asia", "Africa", "North America", "South America", "Oceania"];
  out.sort((a, b) => {
    const ai = priority.indexOf(a.region);
    const bi = priority.indexOf(b.region);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.region.localeCompare(b.region);
  });

  return out;
}

// ---------- ESPN fetch (FIXED URLs) ----------
async function fetchEspnScoreboard({ sportKey, espnSportPath, leagueLabel, country, leagueCode, isoDate }) {
  const dates = yyyymmddFromISO(isoDate);
  if (!dates) throw new Error("Bad date");

  // ✅ Correct ESPN base path: /apis/site/v2/...
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSportPath}/scoreboard?dates=${dates}`;

  let data;
  try {
    const resp = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
    data = resp.data;
  } catch (e) {
    const status = e?.response?.status;
    throw new Error(`ESPN returned status ${status || "?"}`);
  }

  const events = data?.events || [];
  return events.map((event) =>
    mapEspnEventToGame({
      event,
      sportKey,
      leagueLabel,
      country,
      leagueCode,
    })
  );
}

// ---------- Routes ----------
app.get("/", (req, res) => res.send("Backend is running 🚀"));

app.get("/api/catalog", (req, res) => {
  const sport = String(req.query.sport || "soccer");
  if (sport !== "soccer") return res.json({ regions: [] });
  return res.json({ regions: buildSoccerCatalogTree() });
});

app.get("/api/games", async (req, res) => {
  try {
    const sport = String(req.query.sport || "soccer");
    const date = String(req.query.date || "");
    const leagueCode = String(req.query.leagueCode || "");

    // -------- Soccer --------
    if (sport === "soccer") {
      // If user picked a league, fetch only that
      const codes = leagueCode
        ? [leagueCode]
        : [
            // Popular mix when no league selected
            "uefa.champions",
            "eng.1",
            "esp.1",
            "ita.1",
            "ger.1",
            "fra.1",
            "usa.1",
            "ksa.1",
          ];

      const all = [];
      for (const code of codes) {
        const cat = SOCCER_CATALOG.find((x) => x.leagueCode === code);
        const lLabel = cat?.league || code;
        const ctry = cat?.country || "";

        try {
          // ✅ Soccer league is part of path: soccer/{leagueCode}
          const games = await fetchEspnScoreboard({
            sportKey: "soccer",
            espnSportPath: `soccer/${code}`,
            leagueCode: code,
            leagueLabel: lLabel,
            country: ctry,
            isoDate: date,
          });
          all.push(...games);
        } catch (e) {
          console.log("ESPN soccer league failed:", code, e?.message);
        }
      }

      // de-dupe
      const seen = new Set();
      const deduped = [];
      for (const g of all) {
        if (!g.id || seen.has(g.id)) continue;
        seen.add(g.id);
        deduped.push(g);
      }

      deduped.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      return res.json({ games: deduped });
    }

    // -------- Other sports (single-league) --------
    const map = {
      nba: { path: "basketball/nba", label: "NBA", country: "United States" },
      nfl: { path: "football/nfl", label: "NFL", country: "United States" },
      nhl: { path: "hockey/nhl", label: "NHL", country: "United States/Canada" },
      mlb: { path: "baseball/mlb", label: "MLB", country: "United States" },
    };

    if (map[sport]) {
      const meta = map[sport];
      const games = await fetchEspnScoreboard({
        sportKey: sport,
        espnSportPath: meta.path,
        leagueCode: "",
        leagueLabel: meta.label,
        country: meta.country,
        isoDate: date,
      });

      // ✅ Don’t show 0-0 for not-started games
      const cleaned = games.map((g) => {
        const s = String(g.status || "").toUpperCase();
        const notStarted = s.includes("SCHEDULED") || s.includes("PM") || s.includes("AM") || s.includes("PRE");
        if (notStarted) return { ...g, homeScore: null, awayScore: null };
        return g;
      });

      cleaned.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      return res.json({ games: cleaned });
    }

    return res.json({ games: [] });
  } catch (err) {
    return res.status(500).json({
      error: "Games request failed",
      details: err?.message || String(err),
    });
  }
});

// ---------- Rooms / chat / bets / video signaling ----------
const roomState = new Map();
// roomId -> { users:[{id,username,credits}], bets:[], match, videoAllowed:boolean }

function getOrCreateRoom(roomId) {
  if (!roomState.has(roomId)) {
    roomState.set(roomId, {
      users: [],
      bets: [],
      match: null,
      videoAllowed: roomId.startsWith("private:"), // webcams only in private rooms
    });
  }
  return roomState.get(roomId);
}

function emitRoom(roomId) {
  const st = roomState.get(roomId);
  if (!st) return;
  io.to(roomId).emit("room-state", {
    users: st.users,
    bets: st.bets,
    match: st.match,
    videoAllowed: st.videoAllowed,
  });
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, username, match }) => {
    if (!roomId || !username) return;

    socket.join(roomId);
    const st = getOrCreateRoom(roomId);
    st.match = match || st.match;

    st.users = st.users.filter((u) => u.id !== socket.id);
    st.users.push({ id: socket.id, username, credits: 1000 });

    io.to(roomId).emit("message", { user: "System", text: `${username} joined` });
    socket.to(roomId).emit("peer-joined", { peerId: socket.id }); // notify others for WebRTC
    emitRoom(roomId);
  });

  socket.on("chatMessage", ({ roomId, user, text }) => {
    if (!roomId || !text) return;
    io.to(roomId).emit("message", { user, text });
  });

  // WebRTC signaling relay
  socket.on("signal", ({ to, from, data }) => {
    if (!to || !data) return;
    io.to(to).emit("signal", { from, data });
  });

  // Bets
  socket.on("createBetOffer", ({ roomId, targetUserId, title, stake, pick }) => {
    const st = roomState.get(roomId);
    if (!st) return;

    const me = st.users.find((u) => u.id === socket.id);
    const target = st.users.find((u) => u.id === targetUserId);
    if (!me || !target) return;

    const betId = `bet_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    st.bets.push({
      id: betId,
      status: "pending",
      title: String(title || "Bet"),
      creatorId: me.id,
      creatorName: me.username,
      targetId: target.id,
      targetName: target.username,
      creatorStake: Number(stake || 0),
      targetStake: Number(stake || 0),
      creatorPick: String(pick || ""),
      winnerName: "",
    });

    emitRoom(roomId);
    io.to(roomId).emit("message", { user: "System", text: `${me.username} offered a bet to ${target.username}` });
  });

  socket.on("acceptBetOffer", ({ roomId, betId, targetPick, targetStake }) => {
    const st = roomState.get(roomId);
    if (!st) return;

    const bet = st.bets.find((b) => b.id === betId);
    if (!bet || bet.status !== "pending") return;
    if (socket.id !== bet.targetId) return;

    bet.status = "active";
    bet.targetPick = String(targetPick || "");
    bet.targetStake = Number(targetStake || bet.targetStake);

    emitRoom(roomId);
    io.to(roomId).emit("message", { user: "System", text: `${bet.targetName} accepted the bet!` });
  });

  socket.on("cancelBetOffer", ({ roomId, betId }) => {
    const st = roomState.get(roomId);
    if (!st) return;
    const bet = st.bets.find((b) => b.id === betId);
    if (!bet || bet.status !== "pending") return;
    if (socket.id !== bet.creatorId) return;

    bet.status = "cancelled";
    emitRoom(roomId);
  });

  socket.on("disconnect", () => {
    for (const [roomId, st] of roomState.entries()) {
      const before = st.users.length;
      st.users = st.users.filter((u) => u.id !== socket.id);

      if (st.users.length !== before) {
        socket.to(roomId).emit("peer-left", { peerId: socket.id });
        io.to(roomId).emit("message", { user: "System", text: `Someone left` });
        emitRoom(roomId);
      }

      if (st.users.length === 0) roomState.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on http://0.0.0.0:${PORT}`));