import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import Peer from "simple-peer";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:3000";

// IMPORTANT for deployment: websocket transport is best
const socket = io(BACKEND, {
  transports: ["websocket", "polling"],
});

const TZ = "America/Toronto";

const SPORTS = [
  { key: "soccer", label: "Soccer" },
  { key: "nba", label: "NBA" },
  { key: "nfl", label: "NFL" },
  { key: "nhl", label: "NHL" },
  { key: "mlb", label: "MLB" },
];

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function isLive(status) {
  const s = String(status || "").toUpperCase();
  return s.includes("LIVE") || s.includes("IN PROGRESS") || s.includes("Q") || s.includes("PERIOD") || s.includes("HT");
}

function isFinished(status) {
  const s = String(status || "").toUpperCase();
  return s === "FT" || s.includes("FINAL") || s.includes("CLOSED");
}

function isNotStarted(status) {
  const s = String(status || "").toUpperCase();
  return s.includes("SCHEDULED") || s.includes("PRE") || s.includes("AM") || s.includes("PM");
}

function gameTitle(g) {
  return `${g.away} vs ${g.home}`;
}

function scoreLine(g) {
  const hasScore = g.homeScore !== null && g.awayScore !== null;
  if (!hasScore) return "";
  if (g.sport === "soccer" && g.penalties && g.penalties.homePens != null && g.penalties.awayPens != null) {
    return `${g.awayScore}-${g.homeScore} (pens ${g.penalties.awayPens}-${g.penalties.homePens})`;
  }
  return `${g.awayScore}-${g.homeScore}`;
}

