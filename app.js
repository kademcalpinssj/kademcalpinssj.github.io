// Volleyball Lineup App (6 quad zones, shared mesh; each zone = 4 vertices)
const STORAGE_KEY = "volley_lineup_v10";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

const POS = {
  1: "Front Left",
  2: "Front Middle (Setter)",
  3: "Front Right",
  4: "Right Bench",
  5: "Back Right",
  6: "Back Middle",
  7: "Back Left",
  8: "Left Bench",
};

const COURT_POS = [1, 2, 3, 5, 6, 7];

const VB = { w: 1000, h: 1400 };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function tokenLabelFor(name) {
  const clean = String(name || "").trim();
  if (!clean) return "?";
  if (clean.length > 10) return initialsFor(clean);
  return clean;
}

// ------------------------------------------------------------
// QUAD SHARED MESH
// - exactly 6 zones, each 4 vertices
// - uses 2 vertical seams (each defined by top+bottom points)
// - uses 1 horizontal seam (front/back) defined by left+right points
// - intersection points are derived (computed) so we don't add vertices
// ------------------------------------------------------------
function defaultMesh() {
  return {
    pts: {
      // locked corners (for convenience)
      TL: { x: 60, y: 220 },
      TR: { x: 940, y: 220 },
      BL: { x: 60, y: 1340 },
      BR: { x: 940, y: 1340 },

      // Seam 1 endpoints (left/middle boundary)
      S1T: { x: 360, y: 220 },   // on top edge
      S1B: { x: 360, y: 1340 },  // on bottom edge

      // Seam 2 endpoints (middle/right boundary)
      S2T: { x: 640, y: 220 },   // on top edge
      S2B: { x: 640, y: 1340 },  // on bottom edge

      // Horizontal seam endpoints (front/back boundary) — on sidelines
      HL: { x: 60, y: 760 },     // left edge
      HR: { x: 940, y: 760 },    // right edge
    },
  };
}

function clampMesh(mesh) {
  const P = mesh.pts;

  const L = 60, R = 940, T = 220, B = 1340;

  // clamp everything
  for (const k of Object.keys(P)) {
    P[k].x = clamp(P[k].x, 0, VB.w);
    P[k].y = clamp(P[k].y, 0, VB.h);
  }

  // lock corners
  P.TL.x = L; P.TL.y = T;
  P.TR.x = R; P.TR.y = T;
  P.BL.x = L; P.BL.y = B;
  P.BR.x = R; P.BR.y = B;

  // force seam endpoints on top/bottom edges
  P.S1T.y = T;
  P.S2T.y = T;
  P.S1B.y = B;
  P.S2B.y = B;

  // force horizontal seam endpoints on sidelines
  P.HL.x = L;
  P.HR.x = R;

  // keep horizontal seam level (single y across)
  P.HL.y = clamp(P.HL.y, T + 220, B - 220);
  P.HR.y = P.HL.y;

  // keep seam ordering and reasonable spacing
  const minGap = 90;
  // top
  P.S1T.x = clamp(P.S1T.x, L + 180, P.S2T.x - minGap);
  P.S2T.x = clamp(P.S2T.x, P.S1T.x + minGap, R - 180);
  // bottom
  P.S1B.x = clamp(P.S1B.x, L + 180, P.S2B.x - minGap);
  P.S2B.x = clamp(P.S2B.x, P.S1B.x + minGap, R - 180);

  return mesh;
}

// line intersection (infinite lines) of segment AB with segment CD
function lineIntersection(A, B, C, D) {
  const x1 = A.x, y1 = A.y;
  const x2 = B.x, y2 = B.y;
  const x3 = C.x, y3 = C.y;
  const x4 = D.x, y4 = D.y;

  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;

  const px =
    ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den;
  const py =
    ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den;

  return { x: px, y: py };
}

