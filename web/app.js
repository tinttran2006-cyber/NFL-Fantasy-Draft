// Fantasy NFL Draft Analyzer — front end.
// Loads data/players.json (made by export_json.py) and renders everything in the browser.
// No libraries: charts are drawn as plain SVG.

const state = {
  data: null,
  season: "all",   // "all" or a season year as a string, e.g. "2026"
  scoring: "ppr",  // "ppr", "half" or "standard"
  position: "RB",
  sortKey: "avg",
  sortAsc: false,
};

const $ = (id) => document.getElementById(id);

// Escape text before putting it into HTML.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "B.Robinson (ATL)" — the team keeps players who share a short name apart.
const labelOf = (p) => `${p.name} (${p.team})`;

// Default "Min. games" filter: higher when combining seasons, lower for one (possibly unfinished) season.
const defaultMinGames = () => (state.season === "all" ? 8 : 3);

// Raw weekly rows are [season, week, standard points, PPR points, team].
// Half PPR (0.5 per catch) is the midpoint of standard and full PPR.
function pointsFor(row) {
  const [, , std, ppr] = row;
  if (state.scoring === "standard") return std;
  if (state.scoring === "half") return Math.round(((std + ppr) / 2) * 100) / 100;
  return ppr;
}

// The player's weeks in the selected season(s), as [season, week, points, team] for the selected scoring.
function weeksFor(p) {
  return p.weeks
    .filter((w) => state.season === "all" || String(w[0]) === state.season)
    .map((w) => [w[0], w[1], pointsFor(w), w[4]]);
}

// Season stats for one player, calculated from their weekly scores. Returns null if they didn't play.
function statsFor(p) {
  const weeks = weeksFor(p);
  if (!weeks.length) return null;
  const pts = weeks.map((w) => w[2]);
  const total = pts.reduce((a, b) => a + b, 0);
  const avg = total / pts.length;
  // Standard deviation = how much the score swings week to week (lower = more consistent).
  const stdev = Math.sqrt(pts.reduce((sum, v) => sum + (v - avg) ** 2, 0) / pts.length);
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    team: weeks[weeks.length - 1][3],   // team in their latest game within the selected season(s)
    games: pts.length,
    avg, total, stdev,
    peak: Math.max(...pts),
    boom: pts.filter((v) => v >= 20).length,
    weeks,
  };
}

async function init() {
  try {
    const res = await fetch("data/players.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $("subtitle").textContent =
      "Could not load data/players.json. Open this page through a local server (see README), not by double-clicking the file.";
    console.error(err);
    return;
  }

  const { seasons, players, latest, updated } = state.data;
  const weekly = players.reduce((n, p) => n + p.weeks.length, 0);
  $("subtitle").textContent =
    `${seasons[0]}–${seasons[seasons.length - 1]} seasons · ${players.length} players · ${weekly.toLocaleString()} weekly stat lines · ` +
    `data through ${latest.season} week ${latest.week} (updated ${updated})`;

  setupSeasonPicker();
  setupScoringPicker();
  renderTabs();
  setupRankingControls();
  setupCompare();
  renderAll();
}

function renderAll() {
  const { latest } = state.data;
  const scoringName = { ppr: "PPR", half: "Half PPR", standard: "Standard" }[state.scoring];
  $("season-note").textContent = `${scoringName} · ` + (state.season === String(latest.season)
    ? `${latest.season} season in progress: through week ${latest.week}`
    : state.season === "all" ? "All seasons combined" : `${state.season} regular season`);
  renderPositionCards();
  renderPositionChart();
  renderRankings();
  renderCompare();
}

/* ---------- Season picker ---------- */

function setupSeasonPicker() {
  const seasons = [...state.data.seasons].reverse();   // newest first
  $("season").innerHTML =
    seasons.map((s) => `<option value="${s}">${s}</option>`).join("") + `<option value="all">All seasons</option>`;
  state.season = String(seasons[0]);
  $("season").value = state.season;
  $("min-games").value = defaultMinGames();
  $("season").addEventListener("change", () => {
    state.season = $("season").value;
    $("min-games").value = defaultMinGames();
    renderAll();
  });
}

function setupScoringPicker() {
  $("scoring").value = state.scoring;
  $("scoring").addEventListener("change", () => {
    state.scoring = $("scoring").value;
    renderAll();
  });
}

/* ---------- Position overview ---------- */

const positionsForSeason = () => (state.data.positions[state.scoring] || {})[state.season] || [];

function renderPositionCards() {
  $("position-cards").innerHTML = positionsForSeason().map((p) => `
    <div class="card">
      <div class="pos">${esc(p.position)}</div>
      <div class="big">${p.avg.toFixed(1)}</div>
      <div class="meta">avg pts/week · median ${p.median.toFixed(1)}</div>
      <div class="meta">best week ${p.peak.toFixed(1)} · ${p.players} players</div>
    </div>`).join("");
}

function renderPositionChart() {
  const rows = positionsForSeason().map((p) => ({ label: p.position, value: p.avg }));
  $("position-chart").innerHTML = rows.length ? barChart(rows, { color: "#13294b" }) : "";
}

/* ---------- Rankings ---------- */

// FLEX = the lineup spot that can be filled by a RB, WR or TE.
const FLEX_POSITIONS = ["RB", "WR", "TE"];
const inSelectedPosition = (p) =>
  state.position === "FLEX" ? FLEX_POSITIONS.includes(p.position) : p.position === state.position;

// FLEX has no position summary from Python, so build a short note from the RB/WR/TE averages.
function flexNote() {
  const rows = positionsForSeason()
    .filter((p) => FLEX_POSITIONS.includes(p.position))
    .sort((a, b) => b.avg - a.avg);
  if (!rows.length) return "";
  const scoringName = { ppr: "PPR", half: "Half PPR", standard: "Standard" }[state.scoring];
  const avgs = rows.map((p) => `${p.position} ${p.avg.toFixed(1)}`).join(", ");
  return `FLEX ranks running backs, wide receivers and tight ends together, for the lineup spot any of them can fill. ` +
    `In ${scoringName} scoring, average points per week are ${avgs}. ` +
    `Look for the highest average with a low σ when you need a dependable weekly starter.`;
}

function renderTabs() {
  $("position-tabs").innerHTML = ["QB", "RB", "WR", "TE", "FLEX"].map((pos) =>
    `<button data-pos="${pos}" class="${pos === state.position ? "active" : ""}">${pos}</button>`
  ).join("");
  $("position-tabs").querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.position = btn.dataset.pos;
      renderTabs();
      renderRankings();
    });
  });
}

