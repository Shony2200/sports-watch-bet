// backend/server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const axios = require("axios");
const { Server } = require("socket.io");

let twilioClient = null;
try {
  const twilio = require("twilio");
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
} catch {
  // twilio not installed - ICE endpoint will fall back to STUN only
}

const app = express();
app.use(express.json());

// -------------------- CORS --------------------
function parseAllowedOrigins() {
  const env = (process.env.FRONTEND_URL || "").trim();
  const list = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : [];
  list.push("http://localhost:3001");
  list.push("http://127.0.0.1:3001");
  return Array.from(new Set(list));
}

const allowedOrigins = parseAllowedOrigins();

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);

// -------------------- HTTP + Socket.io --------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Socket CORS blocked origin: ${origin}`));
    },
    credentials: true,
  },
});

// -------------------- ESPN helpers --------------------
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2";

function yyyymmddFromISO(isoDate) {
  const [y, m, d] = String(isoDate || "").split("-");
  if (!y || !m || !d) return null;
  return `${y}${m}${d}`;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeStatus(detail, state) {
  const d = String(detail || "").toUpperCase();
  const s = String(state || "").toUpperCase();

  // Soccer
  if (d.includes("FULL") || d === "FT" || d.includes("FINAL")) return "FT";
  if (d.includes("HALF") || d === "HT") return "HT";
  if (d.includes("AET")) return "AET";
  if (d.includes("PENS")) return "PENS";

  // Other sports
  if (d.includes("HALF")) return "HALFTIME";
  if (d.includes("FINAL")) return "FINAL";
  if (s === "IN") return "LIVE";
  if (s === "PRE") return "SCHEDULED";

  return detail || state || "";
}

function pickSoccerPens(comp) {
  try {
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
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
  const statusDetail = comp?.status?.type?.detail || comp?.status?.type?.name || "";
  const statusState = comp?.status?.type?.state || "";
  const status = normalizeStatus(statusDetail, statusState);

  const pens = sportKey === "soccer" ? pickSoccerPens(comp) : null;

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
    penalties: pens,
  };
}

// -------------------- Soccer Catalog --------------------
const SOCCER_CATALOG = [
  { region: "Europe", country: "Europe", league: "UEFA Champions League", leagueCode: "uefa.champions" },
  { region: "Europe", country: "Europe", league: "UEFA Europa League", leagueCode: "uefa.europa" },
  { region: "Europe", country: "Europe", league: "UEFA Conference League", leagueCode: "uefa.europa.conf" },

  { region: "Europe", country: "England", league: "Premier League", leagueCode: "eng.1" },
  { region: "Europe", country: "England", league: "Championship", leagueCode: "eng.2" },
  { region: "Europe", country: "England", league: "FA Cup", leagueCode: "eng.fa" },
  { region: "Europe", country: "England", league: "EFL Cup", leagueCode: "eng.league_cup" },

  { region: "Europe", country: "Spain", league: "LaLiga", leagueCode: "esp.1" },
  { region: "Europe", country: "Spain", league: "LaLiga 2", leagueCode: "esp.2" },
  { region: "Europe", country: "Spain", league: "Copa del Rey", leagueCode: "esp.copa_del_rey" },

  { region: "Europe", country: "Italy", league: "Serie A", leagueCode: "ita.1" },
  { region: "Europe", country: "Italy", league: "Serie B", leagueCode: "ita.2" },
  { region: "Europe", country: "Italy", league: "Coppa Italia", leagueCode: "ita.coppa_italia" },

  { region: "Europe", country: "Germany", league: "Bundesliga", leagueCode: "ger.1" },
  { region: "Europe", country: "Germany", league: "2. Bundesliga", leagueCode: "ger.2" },
  { region: "Europe", country: "Germany", league: "DFB-Pokal", leagueCode: "ger.dfb_pokal" },

  { region: "Europe", country: "France", league: "Ligue 1", leagueCode: "fra.1" },
  { region: "Europe", country: "France", league: "Ligue 2", leagueCode: "fra.2" },
  { region: "Europe", country: "France", league: "Coupe de France", leagueCode: "fra.coupe_de_france" },

  { region: "Europe", country: "Portugal", league: "Primeira Liga", leagueCode: "por.1" },
  { region: "Europe", country: "Netherlands", league: "Eredivisie", leagueCode: "ned.1" },

  { region: "North America", country: "United States", league: "MLS", leagueCode: "usa.1" },
  { region: "North America", country: "Mexico", league: "Liga MX", leagueCode: "mex.1" },

  { region: "South America", country: "Brazil", league: "Brasileirão (Serie A)", leagueCode: "bra.1" },
  { region: "South America", country: "Argentina", league: "Liga Profesional", leagueCode: "arg.1" },

  { region: "Asia", country: "Saudi Arabia", league: "Saudi Pro League", leagueCode: "ksa.1" },
];

function buildSoccerCatalogTree() {
  const regions = new Map();
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
  return out.sort((a, b) => a.region.localeCompare(b.region));
}

async function fetchScoreboardNonSoccer({ sportPath, label, country, isoDate, sportKey }) {
  const dates = yyyymmddFromISO(isoDate);
  if (!dates) throw new Error("Bad date (must be YYYY-MM-DD)");

  const url = `${ESPN_BASE}/sports/${sportPath}/scoreboard?dates=${dates}`;
  const { data } = await axios.get(url, { timeout: 20000 });

  const events = data?.events || [];
  return events.map((event) =>
    mapEspnEventToGame({
      event,
      sportKey,
      leagueLabel: label,
      country,
      leagueCode: "",
    })
  );
}

async function fetchSoccerLeague({ leagueCode, leagueLabel, country, isoDate }) {
  const dates = yyyymmddFromISO(isoDate);
  if (!dates) throw new Error("Bad date (must be YYYY-MM-DD)");

  const url = `${ESPN_BASE}/sports/soccer/${encodeURIComponent(leagueCode)}/scoreboard?dates=${dates}`;
  const { data } = await axios.get(url, { timeout: 20000 });

  const events = data?.events || [];
  return events.map((event) =>
    mapEspnEventToGame({
      event,
      sportKey: "soccer",
      leagueLabel,
      country,
      leagueCode,
    })
  );
}

// -------------------- Routes --------------------
app.get("/", (req, res) => res.send("Backend is running 🚀"));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, allowedOrigins, hasTwilio: Boolean(twilioClient) });
});