function derivedIntersections(mesh) {
  const P = mesh.pts;
  const L = 60, R = 940;

  // Horizontal seam line
  const H1 = P.HL;
  const H2 = P.HR;

  // Intersection of seam1 with horizontal seam
  let I1 = lineIntersection(P.S1T, P.S1B, H1, H2);
  // Intersection of seam2 with horizontal seam
  let I2 = lineIntersection(P.S2T, P.S2B, H1, H2);

  // Fallbacks (shouldn't happen unless seams go parallel to H, which is rare)
  if (!I1) I1 = { x: (P.S1T.x + P.S1B.x) / 2, y: P.HL.y };
  if (!I2) I2 = { x: (P.S2T.x + P.S2B.x) / 2, y: P.HL.y };

  // clamp intersections to court width
  I1.x = clamp(I1.x, L, R);
  I2.x = clamp(I2.x, L, R);

  // keep ordering so the middle quad doesn't flip
  const minGap = 40;
  if (I2.x < I1.x + minGap) I2.x = I1.x + minGap;

  return { I1, I2 };
}

// Return 4 vertices for a given court pos
function quadForPos(mesh, pos) {
  const P = mesh.pts;
  const { I1, I2 } = derivedIntersections(mesh);

  switch (pos) {
    // Front row quads
    case 1: // Front Left: TL -> S1T -> I1 -> HL
      return [P.TL, P.S1T, I1, P.HL];
    case 2: // Front Middle: S1T -> S2T -> I2 -> I1
      return [P.S1T, P.S2T, I2, I1];
    case 3: // Front Right: S2T -> TR -> HR -> I2
      return [P.S2T, P.TR, P.HR, I2];

    // Back row quads
    case 7: // Back Left: HL -> I1 -> S1B -> BL
      return [P.HL, I1, P.S1B, P.BL];
    case 6: // Back Middle: I1 -> I2 -> S2B -> S1B
      return [I1, I2, P.S2B, P.S1B];
    case 5: // Back Right: I2 -> HR -> BR -> S2B
      return [I2, P.HR, P.BR, P.S2B];
    default:
      return [];
  }
}

function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;

    const intersect =
      ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi + 1e-9) + xi);

    if (intersect) inside = !inside;
  }
  return inside;
}

// --------- Data model ---------
function makeNewTeam(name = "Team A") {
  const players = Array.from({ length: 12 }).map((_, i) => ({
    id: uid(),
    number: i + 1,
    name: String(i + 1),
  }));
  const rotation = makeNewRotation("Rotation 1", players);
  return { id: uid(), name, players, rotations: [rotation] };
}

function makeNewRotation(name, players) {
  const ids = players.map(p => p.id);
  const positions = {
    "1": ids[0] || null,
    "2": ids[1] || null,
    "3": ids[2] || null,
    "5": ids[3] || null,
    "6": ids[4] || null,
    "7": ids[5] || null,
  };

  const remaining = ids.slice(6);
  const leftBench = [];
  const rightBench = [];

  // Right bench: enqueue TOP (unshift), dequeue BOTTOM (pop) for "front->back" flow
  remaining.forEach((pid, i) => {
    if (i % 2 === 0) rightBench.unshift(pid);
    else leftBench.push(pid);
  });

  return {
    id: uid(),
    name,
    positions,
    leftBench,
    rightBench,
    mesh: clampMesh(defaultMesh()),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.teams?.length) return null;
    return s;
  } catch {
    return null;
  }
}

let state = loadState() || {
  teams: [makeNewTeam("Team A")],
  currentTeamId: null,
  currentRotationId: null,
  ui: { editLayout: false },
};

if (!state.currentTeamId) state.currentTeamId = state.teams[0].id;
if (!state.currentRotationId) state.currentRotationId = state.teams[0].rotations[0].id;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setStatus("Saved");
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.style.opacity = "1";
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(() => (el.style.opacity = "0.65"), 900);
}

// --------- DOM refs ---------
const playArea = document.getElementById("playArea");
const zoneSvg = document.getElementById("zoneSvg");
const courtTokens = document.getElementById("courtTokens");

const leftBenchPanel = document.getElementById("leftBenchPanel");
const rightBenchPanel = document.getElementById("rightBenchPanel");
const leftBenchList = document.getElementById("leftBenchList");
const rightBenchList = document.getElementById("rightBenchList");

const teamSelect = document.getElementById("teamSelect");
const teamName = document.getElementById("teamName");
const btnSaveTeam = document.getElementById("btnSaveTeam");
const btnNewTeam = document.getElementById("btnNewTeam");
const btnDeleteTeam = document.getElementById("btnDeleteTeam");

