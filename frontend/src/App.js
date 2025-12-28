// frontend/src/App.js
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const BACKEND =
  process.env.REACT_APP_BACKEND_URL ||
  "http://localhost:8080"; // local backend

function safeKeys(obj) {
  return obj ? Object.keys(obj) : [];
}

export default function App() {
  const [sport, setSport] = useState("soccer");

  const [catalog, setCatalog] = useState(null);
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [league, setLeague] = useState("");
  const [status, setStatus] = useState("Today");

  const [games, setGames] = useState([]);
  const [error, setError] = useState("");

  // load catalog whenever sport changes
  useEffect(() => {
    setError("");
    setCatalog(null);
    setRegion("");
    setCountry("");
    setLeague("");

    axios
      .get(`${BACKEND}/api/catalog`, { params: { sport } })
      .then((res) => setCatalog(res.data.data))
      .catch((e) => {
        setError(`Backend/API error: ${e?.message || "Unknown error"}`);
      });
  }, [sport]);

  const regionOptions = useMemo(() => {
    if (sport !== "soccer") return [];
    return ["", ...safeKeys(catalog)];
  }, [catalog, sport]);

  const countryOptions = useMemo(() => {
    if (sport !== "soccer") return [];
    if (!region || !catalog?.[region]) return [""];
    return ["", ...safeKeys(catalog[region])];
  }, [catalog, region, sport]);

  const leagueOptions = useMemo(() => {
    if (sport !== "soccer") {
      const leagues = catalog?.leagues || [];
      return ["", ...leagues];
    }
    if (!region || !country) return [""];
    return ["", ...(catalog?.[region]?.[country] || [])];
  }, [catalog, region, country, sport]);

  // load games
  useEffect(() => {
    setError("");

    const params = {
      sport,
      status,
    };
    if (sport === "soccer") {
      if (region) params.region = region;
      if (country) params.country = country;
      if (league) params.league = league;
    } else {
      if (league) params.league = league;
    }

    axios
      .get(`${BACKEND}/api/games`, { params })
      .then((res) => setGames(res.data.games || []))
      .catch((e) => {
        setGames([]);
        setError(`Backend/API error: ${e?.message || "Unknown error"}`);
      });
  }, [sport, region, country, league, status]);

  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h1>Lobby</h1>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {["soccer", "nba", "nfl", "nhl", "mlb"].map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            style={{
              padding: "10px 18px",
              border: "1px solid #888",
              background: sport === s ? "#ddd" : "#fff",
              cursor: "pointer",
            }}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <h2>Filters</h2>

      {sport === "soccer" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 700 }}>
          <div>
            <div>Region</div>
            <select value={region} onChange={(e) => { setRegion(e.target.value); setCountry(""); setLeague(""); }}>
              {regionOptions.map((r) => (
                <option key={r || "all"} value={r}>
                  {r || "(All / Popular mix)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div>Country</div>
            <select value={country} onChange={(e) => { setCountry(e.target.value); setLeague(""); }} disabled={!region}>
              {countryOptions.map((c) => (
                <option key={c || "none"} value={c}>
                  {c || "(Pick a region first)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div>League</div>
            <select value={league} onChange={(e) => setLeague(e.target.value)} disabled={!country}>
              {leagueOptions.map((l) => (
                <option key={l || "none"} value={l}>
                  {l || "(Pick a country first)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div>Status</div>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["Today", "Live", "Finished"].map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 700 }}>
          <div>
            <div>League</div>
            <select value={league} onChange={(e) => setLeague(e.target.value)}>
              {leagueOptions.map((l) => (
                <option key={l || "all"} value={l}>
                  {l || "(All)"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div>Status</div>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {["Today", "Live", "Finished"].map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 24 }}>Games</h2>

      {error ? (
        <div style={{ border: "1px solid red", padding: 12, color: "red", maxWidth: 900 }}>
          {error}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            If deployed: check <b>REACT_APP_BACKEND_URL</b> on Vercel + <b>FRONTEND_URL</b> on Railway.
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        {games.length === 0 ? (
          <div>No games found for this selection.</div>
        ) : (
          <ul>
            {games.map((g) => (
              <li key={g.id}>
                <b>{g.league}</b> — {g.home} vs {g.away} — {g.status} — {g.time}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}