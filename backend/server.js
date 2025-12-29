// backend/server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const axios = require("axios");
const { Server } = require("socket.io");
const twilio = require("twilio");

const app = express();

// --------- CORS (VERY IMPORTANT for Vercel + Railway) ----------
const allowedOrigins = [
  process.env.FRONTEND_URL, // your vercel url
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      // allow no-origin (curl/postman) + allowed list
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// ---------------- ESPN helpers ----------------
function yyyymmddFromISO(isoDate) {
  const [y, m, d] = String(isoDate || "").split("-");
  if (!y || !m || !d) return null;
  return `${y}${m}${d}`;
}

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normStatus(detail) {
  const s = String(detail || "").toUpperCase();
  // Soccer
  if (s.includes("FULL TIME") || s === "FT" || s.includes("FINAL")) return "FT";
  if (s.includes("HALF") || s === "HT") return "HT";
  // US sports
  if (s.includes("IN PROGRESS") || s.includes("LIVE")) return "LIVE";
  if (s.includes("HALFTIME")) return "HALFTIME";
  return detail || "";
}

function pickSoccerPenInfo(comp) {
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

  const startTime = comp?.date || event?.date || "";

  const statusDetail = comp?.status?.type?.detail || comp?.status?.type?.name || "";
  const status = normStatus(statusDetail);

  // Scores: ESPN often returns "0" even pregame for some sports; we handle on frontend too
  const homeScore = safeNum(homeC?.score);
  const awayScore = safeNum(awayC?.score);

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
    penalties: pens,
  };
}