const rotList = document.getElementById("rotList");
const rotationName = document.getElementById("rotationName");
const btnSaveRotation = document.getElementById("btnSaveRotation");
const btnNewRotation = document.getElementById("btnNewRotation");
const btnCloneRotation = document.getElementById("btnCloneRotation");
const btnDeleteRotation = document.getElementById("btnDeleteRotation");

const playersGrid = document.getElementById("playersGrid");
const btnAddPlayer = document.getElementById("btnAddPlayer");
const btnResetLayout = document.getElementById("btnResetLayout");

const btnRotateCW = document.getElementById("btnRotateCW");
const btnRotateCCW = document.getElementById("btnRotateCCW");

const pillTeam = document.getElementById("pillTeam");
const pillRotation = document.getElementById("pillRotation");

const btnShare = document.getElementById("btnShare");
const chkEditLayout = document.getElementById("chkEditLayout");

// Modal
const modalBackdrop = document.getElementById("modalBackdrop");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCancelModal = document.getElementById("btnCancelModal");
const btnSavePlayerName = document.getElementById("btnSavePlayerName");
const playerNameInput = document.getElementById("playerNameInput");
let modalPlayerId = null;

// --------- Helpers ---------
function getTeam() {
  return state.teams.find(t => t.id === state.currentTeamId);
}
function getRotation(team) {
  return team.rotations.find(r => r.id === state.currentRotationId);
}
function findPlayer(team, pid) {
  return team.players.find(p => p.id === pid) || null;
}
function removeFromArray(arr, id) {
  const idx = arr.indexOf(id);
  if (idx >= 0) arr.splice(idx, 1);
}

function ensureValidSelection() {
  if (!state.teams?.length) state.teams = [makeNewTeam("Team A")];
  if (!state.teams.some(t => t.id === state.currentTeamId)) state.currentTeamId = state.teams[0].id;

  const team = getTeam();
  if (!team.rotations?.length) team.rotations = [makeNewRotation("Rotation 1", team.players)];
  if (!team.rotations.some(r => r.id === state.currentRotationId)) state.currentRotationId = team.rotations[0].id;

  if (!state.ui) state.ui = { editLayout: false };
  team.rotations.forEach(r => migrateAndFixRotation(team, r));
}

function migrateAndFixRotation(team, rot) {
  if (rot.mesh && rot.positions && rot.leftBench && rot.rightBench) {
    rot.mesh = clampMesh(rot.mesh);
    normalizePlayerMembership(team, rot);
    return;
  }

  const ids = team.players.map(p => p.id);
  rot.positions = rot.positions || {
    "1": ids[0] || null, "2": ids[1] || null, "3": ids[2] || null,
    "5": ids[3] || null, "6": ids[4] || null, "7": ids[5] || null,
  };

  rot.leftBench = Array.isArray(rot.leftBench) ? rot.leftBench : [];
  rot.rightBench = Array.isArray(rot.rightBench) ? rot.rightBench : [];

  rot.mesh = clampMesh(defaultMesh());
  normalizePlayerMembership(team, rot);
}

function normalizePlayerMembership(team, rot) {
  const roster = team.players.map(p => p.id);
  const seen = new Set();

  for (const k of Object.keys(rot.positions || {})) {
    const pid = rot.positions[k];
    if (!pid || !roster.includes(pid) || seen.has(pid)) rot.positions[k] = null;
    else seen.add(pid);
  }

  rot.leftBench = (rot.leftBench || []).filter(pid => roster.includes(pid) && !seen.has(pid) && (seen.add(pid), true));
  rot.rightBench = (rot.rightBench || []).filter(pid => roster.includes(pid) && !seen.has(pid) && (seen.add(pid), true));

  roster.forEach(pid => { if (!seen.has(pid)) rot.rightBench.unshift(pid); });
}