function setupRankingControls() {
  $("search").addEventListener("input", renderRankings);
  $("min-games").addEventListener("input", renderRankings);
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortKey = key;
        // Text columns and consistency (lower is better) start ascending; points start descending.
        state.sortAsc = ["name", "position", "team", "stdev"].includes(key);
      }
      renderRankings();
    });
  });
}

function renderRankings() {
  const query = $("search").value.trim().toLowerCase();
  const minGames = Number($("min-games").value) || 1;
  const { sortKey, sortAsc } = state;

  const rows = state.data.players
    .filter(inSelectedPosition)
    .map(statsFor)
    .filter((s) => s && s.games >= minGames)
    .filter((s) => !query || s.name.toLowerCase().includes(query) || s.team.toLowerCase().includes(query))
    .sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      const cmp = typeof x === "string" ? x.localeCompare(y) : x - y;
      return sortAsc ? cmp : -cmp;
    })
    .slice(0, 50);

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === sortKey);
    th.classList.toggle("asc", th.dataset.sort === sortKey && sortAsc);
  });

  const pos = positionsForSeason().find((p) => p.position === state.position);
  $("recommendation").textContent = state.position === "FLEX" ? flexNote() : pos ? pos.recommendation : "";
  // The position column is only useful when several positions are mixed together.
  $("rankings-table").classList.toggle("show-pos", state.position === "FLEX");

  $("rankings").innerHTML = rows.length ? rows.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(p.name)}</td>
      <td class="pos-col"><span class="pos-badge pos-${esc(p.position)}">${esc(p.position)}</span></td>
      <td>${esc(p.team)}</td>
      <td class="num">${p.games}</td>
      <td class="num"><strong>${p.avg.toFixed(1)}</strong></td>
      <td class="num">${p.total.toFixed(1)}</td>
      <td class="num">${p.peak.toFixed(1)}</td>
      <td class="num">${p.stdev.toFixed(1)}</td>
      <td><button data-id="${esc(p.id)}">Compare</button></td>
    </tr>`).join("")
    : `<tr><td colspan="10" class="note">No players match.</td></tr>`;

  $("rankings").querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => addToCompare(btn.dataset.id));
  });
}

/* ---------- Compare ---------- */

function setupCompare() {
  $("player-list").innerHTML = state.data.players
    .map((p) => `<option value="${esc(labelOf(p))}">${esc(p.position)}</option>`).join("");
  $("pick-a").addEventListener("change", renderCompare);
  $("pick-b").addEventListener("change", renderCompare);
}

function findByLabel(text) {
  return state.data.players.find((p) => labelOf(p) === text.trim());
}

// Fill the first empty slot (or replace B), then scroll to the comparison.
function addToCompare(id) {
  const p = state.data.players.find((x) => x.id === id);
  if (!p) return;
  const a = $("pick-a"), b = $("pick-b");
  if (!findByLabel(a.value)) a.value = labelOf(p);
  else if (findByLabel(a.value).id !== id) b.value = labelOf(p);
  renderCompare();
  $("compare-section").scrollIntoView({ behavior: "smooth" });
}

function renderCompare() {
  const pa = findByLabel($("pick-a").value);
  const pb = findByLabel($("pick-b").value);
  const out = $("compare-result");
  if (!pa || !pb) {
    out.innerHTML = `<p class="note">${pa || pb ? "Now pick a second player." : "Pick two players above, or click \"Compare\" next to a player in the rankings."}</p>`;
    return;
  }
  const a = statsFor(pa), b = statsFor(pb);
  const seasonText = state.season === "all" ? "any season" : `the ${state.season} season`;
  if (!a || !b) {
    const missing = [!a && labelOf(pa), !b && labelOf(pb)].filter(Boolean).join(" and ");
    out.innerHTML = `<p class="note">${esc(missing)} didn't play in ${seasonText}. Pick another season above.</p>`;
    return;
  }

  // [label, value A, value B, higher is better?, decimals]
  const stats = [
    ["Position", a.position, b.position, null],
    ["Team", a.team, b.team, null],
    ["Games", a.games, b.games, true],
    ["Avg points / week", a.avg, b.avg, true, 1],
    ["Total points", a.total, b.total, true, 1],
    ["Best week", a.peak, b.peak, true, 1],
    ["20+ point weeks", a.boom, b.boom, true],
    ["Consistency (σ, lower = steadier)", a.stdev, b.stdev, false, 1],
  ];

  const cell = (v, digits) => (typeof v === "number" && digits ? v.toFixed(digits) : esc(v));
  const rows = stats.map(([label, va, vb, higherBetter, digits]) => {
    let winA = false, winB = false;
    if (higherBetter !== null && va !== vb) {
      winA = higherBetter ? va > vb : va < vb;
      winB = !winA;
    }
    return `
      <div class="va ${winA ? "win" : ""}">${cell(va, digits)}</div>
      <div class="label">${label}</div>
      <div class="${winB ? "win" : ""}">${cell(vb, digits)}</div>`;
  }).join("");

  out.innerHTML = `
    <div class="compare-grid">
      <div class="va head">${esc(labelOf(pa))}</div><div class="label"></div><div class="head vb">${esc(labelOf(pb))}</div>
      ${rows}
    </div>
    <h3>Weekly fantasy points</h3>
    <div class="legend"><span style="color:var(--a)">${esc(labelOf(pa))}</span><span style="color:var(--b)">${esc(labelOf(pb))}</span></div>
    ${lineChart([a, b], ["#2f6fdb", "#e0852b"])}
    <p class="note">Gaps in a line are weeks the player didn't record stats (bye, injury, inactive).</p>`;
}

