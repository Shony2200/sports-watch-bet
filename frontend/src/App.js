// frontend/src/App.js
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");

export default function App() {
  const [sport, setSport] = useState("soccer");

  const [regions, setRegions] = useState([]);
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [league, setLeague] = useState("");

  const [games, setGames] = useState([]);
  const [error, setError] = useState("");

  async function loadCatalog(nextSport) {
    setError("");
    setRegions([]);
    setRegion("");
    setCountry("");
    setLeague("");

    try {
      const url = `${BACKEND}/api/catalog?sport=${encodeURIComponent(nextSport)}`;
      const res = await axios.get(url, { withCredentials: true });
      const r = res.data?.regions || [];
      setRegions(r);
    } catch (e) {
      setError(`Backend/API error: ${e?.message || "Network Error"}`);
    }
  }

  async function loadGames() {
    setError("");
    setGames([]);

    try {
      const qs = new URLSearchParams();
      qs.set("sport", sport);
      if (region) qs.set("region", region);
      if (country) qs.set("country", country);
      if (league) qs.set("league", league);

      const url = `${BACKEND}/api/games?${qs.toString()}`;
      const res = await axios.get(url, { withCredentials: true });
      setGames(res.data?.games || []);
    } catch (e) {
      setError(`Backend/API error: ${e?.message || "Network Error"}`);
    }
  }

  useEffect(() => {
    if (!BACKEND) {
      setError("Missing REACT_APP_BACKEND_URL on Vercel.");
      return;
    }
    loadCatalog(sport);
    // also load games once (will be empty by default)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const regionOptions = useMemo(() => {
    return regions.map((r) => r.region);
  }, [regions]);

  const countryOptions = useMemo(() => {
    const r = regions.find((x) => x.region === region);
    return r?.countries?.map((c) => c.country) || [];
  }, [regions, region]);

  const leagueOptions = useMemo(() => {
    const r = regions.find((x) => x.region === region);
    const c = r?.countries?.find((x) => x.country === country);
    return c?.leagues || [];
  }, [regions, region, country]);

  useEffect(() => {
    // whenever filters change, try to load games
    if (!BACKEND) return;
    loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, region, country, league]);

  return (
    <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>
      <h2>Lobby</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["soccer", "nba", "nfl", "nhl", "mlb"].map((s) => (
          <button
            key={s}
            onClick={() => setSport(s)}
            style={{ padding: "8px 12px", cursor: "pointer" }}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <h3>Soccer filters</h3>

      <div style={{ display: "grid", gridTemplateColumns: "200px 250px", gap: 12, maxWidth: 500 }}>
        <label>Region</label>
        <select value={region} onChange={(e) => { setRegion(e.target.value); setCountry(""); setLeague(""); }}>
          <option value="">(All / Popular mix)</option>
          {regionOptions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <label>Country</label>
        <select value={country} onChange={(e) => { setCountry(e.target.value); setLeague(""); }} disabled={!region}>
          <option value="">{region ? "(Select country)" : "(Pick a region first)"}</option>
          {countryOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <label>League</label>
        <select value={league} onChange={(e) => setLeague(e.target.value)} disabled={!country}>
          <option value="">{country ? "(Select league)" : "(Pick a country first)"}</option>
          {leagueOptions.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <h3 style={{ marginTop: 24 }}>Games</h3>

      {error ? (
        <div style={{ border: "1px solid #c00", padding: 12, color: "#c00", maxWidth: 700 }}>
          {error}
          <div style={{ marginTop: 6, color: "#900" }}>
            If deployed: check REACT_APP_BACKEND_URL on Vercel + FRONTEND_URL on Railway.
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        {games.length === 0 ? <div>No games found for this selection.</div> : null}
        {games.map((g, idx) => (
          <div key={idx} style={{ padding: 8, borderBottom: "1px solid #ddd" }}>
            {JSON.stringify(g)}
          </div>
        ))}
      </div>
    </div>
  );
}