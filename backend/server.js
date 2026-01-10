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
  // ok
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

  if (d.includes("FULL") || d === "FT" || d.includes("FINAL")) return "FT";
  if (d.includes("HALF") || d === "HT") return "HT";
  if (d.includes("AET")) return "AET";
  if (d.includes("PENS")) return "PENS";

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

function isGameFinished(status) {
  const s = String(status || "").toUpperCase();
  return s === "FT" || s.includes("FINAL") || s.includes("CLOSED");
}

// -------------------- Routes --------------------
app.get("/", (req, res) => res.send("Backend is running 🚀"));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, allowedOrigins, hasTwilio: Boolean(twilioClient) });
});

app.get("/api/ice", async (req, res) => {
  try {
    if (twilioClient) {
      const token = await twilioClient.tokens.create();
      return res.json({ iceServers: token.iceServers || [] });
    }
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

    games.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    return res.json({ games });
  } catch (err) {
    const status = err?.response?.status;
    return res.status(500).json({
      error: "Games request failed",
      details: status ? `ESPN status ${status}` : err?.message || String(err),
    });
  }
});

// -------------------- Rooms / chat / bets / WebRTC --------------------
// IMPORTANT: identity is USERNAME (stable), not socket id (changes on reconnect)

const roomState = new Map();
/**
 * roomState[roomId] = {
 *   users: [{ username, socketId, credits, online }],
 *   bets: [ ... ],
 *   match: {id, sport, leagueCode, startTime, ...},
 *   videoAllowed: bool,
 *   videoReady: Set<username>
 * }
 */

function getOrCreateRoom(roomId) {
  if (!roomState.has(roomId)) {
    roomState.set(roomId, {
      users: [],
      bets: [],
      match: null,
      videoAllowed: String(roomId || "").startsWith("private:"),
      videoReady: new Set(),
    });
  }
  return roomState.get(roomId);
}

function emitRoom(roomId) {
  const st = roomState.get(roomId);
  if (!st) return;

  io.to(roomId).emit("room-state", {
    users: st.users.map((u) => ({ username: u.username, credits: u.credits, online: u.online })),
    bets: st.bets,
    match: st.match,
    videoAllowed: st.videoAllowed,
    videoReadyUsers: Array.from(st.videoReady),
  });
}

function findUserByName(st, username) {
  const name = String(username || "").trim();
  return st.users.find((u) => u.username === name) || null;
}

function getSocketIdByUsername(st, username) {
  const u = findUserByName(st, username);
  return u?.socketId || null;
}

function betPickWinner(game) {
  if (!game) return null;
  const hs = safeNum(game.homeScore);
  const as = safeNum(game.awayScore);
  if (hs === null || as === null) return null;
  if (as > hs) return `${game.away} win`;
  if (hs > as) return `${game.home} win`;
  return "draw";
}

async function fetchGameForMatch(match) {
  if (!match?.id || !match?.sport) return null;

  // derive date
  const d = String(match.startTime || "").slice(0, 10); // YYYY-MM-DD
  const date = d && d.includes("-") ? d : null;
  if (!date) return null;

  if (match.sport === "soccer") {
    const code = match.leagueCode || "";
    if (!code) return null;
    const games = await fetchSoccerLeague({
      leagueCode: code,
      leagueLabel: match.league || code,
      country: match.country || "",
      isoDate: date,
    });
    return games.find((g) => String(g.id) === String(match.id)) || null;
  }

  const map = {
    nba: { sportPath: "basketball/nba", label: "NBA", country: "United States" },
    nfl: { sportPath: "football/nfl", label: "NFL", country: "United States" },
    nhl: { sportPath: "hockey/nhl", label: "NHL", country: "United States/Canada" },
    mlb: { sportPath: "baseball/mlb", label: "MLB", country: "United States" },
  };

  const meta = map[match.sport];
  if (!meta) return null;

  const games = await fetchScoreboardNonSoccer({
    sportPath: meta.sportPath,
    label: meta.label,
    country: meta.country,
    isoDate: date,
    sportKey: match.sport,
  });

  return games.find((g) => String(g.id) === String(match.id)) || null;
}