// --------- Rotation logic ---------
function rotateClockwise(rot) {
  const p1 = rot.positions["1"];
  const p2 = rot.positions["2"];
  const p3 = rot.positions["3"];
  const p5 = rot.positions["5"];
  const p6 = rot.positions["6"];
  const p7 = rot.positions["7"];

  if (p3) rot.rightBench.unshift(p3); // 3 -> right bench TOP
  if (p7) rot.leftBench.push(p7);     // 7 -> left bench BOTTOM

  const fromLeft = rot.leftBench.shift() || null;   // left bench TOP -> 1
  const fromRight = rot.rightBench.pop() || null;   // right bench BOTTOM -> 5

  rot.positions["3"] = p2 || null;
  rot.positions["2"] = p1 || null;
  rot.positions["1"] = fromLeft;

  rot.positions["7"] = p6 || null;
  rot.positions["6"] = p5 || null;
  rot.positions["5"] = fromRight;
}

function rotateCounterClockwise(rot) {
  const p1 = rot.positions["1"];
  const p2 = rot.positions["2"];
  const p3 = rot.positions["3"];
  const p5 = rot.positions["5"];
  const p6 = rot.positions["6"];
  const p7 = rot.positions["7"];

  const backInto7 = rot.leftBench.pop() || null;
  const backInto3 = rot.rightBench.shift() || null;

  rot.positions["1"] = p2 || null;
  rot.positions["2"] = p3 || null;
  rot.positions["3"] = backInto3;

  rot.positions["5"] = p6 || null;
  rot.positions["6"] = p7 || null;
  rot.positions["7"] = backInto7;

  if (p1) rot.leftBench.unshift(p1);
  if (p5) rot.rightBench.push(p5);
}

// --------- Modal ---------
function openPlayerModal(playerId) {
  const team = getTeam();
  const player = findPlayer(team, playerId);
  if (!player) return;

  modalPlayerId = playerId;
  playerNameInput.value = player.name;

  modalBackdrop.hidden = false;
  requestAnimationFrame(() => playerNameInput.focus());
}
function closeModal() {
  modalBackdrop.hidden = true;
  modalPlayerId = null;
}
btnCloseModal?.addEventListener("click", (e) => { e.stopPropagation(); closeModal(); });
btnCancelModal?.addEventListener("click", (e) => { e.stopPropagation(); closeModal(); });
modalBackdrop?.addEventListener("click", (e) => { if (e.target === modalBackdrop) closeModal(); });

btnSavePlayerName?.addEventListener("click", () => {
  const team = getTeam();
  const p = findPlayer(team, modalPlayerId);
  if (!p) return;

  const name = (playerNameInput.value || "").trim();
  if (name.length) p.name = name;

  saveState();
  closeModal();
  render();
});
playerNameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnSavePlayerName.click();
  if (e.key === "Escape") closeModal();
});

// --------- Delete player ---------
function deletePlayer(playerId) {
  const team = getTeam();
  const p = team.players.find(x => x.id === playerId);
  if (!p) return;

  if (!confirm(`Delete player #${p.number} (${p.name})?\nThis removes them from the roster and all rotations.`)) return;

  team.players = team.players.filter(x => x.id !== playerId);

  team.rotations.forEach(r => {
    for (const k of Object.keys(r.positions || {})) {
      if (r.positions[k] === playerId) r.positions[k] = null;
    }
    removeFromArray(r.leftBench, playerId);
    removeFromArray(r.rightBench, playerId);
    normalizePlayerMembership(team, r);
  });

  saveState();
  render();
}

// --------- Drag & Drop ---------
let drag = null; // { pid, from, ghostEl, offsetX, offsetY }

function locatePlayer(rot, pid) {
  for (const k of Object.keys(rot.positions || {})) {
    if (rot.positions[k] === pid) return { type: "pos", pos: Number(k) };
  }
  const li = rot.leftBench.indexOf(pid);
  if (li >= 0) return { type: "left", index: li };
  const ri = rot.rightBench.indexOf(pid);
  if (ri >= 0) return { type: "right", index: ri };
  return null;
}
function removeFromLocation(rot, loc, pid) {
  if (!loc) return;
  if (loc.type === "pos") rot.positions[String(loc.pos)] = null;
  if (loc.type === "left") removeFromArray(rot.leftBench, pid);
  if (loc.type === "right") removeFromArray(rot.rightBench, pid);
}
function addToBench(rot, benchSide, pid) {
  if (benchSide === "left") rot.leftBench.push(pid);
  else rot.rightBench.unshift(pid);
}
function isPointInRect(clientX, clientY, rect) {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}
function clientToSvgPoint(e) {
  const rect = zoneSvg.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * VB.w;
  const y = (e.clientY - rect.top) / rect.height * VB.h;
  return { x, y };
}

