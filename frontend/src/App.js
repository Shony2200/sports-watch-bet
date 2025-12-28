import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const BACKEND =
  process.env.REACT_APP_BACKEND_URL ||
  "http://localhost:3000";
function api(path) {
  if (!BACKEND) throw new Error("Missing REACT_APP_BACKEND_URL");
  return `${BACKEND}${path}`;
}

export default function App() {
  const [sport, setSport] = useState("soccer");
  const [date, setDate] = useState(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  });

  const [catalog, setCatalog] = useState(null);
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [leagueKey, setLeagueKey] = useState("");

  const [events, setEvents] = useState([]);
  const [err, setErr] = useState("");

  // Load soccer catalog
  useEffect(() => {
    if (sport !== "soccer") return;

    (async () => {
      try {
        setErr("");
        const r = await axios.get(api(`/api/catalog?sport=soccer`), { withCredentials: true });
        setCatalog(r.data);

        // default region
        const firstRegion = r.data?.regions?.[0] || "";
        setRegion(firstRegion);
      } catch (e) {
        setErr(`Backend/API error: ${e?.message || "Network Error"}`);
      }
    })();
  }, [sport]);

  // When region changes, pick first country
  useEffect(() => {
    if (!catalog || !region) return;
    const countries = catalog.countriesByRegion?.[region] || [];
    const firstCountry = countries[0] || "";
    setCountry(firstCountry);
  }, [catalog, region]);

  // When country changes, pick first league
  useEffect(() => {
    if (!catalog || !country) return;
    const leagues = catalog.leaguesByCountry?.[country] || [];
    setLeagueKey(leagues[0]?.key || "");
  }, [catalog, country]);

  const leaguesForCountry = useMemo(() => {
    if (!catalog || !country) return [];
    return catalog.leaguesByCountry?.[country] || [];
  }, [catalog, country]);

  async function loadGames() {
    try {
      setErr("");
      setEvents([]);

      let url = "";
      if (sport === "soccer") {
        url = api(`/api/games?sport=soccer&date=${date}&leagueKey=${encodeURIComponent(leagueKey)}`);
      } else {
        url = api(`/api/games?sport=${sport}&date=${date}`);
      }

      const r = await axios.get(url, { withCredentials: true });
      setEvents(r.data?.events || []);
    } catch (e) {
      setErr(`Backend/API error: ${e?.message || "Network Error"}`);
    }
  }

  useEffect(() => {
    // auto-load whenever key options change
    if (!BACKEND) {
      setErr("Backend/API error: Missing REACT_APP_BACKEND_URL on Vercel/local env");
      return;
    }
    loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, date, leagueKey]);

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h2>Lobby</h2>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {["soccer", "nba", "nfl", "nhl", "mlb"].map(s => (
          <button
            key={s}
            onClick={() => setSport(s)}
            style={{
              padding: "8px 14px",
              border: "1px solid #333",
              background: sport === s ? "#eee" : "white",
              cursor: "pointer"
            }}
          >
            {s.toUpperCase()}
          </button>
        ))}

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: "8px 10px" }}
        />

        <button onClick={loadGames} style={{ padding: "8px 14px" }}>
          Refresh
        </button>
      </div>

      {sport === "soccer" && (
        <div style={{ marginTop: 20, border: "1px solid #ccc", padding: 14 }}>
          <h3>Soccer filters</h3>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div>Region</div>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                style={{ padding: 8, minWidth: 220 }}
              >
                {(catalog?.regions || []).map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <div>Country</div>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                style={{ padding: 8, minWidth: 220 }}
              >
                {(catalog?.countriesByRegion?.[region] || []).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <div>League</div>
              <select
                value={leagueKey}
                onChange={(e) => setLeagueKey(e.target.value)}
                style={{ padding: 8, minWidth: 260 }}
              >
                {leaguesForCountry.map(l => (
                  <option key={l.key} value={l.key}>{l.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#555" }}>
            Tip: If ESPN doesn’t have games for that date/league, it will show “No games found” (not an error).
          </div>
        </div>
      )}

      <h3 style={{ marginTop: 20 }}>Games</h3>

      {err && (
        <div style={{ border: "1px solid red", padding: 10, color: "darkred" }}>
          {err}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            If deployed: check <b>REACT_APP_BACKEND_URL</b> on Vercel and your Railway backend health.
          </div>
        </div>
      )}

      {!err && events.length === 0 && (
        <div style={{ padding: 10, color: "#555" }}>
          No games found for this selection.
        </div>
      )}

      {events.map(ev => (
        <div key={ev.id} style={{ padding: 10, borderBottom: "1px solid #ddd" }}>
          <div style={{ fontWeight: "bold" }}>{ev.name}</div>
          <div style={{ fontSize: 12, color: "#666" }}>
            {ev.shortStatus || ev.status} • {new Date(ev.date).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}