// ------------ Soccer catalog (expandable) -------------
const SOCCER_CATALOG = [
  // Continents / International
  { region: "Europe", country: "Europe", league: "UEFA Champions League", leagueCode: "uefa.champions" },
  { region: "Europe", country: "Europe", league: "UEFA Europa League", leagueCode: "uefa.europa" },
  { region: "Europe", country: "Europe", league: "UEFA Conference League", leagueCode: "uefa.conf" },

  { region: "Asia", country: "Asia", league: "AFC Champions League Elite", leagueCode: "afc.champions" },
  { region: "Africa", country: "Africa", league: "CAF Champions League", leagueCode: "caf.champions" },

  { region: "North America", country: "North America", league: "CONCACAF Champions Cup", leagueCode: "concacaf.champions" },
  { region: "South America", country: "South America", league: "CONMEBOL Libertadores", leagueCode: "conmebol.libertadores" },

  // England
  { region: "Europe", country: "England", league: "Premier League", leagueCode: "eng.1" },
  { region: "Europe", country: "England", league: "Championship", leagueCode: "eng.2" },
  { region: "Europe", country: "England", league: "League One", leagueCode: "eng.3" },
  { region: "Europe", country: "England", league: "FA Cup", leagueCode: "eng.fa" },
  { region: "Europe", country: "England", league: "EFL Cup", leagueCode: "eng.lcup" },

  // Spain
  { region: "Europe", country: "Spain", league: "LaLiga", leagueCode: "esp.1" },
  { region: "Europe", country: "Spain", league: "LaLiga 2", leagueCode: "esp.2" },
  { region: "Europe", country: "Spain", league: "Copa del Rey", leagueCode: "esp.copa_del_rey" },

  // Italy
  { region: "Europe", country: "Italy", league: "Serie A", leagueCode: "ita.1" },
  { region: "Europe", country: "Italy", league: "Serie B", leagueCode: "ita.2" },
  { region: "Europe", country: "Italy", league: "Coppa Italia", leagueCode: "ita.coppa_italia" },

  // Germany
  { region: "Europe", country: "Germany", league: "Bundesliga", leagueCode: "ger.1" },
  { region: "Europe", country: "Germany", league: "2. Bundesliga", leagueCode: "ger.2" },
  { region: "Europe", country: "Germany", league: "DFB Pokal", leagueCode: "ger.dfb_pokal" },

  // France
  { region: "Europe", country: "France", league: "Ligue 1", leagueCode: "fra.1" },
  { region: "Europe", country: "France", league: "Ligue 2", leagueCode: "fra.2" },
  { region: "Europe", country: "France", league: "Coupe de France", leagueCode: "fra.coupe_de_france" },

  // Portugal, Netherlands
  { region: "Europe", country: "Portugal", league: "Primeira Liga", leagueCode: "por.1" },
  { region: "Europe", country: "Netherlands", league: "Eredivisie", leagueCode: "ned.1" },

  // Saudi + MLS (Ronaldo/Messi leagues)
  { region: "Asia", country: "Saudi Arabia", league: "Saudi Pro League", leagueCode: "ksa.1" },
  { region: "North America", country: "United States", league: "MLS", leagueCode: "usa.1" },

  // Brazil, Argentina
  { region: "South America", country: "Brazil", league: "Brazil Serie A", leagueCode: "bra.1" },
  { region: "South America", country: "Argentina", league: "Argentina Liga Profesional", leagueCode: "arg.1" },
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

// --------- ESPN fetch ---------
async function fetchEspnScoreboard({ sportKey, espnSportPath, leagueCode, leagueLabel, country, isoDate }) {
  const dates = yyyymmddFromISO(isoDate);
  if (!dates) {
    const e = new Error("Bad date");
    e.status = 400;
    throw e;
  }

  // Soccer: use /soccer/{leagueCode}/scoreboard
  // Other sports: /{sportPath}/scoreboard
  let url = "";

  if (sportKey === "soccer") {
    // This is the correct ESPN soccer endpoint format:
    // https://site.api.espn.com/apis/v2/sports/soccer/{LEAGUE}/scoreboard?dates=YYYYMMDD
    if (!leagueCode) {
      const e = new Error("Missing leagueCode for soccer");
      e.status = 400;
      throw e;
    }
    url = `https://site.api.espn.com/apis/v2/sports/soccer/${encodeURIComponent(leagueCode)}/scoreboard?dates=${dates}`;
  } else {
    url = `https://site.api.espn.com/apis/v2/sports/${espnSportPath}/scoreboard?dates=${dates}`;
  }

  let data;
  try {
    const resp = await axios.get(url, { timeout: 15000 });
    data = resp.data;
  } catch (err) {
    const status = err?.response?.status;
    const msg = status ? `ESPN returned status ${status}` : (err?.message || "ESPN request failed");
    const e = new Error(msg);
    e.status = status || 500;
    throw e;
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

// ----------------- Routes -----------------
app.get("/", (req, res) => res.send("Backend is running 🚀"));

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/catalog", (req, res) => {
  const sport = String(req.query.sport || "soccer");
  if (sport !== "soccer") return res.json({ regions: [] });
  return res.json({ regions: buildSoccerCatalogTree() });
});

// Twilio ICE servers for WebRTC (TURN)
app.get("/api/ice", async (req, res) => {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      return res.json({
        iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
        note: "Twilio not configured, using public STUN only",
      });
    }

    const client = twilio(sid, token);
    const tw = await client.tokens.create();
    return res.json({ iceServers: tw.iceServers || [] });
  } catch (e) {
    return res.json({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
      note: "Twilio failed, fallback STUN",
      error: e?.message || String(e),
    });
  }
});

app.get("/api/games", async (req, res) => {
  try {
    const sport = String(req.query.sport || "soccer");
    const date = String(req.query.date || "");
    const leagueCode = String(req.query.leagueCode || "");

    // Soccer: if no league selected, use a “popular mix”
    if (sport === "soccer") {
      const codes = leagueCode
        ? [leagueCode]
        : [
            "uefa.champions",
            "eng.1",
            "esp.1",
            "ita.1",
            "ger.1",
            "fra.1",
            "por.1",
            "ned.1",
            "usa.1",
            "ksa.1",
          ];

      const all = [];
      for (const code of codes) {
        const cat = SOCCER_CATALOG.find((x) => x.leagueCode === code);
        const lLabel = cat?.league || code;
        const ctry = cat?.country || "";
        try {
          const games = await fetchEspnScoreboard({
            sportKey: "soccer",
            espnSportPath: "soccer",
            leagueCode: code,
            leagueLabel: lLabel,
            country: ctry,
            isoDate: date,
          });
          all.push(...games);
        } catch (e) {
          console.log("ESPN soccer league failed:", code, e?.status || e?.message);
        }
      }

      // dedupe
      const seen = new Set();
      const deduped = [];
      for (const g of all) {
        if (!g.id || seen.has(g.id)) continue;
        seen.add(g.id);
        deduped.push(g);
      }

      deduped.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      return res.json({ games: deduped });
    }

    // NBA/NFL/NHL/MLB
    const map = {
      nba: { sportPath: "basketball/nba", label: "NBA", country: "United States" },
      nfl: { sportPath: "football/nfl", label: "NFL", country: "United States" },
      nhl: { sportPath: "hockey/nhl", label: "NHL", country: "United States/Canada" },
      mlb: { sportPath: "baseball/mlb", label: "MLB", country: "United States" },
    };

    if (map[sport]) {
      const meta = map[sport];
      const games = await fetchEspnScoreboard({
        sportKey: sport,
        espnSportPath: meta.sportPath,
        leagueCode: "",
        leagueLabel: meta.label,
        country: meta.country,
        isoDate: date,
      });

      games.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      return res.json({ games });
    }

    return res.json({ games: [] });
  } catch (err) {
    return res.status(500).json({
      error: "Games request failed",
      details: err?.message || String(err),
    });
  }
});