function clearHover() {
  Array.from(zoneSvg.querySelectorAll(".zonePoly.hover")).forEach(el => el.classList.remove("hover"));
  leftBenchPanel?.classList.remove("dropHover");
  rightBenchPanel?.classList.remove("dropHover");
}
function setSvgHover(posStr) {
  const el = zoneSvg.querySelector(`.zonePoly[data-pos="${posStr}"]`);
  if (el) el.classList.add("hover");
}

function findHoveredCourtZone(rot, svgPt) {
  for (const pos of COURT_POS) {
    const poly = quadForPos(rot.mesh, pos);
    if (pointInPoly(svgPt, poly)) return pos;
  }
  return null;
}

function makePlayerToken(team, rot, pid) {
  const p = findPlayer(team, pid);
  if (!p) return null;

  const token = document.createElement("div");
  token.className = "playerToken";
  token.dataset.playerId = pid;

  const num = document.createElement("div");
  num.className = "tokenNum";
  num.textContent = p.number;

  const nm = document.createElement("div");
  nm.className = "tokenName";
  nm.textContent = tokenLabelFor(p.name);
  nm.title = p.name;

  token.appendChild(num);
  token.appendChild(nm);

  token.addEventListener("click", (e) => {
    if (drag) return;
    openPlayerModal(pid);
    e.stopPropagation();
  });

  token.addEventListener("pointerdown", (e) => {
    if (state.ui.editLayout) return;
    if (modalBackdrop && modalBackdrop.hidden === false) return;

    const loc = locatePlayer(rot, pid);
    if (!loc) return;

    token.setPointerCapture(e.pointerId);

    const rect = token.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    drag = { pid, from: loc, offsetX, offsetY, ghostEl: null };

    const ghost = token.cloneNode(true);
    ghost.classList.add("dragging");
    ghost.style.position = "fixed";
    ghost.style.left = `${e.clientX - offsetX}px`;
    ghost.style.top = `${e.clientY - offsetY}px`;
    ghost.style.zIndex = "9999";
    ghost.style.width = `${rect.width}px`;
    ghost.style.pointerEvents = "none";
    document.body.appendChild(ghost);
    drag.ghostEl = ghost;

    setStatus("Dragging…");
  });

  token.addEventListener("pointermove", (e) => {
    if (!drag || drag.pid !== pid || !drag.ghostEl) return;
    drag.ghostEl.style.left = `${e.clientX - drag.offsetX}px`;
    drag.ghostEl.style.top = `${e.clientY - drag.offsetY}px`;
    highlightTargetUnderPointer(e);
  });

  token.addEventListener("pointerup", (e) => {
    if (!drag || drag.pid !== pid) return;
    finishDrop(e);
  });

  token.addEventListener("pointercancel", () => cancelDrag());

  return token;
}

function highlightTargetUnderPointer(e) {
  clearHover();

  const team = getTeam();
  const rot = getRotation(team);

  const leftRect = leftBenchPanel?.getBoundingClientRect();
  const rightRect = rightBenchPanel?.getBoundingClientRect();

  if (leftRect && isPointInRect(e.clientX, e.clientY, leftRect)) {
    leftBenchPanel.classList.add("dropHover");
    return;
  }
  if (rightRect && isPointInRect(e.clientX, e.clientY, rightRect)) {
    rightBenchPanel.classList.add("dropHover");
    return;
  }

  const svgPt = clientToSvgPoint(e);
  const z = findHoveredCourtZone(rot, svgPt);
  if (z) setSvgHover(String(z));
}

function cancelDrag() {
  clearHover();
  if (drag?.ghostEl) drag.ghostEl.remove();
  drag = null;
  setStatus("Saved");
}

