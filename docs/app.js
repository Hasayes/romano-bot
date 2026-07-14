const VAPID_PUBLIC_KEY = "BDKwnexe_jAsbln6CFqhe9qMnjyh3tsOsIW5YcV9UN39-E7kjRjHGJsJAnhkT4k8Z8pCm5edQnGrNX8Icx4WENM";
const $ = (s) => document.querySelector(s);
let feed = [];

// ---------- tabs ----------
document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    if (b.dataset.tab === "players") renderPlayers();
  })
);

// ---------- feed ----------
async function loadFeed() {
  try {
    const r = await fetch("feed.json", { cache: "no-cache" });
    feed = await r.json();
  } catch {
    feed = [];
  }
  buildClubFilter();
  renderFeed();
}

const known = (v) => v && v.trim() !== "" && v.trim() !== "—";
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function ago(ts) {
  const m = Math.max(0, (Date.now() - new Date(ts)) / 60000);
  if (m < 60) return Math.round(m) + "m";
  if (m < 60 * 24) return Math.round(m / 60) + "h";
  return Math.round(m / 60 / 24) + "d";
}

function buildClubFilter() {
  const clubs = new Set();
  feed.forEach((i) => {
    if (known(i.to_club)) i.to_club.split(",").forEach((c) => clubs.add(c.trim()));
    if (known(i.from_club)) clubs.add(i.from_club.trim());
  });
  const sel = $("#f-club");
  const cur = sel.value;
  sel.innerHTML = '<option value="">All clubs</option>' +
    [...clubs].sort().map((c) => `<option>${esc(c)}</option>`).join("");
  sel.value = cur;
}

function cardHTML(i) {
  const isInt = i.kind === "interest";
  const badge = isInt
    ? '<span class="badge interest">👀 Interest</span>'
    : `<span class="badge deal">${esc(known(i.stage) ? i.stage : "Deal")}</span>`;
  const meta = [i.position, i.age].filter(known).join(" · ");
  const move = isInt
    ? `${known(i.from_club) ? "🏟 " + esc(i.from_club) + " · " : ""}🎯 ${esc(i.to_club)}`
    : `🔄 ${esc(i.from_club)} → ${esc(i.to_club)}`;
  return `<div class="card">
    <div class="top"><span class="player" data-player="${esc(i.player)}">${esc(i.player)}</span>
      <span class="when">${ago(i.ts)} ago</span></div>
    ${meta ? `<div class="meta">📍 ${esc(meta)}</div>` : ""}
    <div class="move">${move}${badge}</div>
    ${known(i.fee) ? `<div class="line"><b>💰 Fee:</b> ${esc(i.fee)}</div>` : ""}
    ${known(i.style) ? `<div class="line"><b>🎮 Style:</b> ${esc(i.style)}</div>` : ""}
    ${known(i.fit) ? `<div class="line"><b>🧩 Fit:</b> ${esc(i.fit)}</div>` : ""}
    <div class="foot">${known(i.source) ? "🗞 " + esc(i.source) + " · " : ""}${esc(i.outlet || "")}
      ${i.url ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">Read more</a>` : ""}</div>
  </div>`;
}

function renderFeed() {
  const kind = $("#f-kind").value;
  const stage = $("#f-stage").value;
  const club = $("#f-club").value.toLowerCase();
  const q = $("#f-search").value.toLowerCase();
  const showInterest = $("#s-interest").checked;
  const items = feed.filter((i) => {
    if (!showInterest && i.kind === "interest") return false;
    if (kind && i.kind !== kind) return false;
    if (stage && i.stage !== stage) return false;
    if (club && !(i.to_club + " " + i.from_club).toLowerCase().includes(club)) return false;
    if (q && !`${i.player} ${i.to_club} ${i.from_club} ${i.source} ${i.title}`.toLowerCase().includes(q)) return false;
    return true;
  });
  $("#cards").innerHTML = items.map(cardHTML).join("");
  $("#feed-empty").hidden = items.length > 0;
  document.querySelectorAll(".player").forEach((el) =>
    el.addEventListener("click", () => openPlayer(el.dataset.player))
  );
}

["#f-kind", "#f-stage", "#f-club", "#s-interest"].forEach((s) => $(s).addEventListener("change", renderFeed));
$("#f-search").addEventListener("input", renderFeed);

// ---------- players ----------
const surname = (p) => p.trim().split(/\s+/).pop().toLowerCase();

function renderPlayers() {
  $("#player-detail").hidden = true;
  const groups = new Map();
  feed.forEach((i) => {
    if (!known(i.player)) return;
    const k = surname(i.player);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  const rows = [...groups.values()]
    .sort((a, b) => new Date(b[0].ts) - new Date(a[0].ts))
    .map((items) => {
      const latest = items[0];
      const st = latest.kind === "interest" ? "👀 interest" : "⚽️ " + (latest.stage || "deal").toLowerCase();
      return `<div class="player-row" data-player="${esc(latest.player)}">
        <div><div class="n">${esc(latest.player)}</div>
        <div class="sub">${items.length} update${items.length > 1 ? "s" : ""} · latest: ${esc(st)}</div></div>
        <div>›</div></div>`;
    });
  $("#player-list").innerHTML = rows.join("") || '<p class="empty">No players yet.</p>';
  document.querySelectorAll(".player-row").forEach((el) =>
    el.addEventListener("click", () => openPlayer(el.dataset.player))
  );
}

function openPlayer(name) {
  document.querySelector('nav button[data-tab="players"]').click();
  const k = surname(name);
  const items = feed.filter((i) => known(i.player) && surname(i.player) === k);
  $("#player-list").innerHTML = "";
  $("#player-detail").hidden = false;
  $("#player-timeline").innerHTML = items.map(cardHTML).join("");
}
$("#player-back").addEventListener("click", renderPlayers);

// ---------- push notifications ----------
async function enablePush() {
  const status = $("#push-status");
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      status.textContent = "Push isn't supported here. On iPhone: install via Share → Add to Home Screen, then open the installed app.";
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      status.textContent = "Permission denied — enable notifications for this app in iOS Settings.";
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64(VAPID_PUBLIC_KEY),
    });
    $("#push-sub").value = JSON.stringify(sub.toJSON());
    $("#push-result").hidden = false;
    status.textContent = "Subscribed on this device ✓";
  } catch (e) {
    status.textContent = "Failed: " + e.message;
  }
}
$("#push-btn").addEventListener("click", enablePush);
$("#push-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#push-sub").value);
  $("#push-copy").textContent = "Copied ✓";
});

function urlB64(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// ---------- settings persistence ----------
$("#s-interest").checked = localStorage.getItem("showInterest") !== "0";
$("#s-interest").addEventListener("change", (e) =>
  localStorage.setItem("showInterest", e.target.checked ? "1" : "0")
);

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
loadFeed();
setInterval(loadFeed, 5 * 60 * 1000); // refresh while open
$("#version").textContent = "ShimShim v2.0";