// ---------------- Rooms / chat / bets / video signaling ----------------
const roomState = new Map();
// roomId -> { users:[], bets:[], match, videoReady:Set(socketId) }

function getOrCreateRoom(roomId) {
  if (!roomState.has(roomId)) {
    roomState.set(roomId, {
      users: [],
      bets: [],
      match: null,
      videoReady: new Set(),
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
  });
}

// deterministic initiator so you don't get double-initiator fights
function isInitiator(a, b) {
  return String(a) < String(b);
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, username, match }) => {
    if (!roomId || !username) return;
    socket.join(roomId);

    const st = getOrCreateRoom(roomId);
    st.match = match || st.match;

    // store user
    st.users = st.users.filter((u) => u.id !== socket.id);
    st.users.push({ id: socket.id, username: String(username), credits: 1000 });

    io.to(roomId).emit("message", { user: "System", text: `${username} joined` });
    emitRoom(roomId);
  });

  socket.on("leaveRoom", ({ roomId }) => {
    if (!roomId) return;
    socket.leave(roomId);
    const st = roomState.get(roomId);
    if (!st) return;

    st.videoReady.delete(socket.id);
    st.users = st.users.filter((u) => u.id !== socket.id);

    io.to(roomId).emit("video-peer-left", { peerId: socket.id });
    emitRoom(roomId);
    if (st.users.length === 0) roomState.delete(roomId);
  });

  socket.on("chatMessage", ({ roomId, user, text }) => {
    if (!roomId || !text) return;
    io.to(roomId).emit("message", { user, text });
  });

  // ---- Bets (MVP) ----
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

  // ---- VIDEO READY + SIGNALING ----
  socket.on("video-ready", ({ roomId }) => {
    const st = roomState.get(roomId);
    if (!st) return;

    st.videoReady.add(socket.id);

    // pair with everyone else who is video-ready
    for (const otherId of st.videoReady) {
      if (otherId === socket.id) continue;

      // tell BOTH ends to create a peer with deterministic initiator
      io.to(socket.id).emit("video-peer", {
        peerId: otherId,
        initiator: isInitiator(socket.id, otherId),
      });
      io.to(otherId).emit("video-peer", {
        peerId: socket.id,
        initiator: isInitiator(otherId, socket.id),
      });
    }
  });

  socket.on("video-stop", ({ roomId }) => {
    const st = roomState.get(roomId);
    if (!st) return;
    st.videoReady.delete(socket.id);
    io.to(roomId).emit("video-peer-left", { peerId: socket.id });
  });

  socket.on("signal", ({ to, data }) => {
    if (!to) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    for (const [roomId, st] of roomState.entries()) {
      const before = st.users.length;

      st.videoReady.delete(socket.id);
      st.users = st.users.filter((u) => u.id !== socket.id);

      if (st.users.length !== before) {
        io.to(roomId).emit("message", { user: "System", text: `Someone left` });
        io.to(roomId).emit("video-peer-left", { peerId: socket.id });
        emitRoom(roomId);
      }

      if (st.users.length === 0) roomState.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));