function finishDrop(e) {
  clearHover();

  const team = getTeam();
  const rot = getRotation(team);
  const pid = drag.pid;
  const fromLoc = drag.from;

  if (drag.ghostEl) drag.ghostEl.remove();
  drag = null;

  const leftRect = leftBenchPanel?.getBoundingClientRect();
  const rightRect = rightBenchPanel?.getBoundingClientRect();

  if (leftRect && isPointInRect(e.clientX, e.clientY, leftRect)) {
    removeFromLocation(rot, fromLoc, pid);
    addToBench(rot, "left", pid);
    normalizePlayerMembership(team, rot);
    saveState();
    render();
    return;
  }
  if (rightRect && isPointInRect(e.clientX, e.clientY, rightRect)) {
    removeFromLocation(rot, fromLoc, pid);
    addToBench(rot, "right", pid);
    normalizePlayerMembership(team, rot);
    saveState();
    render();
    return;
  }

  const targetPos = findHoveredCourtZone(rot, clientToSvgPoint(e));
  if (!targetPos) {
    setStatus("No drop");
    render();
    return;
  }

  const key = String(targetPos);
  const existing = rot.positions[key] || null;

  removeFromLocation(rot, fromLoc, pid);

  if (!existing) {
    rot.positions[key] = pid;
  } else {
    rot.positions[key] = pid;
    if (fromLoc.type === "pos") rot.positions[String(fromLoc.pos)] = existing;
    else if (fromLoc.type === "left") addToBench(rot, "left", existing);
    else if (fromLoc.type === "right") addToBench(rot, "right", existing);
  }

  normalizePlayerMembership(team, rot);
  saveState();
  render();
}

// --------- Zone editing: drag mesh points ---------
let editDrag = null; // { key, pointerId }

function renderZoneOverlay(team, rot) {
  zoneSvg.innerHTML = "";

  for (const pos of COURT_POS) {
    const pts = quadForPos(rot.mesh, pos);
    const ptsAttr = pts.map(p => `${p.x},${p.y}`).join(" ");

    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", ptsAttr);
    poly.classList.add("zonePoly");
    poly.dataset.pos = String(pos);
    zoneSvg.appendChild(poly);

    const c = centroid(pts);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("zoneText");
    label.setAttribute("x", c.x);
    label.setAttribute("y", c.y);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.textContent =
      pos === 1 ? "front left" :
      pos === 2 ? "front middle" :
      pos === 3 ? "front right" :
      pos === 7 ? "back left" :
      pos === 6 ? "back middle" :
      "back right";
    zoneSvg.appendChild(label);
  }

  if (state.ui.editLayout) {
    for (const [key, p] of Object.entries(rot.mesh.pts)) {
      const locked = (key === "TL" || key === "TR" || key === "BL" || key === "BR");
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.classList.add("ctrlPt");
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      dot.setAttribute("r", locked ? 0 : 12);

      if (!locked) {
        dot.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          dot.setPointerCapture(e.pointerId);
          editDrag = { key, pointerId: e.pointerId };
        });

        dot.addEventListener("pointermove", (e) => {
          if (!editDrag || editDrag.key !== key || editDrag.pointerId !== e.pointerId) return;
          const svgPt = clientToSvgPoint(e);
          rot.mesh.pts[key].x = svgPt.x;
          rot.mesh.pts[key].y = svgPt.y;
          clampMesh(rot.mesh);
          setStatus("Editing…");
          render();
        });

        dot.addEventListener("pointerup", (e) => {
          if (!editDrag || editDrag.pointerId !== e.pointerId) return;
          editDrag = null;
          clampMesh(rot.mesh);
          saveState();
          render();
        });

        dot.addEventListener("pointercancel", () => { editDrag = null; render(); });
      }

      zoneSvg.appendChild(dot);
    }
  }
}

function renderCourtTokens(team, rot) {
  courtTokens.innerHTML = "";

  for (const pos of COURT_POS) {
    const pid = rot.positions[String(pos)];
    if (!pid) continue;

    const pts = quadForPos(rot.mesh, pos);
    const c = centroid(pts);

    const wrap = document.createElement("div");
    wrap.className = "courtTokenWrap";
    wrap.style.left = `${(c.x / VB.w) * 100}%`;
    wrap.style.top = `${(c.y / VB.h) * 100}%`;

    const tok = makePlayerToken(team, rot, pid);
    if (tok) wrap.appendChild(tok);

    courtTokens.appendChild(wrap);
  }
}

