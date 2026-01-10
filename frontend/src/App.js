import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import Peer from "simple-peer";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:3000";
const socket = io(BACKEND, { transports: ["websocket", "polling"] });

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
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}

function isLive(status) {
  const s = String(status || "").toUpperCase();
  return s.includes("LIVE") || s.includes("IN PROGRESS") || s.includes("Q") || s.includes("PERIOD") || s.includes("HALF");
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
  const hasScore = g?.homeScore !== null && g?.awayScore !== null && g?.homeScore != null && g?.awayScore != null;
  if (!hasScore) return "";
  if (g.sport === "soccer" && g.penalties && g.penalties.homePens != null && g.penalties.awayPens != null) {
    return `${g.awayScore}-${g.homeScore} (pens ${g.penalties.awayPens}-${g.penalties.homePens})`;
  }
  return `${g.awayScore}-${g.homeScore}`;
}

function isoDateFromStartTime(startTime) {
  const s = String(startTime || "");
  if (s.length >= 10 && s[4] === "-" && s[7] === "-") return s.slice(0, 10);
  return todayISO();
}

export default function App() {
  const [username, setUsername] = useState(localStorage.getItem("wb_username") || "");
  const [step, setStep] = useState(username ? "lobby" : "enterName"); // enterName | lobby | room

  const [sport, setSport] = useState("soccer");
  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState("all");

  const [catalog, setCatalog] = useState([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [leagueCode, setLeagueCode] = useState("");

  const [games, setGames] = useState([]);
  const [loadingGames, setLoadingGames] = useState(false);
  const [apiError, setApiError] = useState("");

  const [roomId, setRoomId] = useState("");
  const [selectedGame, setSelectedGame] = useState(null);

  const [roomGameLive, setRoomGameLive] = useState(null);
  const [roomGameError, setRoomGameError] = useState("");

  const [users, setUsers] = useState([]); // [{username, credits, online}]
  const [videoReadyUsers, setVideoReadyUsers] = useState([]); // usernames ready
  const [bets, setBets] = useState([]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  const [betTarget, setBetTarget] = useState(null); // username
  const [betTitle, setBetTitle] = useState("");
  const [betStake, setBetStake] = useState(100);
  const [betPick, setBetPick] = useState("");

  const [acceptPick, setAcceptPick] = useState("");
  const [acceptStake, setAcceptStake] = useState(100);

  const [showJoinPrivate, setShowJoinPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  // WebRTC
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [iceServers, setIceServers] = useState([]);
  const peersRef = useRef({});           // username -> Peer
  const remoteVideoRefs = useRef({});    // username -> video element
  const remoteStreamsRef = useRef({});   // username -> MediaStream
  const pendingSignalsRef = useRef({});  // username -> [signal]

  const scrollRef = useRef(null);

  function isPrivateRoom(rid) {
    return String(rid || "").startsWith("private:");
  }

  // deterministic initiator: compare usernames (stable)
  function shouldInitiate(peerUsername) {
    return String(username) < String(peerUsername);
  }

  async function loadIceServers() {
    try {
      const res = await axios.get(`${BACKEND}/api/ice`, { timeout: 15000 });
      setIceServers(res.data.iceServers || []);
    } catch {
      setIceServers([{ urls: "stun:stun.l.google.com:19302" }]);
    }
  }

  // Catalog
  async function loadCatalog() {
    setLoadingCatalog(true);
    try {
      const res = await axios.get(`${BACKEND}/api/catalog`, { params: { sport: "soccer" }, timeout: 15000 });
      setCatalog(res.data.regions || []);
    } catch {
      setCatalog([]);
    } finally {
      setLoadingCatalog(false);
    }
  }

  useEffect(() => {
    loadCatalog();
    loadIceServers();
  }, []);

  // Games
  async function loadGames() {
    setLoadingGames(true);
    setApiError("");
    try {
      const params = { sport, date };
      if (sport === "soccer" && leagueCode) params.leagueCode = leagueCode;

      const res = await axios.get(`${BACKEND}/api/games`, { params, timeout: 25000 });
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

  // Room live score polling
  useEffect(() => {
    if (step !== "room" || !selectedGame?.id || !selectedGame?.sport) return;

    let alive = true;
    const poll = async () => {
      try {
        setRoomGameError("");
        const d = isoDateFromStartTime(selectedGame.startTime);
        const res = await axios.get(`${BACKEND}/api/games`, {
          params: { sport: selectedGame.sport, date: d, leagueCode: selectedGame.leagueCode || "" },
          timeout: 20000,
        });
        const list = res.data?.games || [];
        const found = list.find((x) => String(x.id) === String(selectedGame.id));
        if (alive) setRoomGameLive(found || null);
      } catch (e) {
        const msg = e?.response?.data?.details || e?.message || "Live score fetch failed";
        if (alive) setRoomGameError(String(msg));
      }
    };

    poll();
    const t = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [step, selectedGame?.id, selectedGame?.sport, selectedGame?.startTime, selectedGame?.leagueCode]);

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

  const filteredGames = useMemo(() => {
    const list = games || [];
    if (tab === "live") return list.filter((g) => isLive(g.status));
    if (tab === "finished") return list.filter((g) => isFinished(g.status));

    const live = list.filter((g) => isLive(g.status)).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const upcoming = list.filter((g) => !isLive(g.status) && !isFinished(g.status)).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const finished = list.filter((g) => isFinished(g.status)).sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    return [...live, ...upcoming, ...finished];
  }, [games, tab]);

  useEffect(() => {
    if (sport !== "soccer") {
      setRegion("");
      setCountry("");
      setLeagueCode("");
    }
  }, [sport]);

  // ---------------- WebRTC helpers ----------------
  function attachStreamToVideo(peerUsername) {
    const el = remoteVideoRefs.current[peerUsername];
    const stream = remoteStreamsRef.current[peerUsername];
    if (!el || !stream) return false;
    try {
      if (el.srcObject !== stream) el.srcObject = stream;
      const p = el.play?.();
      if (p?.catch) p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  function attachStreamWithRetry(peerUsername) {
    let tries = 0;
    const tick = () => {
      tries += 1;
      const ok = attachStreamToVideo(peerUsername);
      if (ok) return;
      if (tries < 20) setTimeout(tick, 250);
    };
    tick();
  }

  function createPeer(peerUsername) {
    if (!peerUsername) return null;
    if (peerUsername === username) return null;
    if (peersRef.current[peerUsername]) return peersRef.current[peerUsername];

    const initiator = shouldInitiate(peerUsername);

    const peer = new Peer({
      initiator,
      trickle: true,
      stream: localStream,
      config: { iceServers: iceServers?.length ? iceServers : [{ urls: "stun:stun.l.google.com:19302" }] },
    });

    peer.on("signal", (data) => {
      socket.emit("signal", {
        roomId,
        toUsername: peerUsername,
        fromUsername: username,
        data,
      });
    });

    const onRemoteStream = (stream) => {
      remoteStreamsRef.current[peerUsername] = stream;
      attachStreamWithRetry(peerUsername);
    };

    peer.on("stream", onRemoteStream);
    peer.on("track", (track, stream) => {
      if (stream) onRemoteStream(stream);
    });

    peer.on("close", () => {
      delete peersRef.current[peerUsername];
      delete remoteVideoRefs.current[peerUsername];
      delete remoteStreamsRef.current[peerUsername];
    });

    peer.on("error", () => {});

    peersRef.current[peerUsername] = peer;

    const pending = pendingSignalsRef.current[peerUsername];
    if (pending?.length) {
      pending.forEach((sig) => {
        try {
          peer.signal(sig);
        } catch {}
      });
      delete pendingSignalsRef.current[peerUsername];
    }

    return peer;
  }

  function stopVideo() {
    setVideoEnabled(false);

    Object.values(peersRef.current).forEach((p) => {
      try {
        p.destroy();
      } catch {}
    });
    peersRef.current = {};
    remoteStreamsRef.current = {};
    pendingSignalsRef.current = {};

    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
  }

  async function startVideo() {
    if (!isPrivateRoom(roomId)) return;
    try {
      await loadIceServers();

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      setVideoEnabled(true);

      // Tell others I'm ready
      socket.emit("video-ready", { roomId, username });

      // Connect ONLY to already-ready users
      const ready = new Set(videoReadyUsers || []);
      (users || [])
        .map((u) => u.username)
        .filter((name) => name && name !== username && ready.has(name))
        .forEach((name) => createPeer(name));
    } catch {
      alert("Could not start camera/mic. Check browser permissions.");
    }
  }

  // ---------------- Socket listeners ----------------
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
      setVideoReadyUsers(st.videoReadyUsers || []);
    };

    // when other user becomes video-ready
    const onVideoReady = ({ username: peerName }) => {
      if (!peerName) return;
      if (videoEnabled && localStream) createPeer(peerName);
    };

    // signal from other peer (by username)
    const onSignal = ({ fromUsername, data }) => {
      if (!fromUsername || !data) return;

      if (!videoEnabled || !localStream) {
        if (!pendingSignalsRef.current[fromUsername]) pendingSignalsRef.current[fromUsername] = [];
        pendingSignalsRef.current[fromUsername].push(data);
        return;
      }

      let p = peersRef.current[fromUsername];
      if (!p) p = createPeer(fromUsername);

      try {
        p.signal(data);
      } catch {}
    };

    socket.on("message", onMessage);
    socket.on("room-state", onRoomState);
    socket.on("signal", onSignal);
    socket.on("video-ready", onVideoReady);

    return () => {
      socket.off("message", onMessage);
      socket.off("room-state", onRoomState);
      socket.off("signal", onSignal);
      socket.off("video-ready", onVideoReady);
    };
  }, [step, videoEnabled, localStream, roomId, username, videoReadyUsers, users]);

  // ---------------- Auth / join ----------------
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
    setStep("enterName");
    setRoomId("");
    setSelectedGame(null);
  }

  function joinPublic(game) {
    const rid = `public:${sport}:${game.id}`;
    setRoomId(rid);
    setSelectedGame(game);
    setRoomGameLive(null);
    setUsers([]);
    setBets([]);
    setMessages([]);
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
    setRoomGameLive(null);
    setUsers([]);
    setBets([]);
    setMessages([]);
    setApiError("");
    setShowJoinPrivate(false);
    setJoinCode("");
    stopVideo();
    socket.emit("joinRoom", { roomId: rid, username, match: game });
    setStep("room");
  }

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

  // ---------------- Bets ----------------
  const pickOptions = useMemo(() => {
    if (!selectedGame) return [];
    return [
      { label: selectedGame.away, value: `${selectedGame.away} win` },
      { label: selectedGame.home, value: `${selectedGame.home} win` },
    ];
  }, [selectedGame]);

  function openBetToUser(uName) {
    setBetTarget(uName);
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
      targetUsername: betTarget,
      title: betTitle,
      stake: Number(betStake || 0),
      pick: betPick,
      creatorUsername: username,
    });

    setBetTarget(null);
  }

  function acceptOffer(b) {
    if (!acceptPick.trim()) return;
    socket.emit("acceptBetOffer", {
      roomId,
      betId: b.id,
      targetPick: acceptPick,
      targetStake: Number(acceptStake || b.targetStake || 0),
      username,
    });
  }

  function requestCancel(b) {
    socket.emit("requestCancelBet", { roomId, betId: b.id, username });
  }

  // ---------------- UI ----------------
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
            <button onClick={logout}>Logout</button>
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
          <SoccerFilters
            loadingCatalog={loadingCatalog}
            catalog={catalog}
            region={region}
            setRegion={setRegion}
            country={country}
            setCountry={setCountry}
            leagueCode={leagueCode}
            setLeagueCode={setLeagueCode}
            regions={regions}
            countries={countries}
            leagues={leagues}
          />
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
                    <button onClick={() => openJoinPrivateByCode(g)}>Join Private (Code)</button>
                  </div>

                  {showJoinPrivate && selectedGame?.id === g.id ? (
                    <div style={{ marginTop: 10, border: "1px solid #aaa", borderRadius: 10, padding: 10, maxWidth: 480 }}>
                      <div style={{ fontWeight: "bold" }}>Enter private code</div>
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

  // ROOM VIEW
  const privateRoom = isPrivateRoom(roomId);
  const liveHeaderGame = roomGameLive || selectedGame;
  const liveScoreText = liveHeaderGame ? scoreLine(liveHeaderGame) : "";
  const liveStatusText = liveHeaderGame?.status ? String(liveHeaderGame.status) : "";

  return (
    <div style={{ height: "100vh", display: "flex", fontFamily: "Arial, sans-serif" }}>
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <b>Room:</b> {roomId}
            {selectedGame ? (
              <>
                {" "}
                • <b>{gameTitle(selectedGame)}</b> • <b>{liveScoreText || "—"}</b>{" "}
                <span style={{ opacity: 0.8 }}>({liveStatusText || "status"})</span>
              </>
            ) : null}
            {roomGameError ? <span style={{ marginLeft: 10, color: "#b00" }}>Live score error: {roomGameError}</span> : null}
          </div>

          <button
            onClick={() => {
              stopVideo();
              setStep("lobby");
              setRoomId("");
            }}
          >
            Back
          </button>
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
                        if (!el || !localStream) return;
                        el.srcObject = localStream;
                        const p = el.play?.();
                        if (p?.catch) p.catch(() => {});
                      }}
                    />
                  </div>

                  {users
                    .map((u) => u.username)
                    .filter((name) => name && name !== username)
                    .map((name) => (
                      <div key={name} style={{ border: "1px solid #aaa", padding: 6, borderRadius: 8 }}>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>{name}</div>
                        <video
                          autoPlay
                          playsInline
                          muted
                          style={{ width: 220, height: 140, background: "#000", borderRadius: 8 }}
                          ref={(el) => {
                            if (!el) return;
                            remoteVideoRefs.current[name] = el;
                            attachStreamWithRetry(name);
                          }}
                          onClick={(e) => {
                            e.currentTarget.muted = false;
                            const p = e.currentTarget.play?.();
                            if (p?.catch) p.catch(() => {});
                          }}
                        />
                      </div>
                    ))}
                </>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.8 }}>Video is OFF. Click “Start Webcam + Mic”.</div>
              )}
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12, minHeight: 120 }}>
          <div style={{ flex: 1, border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: "bold" }}>People</div>
            <div style={{ marginTop: 8 }}>
              {users.map((u) => (
                <div key={u.username} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f1f1" }}>
                  <div>
                    {u.username} {u.username === username ? "(you)" : ""}
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      Credits: {u.credits} • {u.online ? "online" : "offline"}
                    </div>
                  </div>
                  {u.username !== username ? (
                    <button onClick={() => openBetToUser(u.username)} style={{ height: 34 }}>
                      Offer Bet
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {betTarget ? (
            <div style={{ width: 380, border: "2px solid #111", borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: "bold" }}>Bet offer to: {betTarget}</div>
              <input value={betTitle} onChange={(e) => setBetTitle(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 8 }} />

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>Your pick (click one):</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {pickOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setBetPick(opt.value)}
                    style={{
                      padding: "10px 12px",
                      border: betPick === opt.value ? "2px solid #000" : "1px solid #aaa",
                      borderRadius: 10,
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input type="number" value={betStake} onChange={(e) => setBetStake(Number(e.target.value))} style={{ width: 140, padding: 10 }} />
                <button onClick={createOffer} style={{ flex: 1 }} disabled={!betPick.trim()}>
                  Send offer
                </button>
              </div>

              <button onClick={() => setBetTarget(null)} style={{ marginTop: 8, width: "100%", padding: 10 }}>
                Close
              </button>
            </div>
          ) : (
            <div style={{ width: 380, border: "1px dashed #aaa", borderRadius: 10, padding: 10, opacity: 0.95 }}>
              <div style={{ fontWeight: "bold" }}>Bets</div>

              <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
                {bets.length === 0 ? <div style={{ opacity: 0.7 }}>No bets yet.</div> : null}

                {bets.map((b) => {
                  const isCreator = b.creatorName === username;
                  const isTarget = b.targetName === username;
                  const canCancel = (b.status === "pending" || b.status === "active" || b.status === "cancel_pending") && (isCreator || isTarget);

                  return (
                    <div key={b.id} style={{ borderBottom: "1px solid #eee", paddingBottom: 10, marginBottom: 10 }}>
                      <div style={{ fontWeight: "bold" }}>{b.title}</div>

                      <div style={{ fontSize: 12, marginTop: 6 }}>
                        <div>
                          <b>{b.creatorName}</b>: {b.creatorPick || "-"} • stake {b.creatorStake}
                        </div>
                        <div>
                          <b>{b.targetName}</b>: {b.targetPick || "-"} • stake {b.targetStake}
                        </div>
                      </div>

                      <div style={{ fontSize: 12, marginTop: 6 }}>
                        Status: <b>{b.status}</b>
                        {b.status === "settled" ? (
                          <span>
                            {" "}
                            • Winner: <b>{b.winnerName}</b>
                          </span>
                        ) : null}
                      </div>

                      {b.status === "pending" && isTarget ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 12, opacity: 0.75 }}>Your pick (click one):</div>
                          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                            {pickOptions.map((opt) => (
                              <button
                                key={opt.value}
                                onClick={() => setAcceptPick(opt.value)}
                                style={{
                                  padding: "10px 12px",
                                  border: acceptPick === opt.value ? "2px solid #000" : "1px solid #aaa",
                                  borderRadius: 10,
                                  background: "#fff",
                                  cursor: "pointer",
                                }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>

                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <input type="number" value={acceptStake} onChange={(e) => setAcceptStake(Number(e.target.value))} style={{ width: 140, padding: 10 }} />
                            <button onClick={() => acceptOffer(b)} style={{ flex: 1 }} disabled={!acceptPick.trim()}>
                              Accept
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {canCancel ? (
                        <div style={{ marginTop: 8 }}>
                          <button onClick={() => requestCancel(b)}>
                            {b.status === "cancel_pending" ? "Confirm cancel (needs both)" : "Request cancel (needs both)"}
                          </button>
                          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                            Cancel confirmations — creator: {b.cancel?.creator ? "yes" : "no"}, target: {b.cancel?.target ? "yes" : "no"}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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

// Small extracted component to keep file readable
function SoccerFilters({
  loadingCatalog,
  catalog,
  region,
  setRegion,
  country,
  setCountry,
  leagueCode,
  setLeagueCode,
  regions,
  countries,
  leagues,
}) {
  return (
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
          <select value={leagueCode} onChange={(e) => setLeagueCode(e.target.value)} style={{ padding: 10, minWidth: 340 }} disabled={!country}>
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
            }}
            style={{ padding: 10 }}
          >
            Clear soccer filters
          </button>
        </div>
      </div>
    </div>
  );
}
