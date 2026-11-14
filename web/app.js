// Fantasy NFL Draft Analyzer — front end.
// Loads data/players.json (made by export_json.py) and renders everything in the browser.
// No libraries: charts are drawn as plain SVG.

const state = {
  data: null,
  position: "RB",
  sortKey: "avg",
  sortAsc: false,
};

const $ = (id) => document.getElementById(id);

// Escape text before putting it into HTML.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "B.Robinson (ATL)" — the team keeps players who share a short name apart.
const labelOf = (p) => `${p.name} (${p.team})`;

async function init() {
  try {
    const res = await fetch("data/players.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $("subtitle").textContent =
      "Could not load data/players.json. Open this page through a local server (see README), not by double-clicking the file.";
    console.error(err);
    return;
  }

  const { seasons, players } = state.data;
  const weekly = players.reduce((n, p) => n + p.games, 0);
  $("subtitle").textContent =
    `${seasons.join("–")} seasons · ${players.length} players · ${weekly.toLocaleString()} weekly stat lines (QB, RB, WR, TE)`;

  renderPositionCards();
  renderPositionChart();
  renderTabs();
  setupRankingControls();
  setupCompare();
  renderRankings();
}

/* ---------- Position overview ---------- */

function renderPositionCards() {
  $("position-cards").innerHTML = state.data.positions.map((p) => `
    <div class="card">
      <div class="pos">${esc(p.position)}</div>
      <div class="big">${p.avg.toFixed(1)}</div>
      <div class="meta">avg pts/week · median ${p.median.toFixed(1)}</div>
      <div class="meta">best week ${p.peak.toFixed(1)} · ${p.players} players</div>
    </div>`).join("");
}

function renderPositionChart() {
  const rows = state.data.positions.map((p) => ({ label: p.position, value: p.avg }));
  $("position-chart").innerHTML = barChart(rows, { color: "#13294b" });
}

/* ---------- Rankings ---------- */

function renderTabs() {
  $("position-tabs").innerHTML = state.data.positions.map((p) =>
    `<button data-pos="${esc(p.position)}" class="${p.position === state.position ? "active" : ""}">${esc(p.position)}</button>`
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
        state.sortAsc = ["name", "team", "stdev"].includes(key);
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
    .filter((p) => p.position === state.position)
    .filter((p) => p.games >= minGames)
    .filter((p) => !query || p.name.toLowerCase().includes(query) || p.team.toLowerCase().includes(query))
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

  const pos = state.data.positions.find((p) => p.position === state.position);
  $("recommendation").textContent = pos ? pos.recommendation : "";

  $("rankings").innerHTML = rows.length ? rows.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(p.name)}</td>
      <td>${esc(p.team)}</td>
      <td class="num">${p.games}</td>
      <td class="num"><strong>${p.avg.toFixed(1)}</strong></td>
      <td class="num">${p.total.toFixed(1)}</td>
      <td class="num">${p.peak.toFixed(1)}</td>
      <td class="num">${p.stdev.toFixed(1)}</td>
      <td><button data-id="${esc(p.id)}">Compare</button></td>
    </tr>`).join("")
    : `<tr><td colspan="9" class="note">No players match.</td></tr>`;

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
  const a = findByLabel($("pick-a").value);
  const b = findByLabel($("pick-b").value);
  const out = $("compare-result");
  if (!a || !b) {
    out.innerHTML = `<p class="note">${a || b ? "Now pick a second player." : "Pick two players above, or click \"Compare\" next to a player in the rankings."}</p>`;
    return;
  }

  const boom = (p) => p.weeks.filter((w) => w[2] >= 20).length;
  // [label, value A, value B, higher is better?, format]
  const stats = [
    ["Position", a.position, b.position, null],
    ["Games", a.games, b.games, true],
    ["Avg points / week", a.avg, b.avg, true, 1],
    ["Total points", a.total, b.total, true, 1],
    ["Best week", a.peak, b.peak, true, 1],
    ["20+ point weeks", boom(a), boom(b), true],
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
      <div class="va head">${esc(labelOf(a))}</div><div class="label"></div><div class="head vb">${esc(labelOf(b))}</div>
      ${rows}
    </div>
    <h3>Weekly fantasy points</h3>
    <div class="legend"><span style="color:var(--a)">${esc(labelOf(a))}</span><span style="color:var(--b)">${esc(labelOf(b))}</span></div>
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