// --------- Rendering ---------
function render() {
  ensureValidSelection();

  const team = getTeam();
  const rot = getRotation(team);

  pillTeam.textContent = team.name;
  pillRotation.textContent = rot.name;
  if (chkEditLayout) chkEditLayout.checked = !!state.ui.editLayout;

  // Team dropdown
  teamSelect.innerHTML = "";
  state.teams.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    teamSelect.appendChild(opt);
  });
  teamSelect.value = team.id;
  teamName.value = team.name;

  // Rotations list
  rotList.innerHTML = "";
  team.rotations.forEach(r => {
    const item = document.createElement("div");
    item.className = "rotItem" + (r.id === rot.id ? " active" : "");
    item.addEventListener("click", () => {
      state.currentRotationId = r.id;
      saveState();
      render();
    });

    const left = document.createElement("div");
    left.style.minWidth = "0";

    const rn = document.createElement("div");
    rn.className = "rotName";
    rn.textContent = r.name;

    const onCourtCount = Object.values(r.positions || {}).filter(Boolean).length;
    const meta = document.createElement("div");
    meta.className = "rotMeta";
    meta.textContent = `${onCourtCount}/${team.players.length} placed`;

    left.appendChild(rn);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "rotMeta";
    right.textContent = "›";

    item.appendChild(left);
    item.appendChild(right);
    rotList.appendChild(item);
  });

  rotationName.value = rot.name;

  // benches
  leftBenchList.innerHTML = "";
  rot.leftBench.forEach(pid => {
    const tok = makePlayerToken(team, rot, pid);
    if (tok) leftBenchList.appendChild(tok);
  });

  rightBenchList.innerHTML = "";
  rot.rightBench.forEach(pid => {
    const tok = makePlayerToken(team, rot, pid);
    if (tok) rightBenchList.appendChild(tok);
  });

  // zones + tokens
  renderZoneOverlay(team, rot);
  renderCourtTokens(team, rot);

  // roster list
  playersGrid.innerHTML = "";
  const whereText = (pid) => {
    for (const k of Object.keys(rot.positions || {})) {
      if (rot.positions[k] === pid) return `${k}: ${POS[Number(k)]}`;
    }
    const li = rot.leftBench.indexOf(pid);
    if (li >= 0) return `8: Left Bench (#${li + 1})`;
    const ri = rot.rightBench.indexOf(pid);
    if (ri >= 0) return `4: Right Bench (#${ri + 1})`;
    return "Unplaced";
  };

  team.players.forEach(p => {
    const row = document.createElement("div");
    row.className = "playerRow";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = p.number;

    const text = document.createElement("div");
    text.className = "playerText";
    text.textContent = p.name;

    const status = document.createElement("div");
    status.className = "smallMut";
    status.textContent = whereText(p.id);

    const editBtn = document.createElement("button");
    editBtn.className = "miniBtn";
    editBtn.textContent = "✎";
    editBtn.title = "Edit name";
    editBtn.addEventListener("click", () => openPlayerModal(p.id));

    const delBtn = document.createElement("button");
    delBtn.className = "miniBtn danger";
    delBtn.textContent = "🗑";
    delBtn.title = "Delete player";
    delBtn.addEventListener("click", () => deletePlayer(p.id));

    row.appendChild(badge);
    row.appendChild(text);
    row.appendChild(status);
    row.appendChild(editBtn);
    row.appendChild(delBtn);

    playersGrid.appendChild(row);
  });
}

// --------- UI wiring ---------
teamSelect?.addEventListener("change", () => {
  state.currentTeamId = teamSelect.value;
  const team = getTeam();
  state.currentRotationId = team.rotations[0]?.id || null;
  saveState();
  render();
});

btnSaveTeam?.addEventListener("click", () => {
  const team = getTeam();
  const name = (teamName.value || "").trim();
  if (name.length) team.name = name;
  saveState();
  render();
});

btnNewTeam?.addEventListener("click", () => {
  const name = prompt("Team name:", "New Team") || "";
  const t = makeNewTeam(name.trim() || "New Team");
  state.teams.unshift(t);
  state.currentTeamId = t.id;
  state.currentRotationId = t.rotations[0].id;
  saveState();
  render();
});