export default function App() {
  // ---------- Login ----------
  const [username, setUsername] = useState(localStorage.getItem("wb_username") || "");
  const [step, setStep] = useState(username ? "lobby" : "enterName"); // enterName | lobby | room

  // ---------- Lobby ----------
  const [sport, setSport] = useState("soccer");
  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState("all"); // all | live | finished

  // Soccer catalog
  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [leagueCode, setLeagueCode] = useState("");
  const [leagueLabel, setLeagueLabel] = useState("");

  // Games
  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [apiError, setApiError] = useState("");

  // Room
  const [roomId, setRoomId] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);
  const [users, setUsers] = useState([]);
  const [bets, setBets] = useState([]);
  const [messages, setMessages] = useState([]);

  // Chat
  const [text, setText] = useState("");

  // Betting UI
  const [betTarget, setBetTarget] = useState(null);
  const [betTitle, setBetTitle] = useState("");
  const [betStake, setBetStake] = useState(100);
  const [betPick, setBetPick] = useState("");
  const [acceptPick, setAcceptPick] = useState("");
  const [acceptStake, setAcceptStake] = useState(100);

  // ✅ 3rd button: Join Private by code
  const [showJoinPrivate, setShowJoinPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  // WebRTC (private only)
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const peersRef = useRef({});
  const remoteVideoRefs = useRef({});

  const scrollRef = useRef(null);

  // ---------- Catalog ----------
  async function loadCatalog() {
    setLoadingCatalog(true);
    try {
      const res = await axios.get(`${BACKEND}/api/catalog`, { params: { sport: "soccer" } });
      setCatalog(res.data.regions || []);
    } catch {
      setCatalog([]);
    } finally {
      setLoadingCatalog(false);
    }
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  // ---------- Games ----------
  async function loadGames() {
    setLoadingGames(true);
    setApiError("");
    try {
      const params = { sport, date };
      if (sport === "soccer") {
        if (leagueCode) params.leagueCode = leagueCode;
      }
      const res = await axios.get(`${BACKEND}/api/games`, { params });
      setGames(res.data.games || []);
    } catch (e) {
      const msg = e?.response?.data?.details || e?.response?.data?.error || e?.message || "Backend/API issue";
      setApiError(String(msg));
      setGames([]);
    } finally {
      setLoadingGames(false);
    }
  }

  useEffect(() => {
    if (step !== "lobby") return;
    loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sport, date, leagueCode]);

  // Soccer dropdown data
  const regions = useMemo(() => catalog.map((r) => r.region), [catalog]);

  const countries = useMemo(() => {
    const r = catalog.find((x) => x.region === region);
    return r ? r.countries.map((c) => c.country) : [];
  }, [catalog, region]);

  const leagues = useMemo(() => {
    const r = catalog.find((x) => x.region === region);
    const c = r?.countries?.find((x) => x.country === country);
    return c ? c.leagues : [];
  }, [catalog, region, country]);

  // Filtered games
  const filteredGames = useMemo(() => {
    const list = games || [];
    if (tab === "live") return list.filter((g) => isLive(g.status));
    if (tab === "finished") return list.filter((g) => isFinished(g.status));

    const live = list.filter((g) => isLive(g.status));
    const fin = list.filter((g) => isFinished(g.status));
    const rest = list.filter((g) => !isLive(g.status) && !isFinished(g.status));

    return [
      ...live,
      ...rest.sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
      ...fin.sort((a, b) => new Date(b.startTime) - new Date(a.startTime)),
    ];
  }, [games, tab]);

  // Clear soccer filters when leaving soccer
  useEffect(() => {
    if (sport !== "soccer") {
      setRegion("");
      setCountry("");
      setLeagueCode("");
      setLeagueLabel("");
    }
  }, [sport]);

  // ---------- Socket room listeners ----------
  useEffect(() => {
    if (step !== "room") return;

    const onMessage = (msg) => {
      setMessages((p) => [...p, msg]);
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 0);
    };

    const onRoomState = (st) => {
      setUsers(st.users || []);
      setBets(st.bets || []);
      if (st.match) setSelectedGame(st.match);
    };

    const onPeerJoined = ({ peerId }) => {
      if (!videoEnabled || !localStream) return;
      createPeer(peerId, true);
    };

    const onPeerLeft = ({ peerId }) => {
      const p = peersRef.current[peerId];
      if (p) p.destroy();
      delete peersRef.current[peerId];
      delete remoteVideoRefs.current[peerId];
      setVideoEnabled((v) => v);
    };

    const onSignal = ({ from, data }) => {
      if (!videoEnabled || !localStream) return;
      let p = peersRef.current[from];
      if (!p) p = createPeer(from, false);
      try {
        p.signal(data);
      } catch {}
    };

    socket.on("message", onMessage);
    socket.on("room-state", onRoomState);
    socket.on("peer-joined", onPeerJoined);
    socket.on("peer-left", onPeerLeft);
    socket.on("signal", onSignal);

    return () => {
      socket.off("message", onMessage);
      socket.off("room-state", onRoomState);
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      socket.off("signal", onSignal);
    };
  }, [step, videoEnabled, localStream]);

  // ---------- WebRTC helpers ----------
  function isPrivateRoom(rid) {
    return String(rid || "").startsWith("private:");
  }

  function stopVideo() {
    setVideoEnabled(false);

    Object.values(peersRef.current).forEach((p) => {
      try {
        p.destroy();
      } catch {}
    });
    peersRef.current = {};

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    setLocalStream(null);
  }

  function createPeer(peerId, initiator) {
    const peerCount = Object.keys(peersRef.current).length;
    if (peerCount >= 12) return null; // allow more than before

    const peer = new Peer({
      initiator,
      trickle: true,
      stream: localStream,
      config: {
        iceServers: [
          // STUN helps a lot across different wifi/data networks
          { urls: "stun:stun.l.google.com:19302" },
        ],
      },
    });

    peer.on("signal", (data) => {
      socket.emit("signal", { to: peerId, from: socket.id, data });
    });

    peer.on("stream", (stream) => {
      setTimeout(() => {
        const el = remoteVideoRefs.current[peerId];
        if (el) el.srcObject = stream;
      }, 0);
      setVideoEnabled((v) => v);
    });

    peer.on("close", () => {
      delete peersRef.current[peerId];
      delete remoteVideoRefs.current[peerId];
      setVideoEnabled((v) => v);
    });

    peer.on("error", () => {});
    peersRef.current[peerId] = peer;
    return peer;
  }

  async function startVideo() {
    if (!isPrivateRoom(roomId)) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      setVideoEnabled(true);

      users
        .filter((u) => u.id && u.username && u.username !== username)
        .forEach((u) => createPeer(u.id, true));
    } catch {
      alert("Could not start camera/mic. Check browser permissions.");
    }
  }

  // ---------- Actions ----------
  function continueFromName() {
    const name = username.trim();
    if (!name) return;
    localStorage.setItem("wb_username", name);
    setStep("lobby");
  }

  function logout() {
    stopVideo();
    localStorage.removeItem("wb_username");
    setUsername("");
    setRoomId("");
    setSelectedGame(null);
    setUsers([]);
    setBets([]);
    setMessages([]);
    setStep("enterName");
  }

  function joinPublic(game) {
    const rid = `public:${sport}:${game.id}`;
    setRoomId(rid);
    setSelectedGame(game);
    setUsers([]);
    setBets([]);
    setMessages([]);
    setBetTarget(null);
    setApiError("");
    setShowJoinPrivate(false);
    setJoinCode("");
    stopVideo();
    socket.emit("joinRoom", { roomId: rid, username, match: game });
    setStep("room");
  }

  function createPrivate(game) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const rid = `private:${code}`;
    setRoomId(rid);
    setSelectedGame(game);
    setUsers([]);
    setBets([]);
    setMessages([]);
    setBetTarget(null);
    setApiError("");
    setShowJoinPrivate(false);
    setJoinCode("");
    stopVideo();
    socket.emit("joinRoom", { roomId: rid, username, match: game });
    setStep("room");
  }

  // ✅ 3rd button: open join-by-code UI
  function openJoinPrivateByCode(game) {
    setSelectedGame(game);
    setShowJoinPrivate(true);
    setJoinCode("");
  }

  function confirmJoinPrivate() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;

    const rid = `private:${code}`;
    setRoomId(rid);
    setUsers([]);
    setBets([]);
    setMessages([]);
    setBetTarget(null);
    setApiError("");
    stopVideo();
    socket.emit("joinRoom", { roomId: rid, username, match: selectedGame });
    setStep("room");
    setShowJoinPrivate(false);
  }

  function sendMessage() {
    if (!text.trim()) return;
    socket.emit("chatMessage", { roomId, user: username, text: text.trim() });
    setText("");
  }

  function openBetToUser(u) {
    setBetTarget(u);
    setBetTitle(`${selectedGame ? gameTitle(selectedGame) : "Match"} — my pick:`);
    setBetPick("");
    setBetStake(100);
    setAcceptPick("");
    setAcceptStake(100);
  }

  function createOffer() {
    if (!betTarget) return;
    if (!betTitle.trim()) return;
    if (!betPick.trim()) return;
    socket.emit("createBetOffer", {
      roomId,
      targetUserId: betTarget.id,
      title: betTitle,
      stake: Number(betStake || 0),
      pick: betPick,
    });
    setBetTarget(null);
  }

  function acceptOffer(b) {
    socket.emit("acceptBetOffer", {
      roomId,
      betId: b.id,
      targetPick: acceptPick || "ACCEPT",
      targetStake: Number(acceptStake || b.targetStake || 0),
    });
  }

  function cancelOffer(b) {
    socket.emit("cancelBetOffer", { roomId, betId: b.id });
  }

  // ---------- UI ----------
  if (step === "enterName") {
    return (
      <div style={{ padding: 30, fontFamily: "Arial, sans-serif", maxWidth: 520 }}>
        <h1 style={{ marginTop: 0 }}>Sports Watch & Bet</h1>
        <div style={{ marginBottom: 10 }}>Enter your username</div>
        <input value={username} onChange={(e) => setUsername(e.target.value)} style={{ width: "100%", padding: 12 }} />
        <button style={{ marginTop: 12, padding: 12, width: "100%" }} onClick={continueFromName}>
          Continue
        </button>
      </div>
    );
  }

  if (step === "lobby") {
    return (
      <div style={{ height: "100vh", fontFamily: "Arial, sans-serif", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0 }}>Lobby</h1>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div>
              Logged in as <b>{username}</b>
            </div>
            <button onClick={logout}>Log out</button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {SPORTS.map((s) => (
            <button key={s.key} onClick={() => setSport(s.key)} style={{ padding: 10, fontWeight: sport === s.key ? "bold" : "normal" }}>
              {s.label}
            </button>
          ))}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 10 }} />
          <button onClick={loadGames} style={{ padding: 10 }}>
            Refresh
          </button>
        </div>

        {sport === "soccer" ? (
          <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 10, padding: 12, maxWidth: 1100 }}>
            <div style={{ fontWeight: "bold", marginBottom: 8 }}>Soccer filters</div>
            {loadingCatalog ? <div>Loading regions/countries/leagues…</div> : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Region</div>
                <select
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value);
                    setCountry("");
                    setLeagueCode("");
                    setLeagueLabel("");
                  }}
                  style={{ padding: 10, minWidth: 220 }}
                >
                  <option value="">(All / Popular mix)</option>
                  {regions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Country</div>
                <select
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    setLeagueCode("");
                    setLeagueLabel("");
                  }}
                  style={{ padding: 10, minWidth: 240 }}
                  disabled={!region}
                >
                  <option value="">{region ? "(Pick a country)" : "(Pick a region first)"}</option>
                  {countries.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>League</div>
                <select
                  value={leagueCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setLeagueCode(code);
                    const found = leagues.find((x) => x.leagueCode === code);
                    setLeagueLabel(found?.league || "");
                  }}
                  style={{ padding: 10, minWidth: 340 }}
                  disabled={!country}
                >
                  <option value="">{country ? "(Pick a league)" : "(Pick a country first)"}</option>
                  {leagues.map((l) => (
                    <option key={l.leagueCode} value={l.leagueCode}>
                      {l.league}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button
                  onClick={() => {
                    setRegion("");
                    setCountry("");
                    setLeagueCode("");
                    setLeagueLabel("");
                  }}
                  style={{ padding: 10 }}
                >
                  Clear soccer filters
                </button>
              </div>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
              Tip: Pick a league for the cleanest schedule. Leave empty to see a “popular mix”.
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setTab("all")} style={{ padding: 10, fontWeight: tab === "all" ? "bold" : "normal" }}>
            All Today
          </button>
          <button onClick={() => setTab("live")} style={{ padding: 10, fontWeight: tab === "live" ? "bold" : "normal" }}>
            Live
          </button>
          <button onClick={() => setTab("finished")} style={{ padding: 10, fontWeight: tab === "finished" ? "bold" : "normal" }}>
            Finished
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <h2 style={{ marginTop: 0 }}>Games</h2>

          {apiError ? (
            <div style={{ border: "2px solid #b00", padding: 10, borderRadius: 10, marginBottom: 10 }}>
              <b>Backend/API error:</b> {apiError}
            </div>
          ) : null}

          {loadingGames ? <div>Loading…</div> : null}

          <div style={{ border: "1px solid #ddd", padding: 10, maxHeight: "70vh", overflowY: "auto" }}>
            {filteredGames.length === 0 ? <div>No games found for this selection.</div> : null}

            {filteredGames.map((g) => {
              const showScore = !isNotStarted(g.status) && scoreLine(g);

              return (
                <div key={g.id} style={{ borderBottom: "1px solid #eee", padding: "10px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: "bold" }}>{gameTitle(g)}</div>

                      {showScore ? (
                        <div style={{ marginTop: 4 }}>{showScore}</div>
                      ) : (
                        <div style={{ marginTop: 4, opacity: 0.8 }}>
                          {fmtTime(g.startTime)} {g.status ? `• ${g.status}` : ""}
                        </div>
                      )}

                      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                        {g.league ? `${g.league}` : ""}
                        {g.country ? ` • ${g.country}` : ""}
                      </div>
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.75, textAlign: "right" }}>{g.status}</div>
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => joinPublic(g)}>Join Public (Chat)</button>
                    <button onClick={() => createPrivate(g)}>Create Private (Chat + Bets + Video)</button>

                    {/* ✅ Your requested 3rd button */}
                    <button onClick={() => openJoinPrivateByCode(g)}>Join Private (Code)</button>
                  </div>

                  {/* ✅ Code input appears under the game you clicked */}
                  {showJoinPrivate && selectedGame?.id === g.id ? (
                    <div style={{ marginTop: 10, border: "1px solid #aaa", borderRadius: 10, padding: 10, maxWidth: 480 }}>
                      <div style={{ fontWeight: "bold" }}>Enter private code</div>
                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                        Example: <b>AB12CD</b>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Private code" style={{ flex: 1, padding: 10 }} />
                        <button onClick={confirmJoinPrivate}>Join</button>
                        <button
                          onClick={() => {
                            setShowJoinPrivate(false);
                            setJoinCode("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ROOM
  const privateRoom = isPrivateRoom(roomId);

  return (
    <div style={{ height: "100vh", display: "flex", fontFamily: "Arial, sans-serif" }}>
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <b>Room:</b> {roomId}
            {selectedGame ? (
              <>
                {" "}
                • <b>{gameTitle(selectedGame)}</b>
              </>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => {
                stopVideo();
                setStep("lobby");
                setRoomId("");
              }}
            >
              Back
            </button>
            <button onClick={logout}>Log out</button>
          </div>
        </div>

        {privateRoom ? (
          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
            <b>Private room video:</b>{" "}
            {!videoEnabled ? (
              <button onClick={startVideo} style={{ marginLeft: 8 }}>
                Start Webcam + Mic
              </button>
            ) : (
              <button onClick={stopVideo} style={{ marginLeft: 8 }}>
                Stop Webcam + Mic
              </button>
            )}

            <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {videoEnabled ? (
                <>
                  <div style={{ border: "1px solid #aaa", padding: 6, borderRadius: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>You</div>
                    <video
                      autoPlay
                      playsInline
                      muted
                      style={{ width: 220, height: 140, background: "#000", borderRadius: 8 }}
                      ref={(el) => {
                        if (el && localStream) el.srcObject = localStream;
                      }}
                    />
                  </div>

                  {users
                    .filter((u) => u.id && u.username !== username)
                    .map((u) => (
                      <div key={u.id} style={{ border: "1px solid #aaa", padding: 6, borderRadius: 8 }}>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>{u.username}</div>
                        <video
                          autoPlay
                          playsInline
                          style={{ width: 220, height: 140, background: "#000", borderRadius: 8 }}
                          ref={(el) => {
                            if (el) remoteVideoRefs.current[u.id] = el;
                          }}
                        />
                      </div>
                    ))}
                </>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.8 }}>Video is OFF. Click “Start Webcam + Mic” to enable (private rooms only).</div>
              )}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12, minHeight: 120 }}>
          <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: "bold" }}>People</div>
            <div style={{ marginTop: 8 }}>
              {users.map((u) => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f1f1" }}>
                  <div>
                    {u.username} {u.username === username ? "(you)" : ""}
                    <div style={{ fontSize: 12, opacity: 0.7 }}>Credits: {u.credits}</div>
                  </div>
                  {u.username !== username ? (
                    <button onClick={() => openBetToUser(u)} style={{ height: 34 }}>
                      Offer Bet
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {betTarget ? (
            <div style={{ width: 360, border: "2px solid #111", borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: "bold" }}>Bet offer to: {betTarget.username}</div>

              <input value={betTitle} onChange={(e) => setBetTitle(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 8 }} />

              <input value={betPick} onChange={(e) => setBetPick(e.target.value)} placeholder="Your pick" style={{ width: "100%", padding: 10, marginTop: 8 }} />

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input type="number" value={betStake} onChange={(e) => setBetStake(Number(e.target.value))} style={{ width: 140, padding: 10 }} />
                <button onClick={createOffer} style={{ flex: 1 }}>
                  Send offer
                </button>
              </div>

              <button onClick={() => setBetTarget(null)} style={{ marginTop: 8, width: "100%", padding: 10 }}>
                Close
              </button>
            </div>
          ) : (
            <div style={{ width: 360, border: "1px dashed #aaa", borderRadius: 10, padding: 10, opacity: 0.95 }}>
              <div style={{ fontWeight: "bold" }}>Bets</div>

              <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
                {bets.length === 0 ? <div style={{ opacity: 0.7 }}>No bets yet.</div> : null}

                {bets.map((b) => (
                  <div key={b.id} style={{ borderBottom: "1px solid #eee", paddingBottom: 10, marginBottom: 10 }}>
                    <div style={{ fontWeight: "bold" }}>{b.title}</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      {b.creatorName} → {b.targetName} • stake {b.creatorStake}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      Status: <b>{b.status}</b>
                    </div>

                    {b.status === "pending" && b.creatorName === username ? (
                      <button onClick={() => cancelOffer(b)} style={{ marginTop: 6 }}>
                        Cancel
                      </button>
                    ) : null}

                    {b.status === "pending" && b.targetName === username ? (
                      <div style={{ marginTop: 6 }}>
                        <input value={acceptPick} onChange={(e) => setAcceptPick(e.target.value)} placeholder="Your pick" style={{ width: "100%", padding: 10 }} />
                        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                          <input type="number" value={acceptStake} onChange={(e) => setAcceptStake(Number(e.target.value))} style={{ width: 140, padding: 10 }} />
                          <button onClick={() => acceptOffer(b)} style={{ flex: 1 }}>
                            Accept
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, border: "1px solid #000", borderRadius: 10, padding: 10, overflowY: "auto" }} ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <b>{m.user}:</b> {m.text}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type message"
            style={{ flex: 1, padding: 10 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage();
            }}
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      </div>
    </div>
  );
}