// Auto-settle loop: checks active bets and settles after game finished
setInterval(async () => {
  try {
    for (const [roomId, st] of roomState.entries()) {
      const hasActive = st.bets.some((b) => b.status === "active");
      if (!hasActive) continue;
      if (!st.match) continue;

      const g = await fetchGameForMatch(st.match);
      if (!g) continue;

      if (!isGameFinished(g.status)) continue;

      const winnerPick = betPickWinner(g); // "Team win" or "draw"
      if (!winnerPick) continue;

      let changed = false;
      for (const bet of st.bets) {
        if (bet.status !== "active") continue;

        const creatorCorrect = bet.creatorPick === winnerPick;
        const targetCorrect = bet.targetPick === winnerPick;

        let winnerName = "No winner";
        if (creatorCorrect && !targetCorrect) winnerName = bet.creatorName;
        if (targetCorrect && !creatorCorrect) winnerName = bet.targetName;
        if (creatorCorrect && targetCorrect) winnerName = "Both right";
        if (!creatorCorrect && !targetCorrect) winnerName = "Both wrong";

        bet.status = "settled";
        bet.winnerName = winnerName;
        bet.final = { status: g.status, score: { home: g.homeScore, away: g.awayScore }, winnerPick };
        changed = true;
      }

      if (changed) emitRoom(roomId);
    }
  } catch {
    // ignore
  }
}, 15000);

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, username, match }) => {
    const rid = String(roomId || "").trim();
    const name = String(username || "").trim();
    if (!rid || !name) return;

    socket.join(rid);

    const st = getOrCreateRoom(rid);
    st.match = match || st.match;

    // Upsert user by username (reconnect safe)
    let u = findUserByName(st, name);
    if (!u) {
      u = { username: name, socketId: socket.id, credits: 1000, online: true };
      st.users.push(u);
    } else {
      u.socketId = socket.id;
      u.online = true;
    }

    io.to(rid).emit("message", { user: "System", text: `${name} joined` });
    socket.to(rid).emit("peer-joined", { username: name });

    emitRoom(rid);
  });

  socket.on("chatMessage", ({ roomId, user, text }) => {
    const rid = String(roomId || "").trim();
    if (!rid || !text) return;
    io.to(rid).emit("message", { user, text });
  });

  // WebRTC signaling uses usernames (stable)
  socket.on("signal", ({ roomId, toUsername, fromUsername, data }) => {
    const rid = String(roomId || "").trim();
    if (!rid || !toUsername || !data) return;

    const st = roomState.get(rid);
    if (!st) return;

    const toSocketId = getSocketIdByUsername(st, String(toUsername).trim());
    if (!toSocketId) return;

    io.to(toSocketId).emit("signal", { fromUsername: String(fromUsername || ""), data });
  });

  socket.on("video-ready", ({ roomId, username }) => {
    const rid = String(roomId || "").trim();
    const name = String(username || "").trim();
    if (!rid || !name) return;

    const st = roomState.get(rid);
    if (!st) return;

    st.videoReady.add(name);
    socket.to(rid).emit("video-ready", { username: name });
    emitRoom(rid);
  });

  // Bets
  socket.on("createBetOffer", ({ roomId, targetUsername, title, stake, pick, creatorUsername }) => {
    const rid = String(roomId || "").trim();
    const st = roomState.get(rid);
    if (!st) return;

    const creatorName = String(creatorUsername || "").trim();
    const targetName = String(targetUsername || "").trim();
    if (!creatorName || !targetName) return;

    const creator = findUserByName(st, creatorName);
    const target = findUserByName(st, targetName);
    if (!creator || !target) return;

    const betId = `bet_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    st.bets.push({
      id: betId,
      status: "pending",
      title: String(title || "Bet"),
      creatorName,
      targetName,
      creatorStake: Number(stake || 0),
      targetStake: Number(stake || 0),
      creatorPick: String(pick || ""),
      targetPick: "",
      winnerName: "",
      cancel: { creator: false, target: false }, // both must confirm cancel
      createdAt: Date.now(),
    });

    emitRoom(rid);
    io.to(rid).emit("message", { user: "System", text: `${creatorName} offered a bet to ${targetName}` });
  });

  socket.on("acceptBetOffer", ({ roomId, betId, targetPick, targetStake, username }) => {
    const rid = String(roomId || "").trim();
    const st = roomState.get(rid);
    if (!st) return;

    const name = String(username || "").trim();
    const bet = st.bets.find((b) => b.id === betId);
    if (!bet || bet.status !== "pending") return;
    if (bet.targetName !== name) return;

    bet.status = "active";
    bet.targetPick = String(targetPick || "");
    bet.targetStake = Number(targetStake || bet.targetStake);

    emitRoom(rid);
    io.to(rid).emit("message", { user: "System", text: `${bet.targetName} accepted the bet!` });
  });

  // Cancel requires BOTH confirmations
  socket.on("requestCancelBet", ({ roomId, betId, username }) => {
    const rid = String(roomId || "").trim();
    const st = roomState.get(rid);
    if (!st) return;

    const name = String(username || "").trim();
    const bet = st.bets.find((b) => b.id === betId);
    if (!bet) return;

    // only creator/target can request cancel
    if (name !== bet.creatorName && name !== bet.targetName) return;

    // if already settled/cancelled, ignore
    if (bet.status === "settled" || bet.status === "cancelled") return;

    // mark who agreed
    if (name === bet.creatorName) bet.cancel.creator = true;
    if (name === bet.targetName) bet.cancel.target = true;

    // if both agreed -> cancel
    if (bet.cancel.creator && bet.cancel.target) {
      bet.status = "cancelled";
      emitRoom(rid);
      io.to(rid).emit("message", { user: "System", text: `Bet cancelled by mutual agreement.` });
      return;
    }

    // otherwise mark as cancel-pending
    bet.status = "cancel_pending";
    emitRoom(rid);
    io.to(rid).emit("message", { user: "System", text: `${name} requested to cancel the bet (waiting for other person).` });
  });

  socket.on("disconnect", () => {
    // mark users offline (do NOT delete bets)
    for (const [rid, st] of roomState.entries()) {
      let changed = false;

      for (const u of st.users) {
        if (u.socketId === socket.id) {
          u.socketId = null;
          u.online = false;
          st.videoReady.delete(u.username);
          changed = true;
        }
      }

      if (changed) {
        socket.to(rid).emit("peer-left", { socketId: socket.id });
        emitRoom(rid);
      }

      // optional: cleanup empty rooms with no online users AND no active/pending bets
      const anyOnline = st.users.some((u) => u.online);
      const hasImportantBets = st.bets.some((b) => b.status === "pending" || b.status === "active" || b.status === "cancel_pending");
      if (!anyOnline && !hasImportantBets) {
        roomState.delete(rid);
      }
    }
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