btnDeleteTeam?.addEventListener("click", () => {
  const team = getTeam();
  if (!confirm(`Delete team "${team.name}"? This cannot be undone.`)) return;

  state.teams = state.teams.filter(t => t.id !== team.id);
  if (!state.teams.length) state.teams = [makeNewTeam("Team A")];

  state.currentTeamId = state.teams[0].id;
  state.currentRotationId = state.teams[0].rotations[0].id;
  saveState();
  render();
});

btnAddPlayer?.addEventListener("click", () => {
  const team = getTeam();
  const nextNum = (team.players.reduce((m, p) => Math.max(m, p.number), 0) || 0) + 1;
  const name = prompt("Player name:", String(nextNum)) || "";
  const p = { id: uid(), number: nextNum, name: name.trim() || String(nextNum) };
  team.players.push(p);

  team.rotations.forEach(r => {
    migrateAndFixRotation(team, r);
    r.rightBench.unshift(p.id);
    normalizePlayerMembership(team, r);
  });

  saveState();
  render();
});

btnNewRotation?.addEventListener("click", () => {
  const team = getTeam();
  const next = team.rotations.length + 1;
  const r = makeNewRotation(`Rotation ${next}`, team.players);
  team.rotations.push(r);
  state.currentRotationId = r.id;
  saveState();
  render();
});

btnSaveRotation?.addEventListener("click", () => {
  const team = getTeam();
  const rot = getRotation(team);
  const name = (rotationName.value || "").trim();
  if (name.length) rot.name = name;
  saveState();
  render();
});

btnCloneRotation?.addEventListener("click", () => {
  const team = getTeam();
  const rot = getRotation(team);

  const cloned = {
    id: uid(),
    name: `${rot.name} (Copy)`,
    positions: JSON.parse(JSON.stringify(rot.positions || {})),
    leftBench: JSON.parse(JSON.stringify(rot.leftBench || [])),
    rightBench: JSON.parse(JSON.stringify(rot.rightBench || [])),
    mesh: JSON.parse(JSON.stringify(rot.mesh || defaultMesh())),
  };

  team.rotations.splice(team.rotations.findIndex(r => r.id === rot.id) + 1, 0, cloned);
  state.currentRotationId = cloned.id;

  saveState();
  render();
});

btnDeleteRotation?.addEventListener("click", () => {
  const team = getTeam();
  const rot = getRotation(team);
  if (!confirm(`Delete rotation "${rot.name}"?`)) return;

  team.rotations = team.rotations.filter(r => r.id !== rot.id);
  if (!team.rotations.length) team.rotations = [makeNewRotation("Rotation 1", team.players)];

  state.currentRotationId = team.rotations[0].id;
  saveState();
  render();
});

btnRotateCW?.addEventListener("click", () => {
  const team = getTeam();
  const rot = getRotation(team);
  rotateClockwise(rot);
  normalizePlayerMembership(team, rot);
  saveState();
  render();
});

btnRotateCCW?.addEventListener("click", () => {
  const team = getTeam();
  const rot = getRotation(team);
  rotateCounterClockwise(rot);
  normalizePlayerMembership(team, rot);
  saveState();
  render();
});

btnResetLayout?.addEventListener("click", () => {
  const team = getTeam();
  const rot = getRotation(team);
  rot.mesh = clampMesh(defaultMesh());
  saveState();
  render();
});

chkEditLayout?.addEventListener("change", () => {
  state.ui.editLayout = !!chkEditLayout.checked;
  saveState();
  render();
});

// export
btnShare?.addEventListener("click", async () => {
  setStatus("Rendering…");
  try {
    const canvas = await html2canvas(playArea, { backgroundColor: null, scale: 2, useCORS: true });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "lineup.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: "Volleyball Lineup", files: [file] });
      setStatus("Shared");
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lineup.png";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Downloaded");
  } catch (e) {
    console.error(e);
    alert("Export failed. Try hosting the app (not file://) and using Safari/Chrome.");
    setStatus("Export failed");
  }
});

// init
saveState();
render();