/* ---------- SVG charts ---------- */

function barChart(rows, { color }) {
  const W = 700, rowH = 34, left = 50, right = 60;
  const H = rows.length * rowH + 10;
  const max = Math.max(...rows.map((r) => r.value));
  const bars = rows.map((r, i) => {
    const w = ((W - left - right) * r.value) / max;
    const y = i * rowH + 6;
    return `
      <text x="${left - 10}" y="${y + 17}" text-anchor="end" style="font-weight:600;fill:#1b2430">${esc(r.label)}</text>
      <rect x="${left}" y="${y}" width="${w}" height="${rowH - 12}" rx="4" fill="${color}"></rect>
      <text x="${left + w + 8}" y="${y + 17}">${r.value.toFixed(1)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${bars}</svg>`;
}

function lineChart(players, colors) {
  // Shared x-axis: every (season, week) either player has, in order.
  const keys = [...new Set(players.flatMap((p) => p.weeks.map((w) => w[0] * 100 + w[1])))].sort((x, y) => x - y);
  const index = new Map(keys.map((k, i) => [k, i]));
  const W = 760, H = 280, L = 40, R = 12, T = 12, B = 40;
  const maxY = Math.max(10, ...players.flatMap((p) => p.weeks.map((w) => w[2])));
  const yTop = Math.ceil(maxY / 10) * 10;
  const x = (i) => L + (keys.length === 1 ? 0 : (i * (W - L - R)) / (keys.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / yTop);

  let svg = "";
  // Horizontal grid lines every 10 points.
  for (let v = 0; v <= yTop; v += 10) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e2e7ee"></line>
            <text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  // Season labels under the first week of each season.
  keys.forEach((k, i) => {
    const season = Math.floor(k / 100);
    if (i === 0 || Math.floor(keys[i - 1] / 100) !== season) {
      svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="#c9d1dc" stroke-dasharray="3 3"></line>
              <text x="${x(i) + 4}" y="${H - B + 18}">${season} season</text>`;
    }
    // Week numbers along the bottom when only one season is shown.
    if (state.season !== "all") {
      svg += `<text x="${x(i)}" y="${H - B + 32}" text-anchor="middle" style="font-size:10px">${k % 100}</text>`;
    }
  });
  // One polyline per run of consecutive weeks, so missed games show as gaps.
  players.forEach((p, pi) => {
    let run = [];
    const flush = () => {
      if (run.length > 1) svg += `<polyline fill="none" stroke="${colors[pi]}" stroke-width="2" points="${run.join(" ")}"></polyline>`;
      run = [];
    };
    let prev = -2;
    p.weeks.forEach(([s, w, pts]) => {
      const i = index.get(s * 100 + w);
      if (i !== prev + 1) flush();
      run.push(`${x(i).toFixed(1)},${y(pts).toFixed(1)}`);
      svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(pts).toFixed(1)}" r="2.5" fill="${colors[pi]}"><title>${esc(p.name)} · ${s} wk ${w}: ${pts} pts</title></circle>`;
      prev = i;
    });
    flush();
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly points line chart">${svg}</svg>`;
}

init();