// ✅ ICE servers for WebRTC (TURN)
app.get("/api/ice", async (req, res) => {
  try {
    if (twilioClient) {
      const token = await twilioClient.tokens.create();
      return res.json({ iceServers: token.iceServers || [] });
    }

    // Fallback STUN only
    return res.json({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }],
    });
  } catch (e) {
    return res.json({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      error: e?.message || "ICE fetch failed",
    });
  }
});

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

    if (sport === "soccer") {
      const codes = leagueCode
        ? [leagueCode]
        : ["uefa.champions", "eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "usa.1", "ksa.1"];

      const tasks = codes.map(async (code) => {
        const cat = SOCCER_CATALOG.find((x) => x.leagueCode === code);
        const lLabel = cat?.league || code;
        const ctry = cat?.country || "";
        return fetchSoccerLeague({ leagueCode: code, leagueLabel: lLabel, country: ctry, isoDate: date });
      });

      const settled = await Promise.allSettled(tasks);

      const all = [];
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === "fulfilled") all.push(...r.value);
        else {
          const code = codes[i];
          const status = r.reason?.response?.status;
          console.log("ESPN soccer league failed:", code, status || r.reason?.message || r.reason);
        }
      }

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

    const map = {
      nba: { sportPath: "basketball/nba", label: "NBA", country: "United States" },
      nfl: { sportPath: "football/nfl", label: "NFL", country: "United States" },
      nhl: { sportPath: "hockey/nhl", label: "NHL", country: "United States/Canada" },
      mlb: { sportPath: "baseball/mlb", label: "MLB", country: "United States" },
    };

    if (!map[sport]) return res.json({ games: [] });

    const meta = map[sport];
    const games = await fetchScoreboardNonSoccer({
      sportPath: meta.sportPath,
      label: meta.label,
      country: meta.country,
      isoDate: date,
      sportKey: sport,
    });

    const cleaned = games.map((g) => {
      const st = String(g.status || "").toUpperCase();
      const notStarted = st.includes("SCHEDULED") || st.includes("PRE") || st.includes("AM") || st.includes("PM");
      if (notStarted) return { ...g, homeScore: null, awayScore: null };
      return g;
    });

    cleaned.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    return res.json({ games: cleaned });
  } catch (err) {
    const status = err?.response?.status;
    return res.status(500).json({
      error: "Games request failed",
      details: status ? `ESPN status ${status}` : err?.message || String(err),
    });
  }
});

// -------------------- Rooms / chat / bets / WebRTC signaling --------------------
const roomState = new Map();
function getOrCreateRoom(roomId) {
  if (!roomState.has(roomId)) {
    roomState.set(roomId, {
      users: [],
      bets: [],
      match: null,
      videoAllowed: String(roomId || "").startsWith("private:"),
      videoReady: new Set(), // socket ids that clicked "Start Webcam"
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
    videoReadyIds: Array.from(st.videoReady),
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
    socket.to(roomId).emit("peer-joined", { peerId: socket.id });

    emitRoom(roomId);
  });

  socket.on("chatMessage", ({ roomId, user, text }) => {
    if (!roomId || !text) return;
    io.to(roomId).emit("message", { user, text });
  });

  // ✅ WebRTC signaling pass-through
  socket.on("signal", ({ to, from, data }) => {
    if (!to || !data) return;
    io.to(to).emit("signal", { from, data });
  });

  // ✅ When someone clicks "Start Webcam", tell others to connect to them
  socket.on("video-ready", ({ roomId }) => {
    const st = roomState.get(roomId);
    if (!st) return;
    st.videoReady.add(socket.id);
    socket.to(roomId).emit("video-ready", { peerId: socket.id });
    emitRoom(roomId);
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
    bet.targetPick = String(targetPick || "ACCEPT");
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
      st.videoReady.delete(socket.id);

      if (st.users.length !== before) {
        socket.to(roomId).emit("peer-left", { peerId: socket.id });
        io.to(roomId).emit("message", { user: "System", text: `Someone left` });
        emitRoom(roomId);
      }

      if (st.users.length === 0) roomState.delete(roomId);
    }
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));