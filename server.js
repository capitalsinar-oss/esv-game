// server.js — Future Family Holidays, the Endless Summer Villa family game
// Serves the game at /play, saves each play and anonymous events on the /data disk,
// sends key milestones to the Meta pixel / Conversions API, and gives the team
// a stats page and CSV downloads (all behind ADMIN_TOKEN).

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));

// On Render, a persistent disk is mounted at /data so plays survive restarts and deploys.
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : path.join(__dirname, "data"));
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

function requireAdmin(req, res, next) {
  const provided = req.query.token || req.headers["x-admin-token"] || "";
  if (!ADMIN_TOKEN) return res.status(500).send("Admin token not configured on server.");
  if (provided !== ADMIN_TOKEN) return res.status(401).send("Unauthorized. Add ?token=YOUR_ADMIN_TOKEN to the URL.");
  next();
}

// --- helper: turn rows into CSV safely (quotes, commas, newlines handled) ---
function toCsv(headers, rows) {
  const esc = (v) => {
    const s = (v === null || v === undefined) ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(","));
  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// =====================================================================
// FUTURE FAMILY HOLIDAYS — the Endless Summer family game, served at /play
// Plays are saved on the same /data disk as the review configs.
// Team download: /api/ffh/export.csv?token=ADMIN_TOKEN
// Optional env: PUBLIC_URL (e.g. https://endlesssummerbali.com) for link
// previews, META_PIXEL_ID to switch on the Meta pixel, META_CAPI_TOKEN to
// also send the key milestones to Meta server-side (Conversions API),
// META_TEST_EVENT_CODE while testing in Events Manager.
// Funnel + drop-off stats page: /play/stats?token=ADMIN_TOKEN
// =====================================================================
app.set("trust proxy", true);
const FFH_DIR   = path.join(__dirname, "ffh");
const FFH_FILE  = path.join(DATA_DIR, "ffh-plays.json");
const PIXEL_ID  = (process.env.META_PIXEL_ID || "").replace(/[^0-9]/g, "");
let ffhPage = null;
function ffhHtml(req) {
  if (!ffhPage) ffhPage = fs.readFileSync(path.join(FFH_DIR, "index.html"), "utf8");
  const base = (process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"))).replace(/\/$/, "");
  const pixel = PIXEL_ID ? `<script>(function(){try{if(localStorage.getItem('esv_ffh_noads'))return}catch(e){}!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');})();</script>` : "";
  return ffhPage.split("{{BASE}}").join(base).replace("<!--PIXEL-->", pixel);
}
app.get(["/play", "/play/", "/play/index.html"], (req, res) => {
  try { res.set("Cache-Control", "no-cache").type("html").send(ffhHtml(req)); }
  catch (e) { console.error(e); res.status(500).send("Game not found"); }
});
app.use("/play", express.static(FFH_DIR, { maxAge: "7d", index: false }));

function loadPlays() { try { return JSON.parse(fs.readFileSync(FFH_FILE, "utf8")); } catch (e) { return {}; } }
function savePlays(obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FFH_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, FFH_FILE);
    return true;
  } catch (e) { console.error("ffh save failed:", e.message); return false; }
}

// === GAME: save (or update) one play — called as the family goes through the cards ===
app.post("/api/ffh/play", (req, res) => {
  try {
    const { device, run } = req.body || {};
    const playId = run && String(run.playId || "").slice(0, 80);
    if (!playId) return res.status(400).json({ error: "no playId" });
    const plays = loadPlays();
    const now = new Date().toISOString();
    const prev = plays[playId];
    plays[playId] = { device: String(device || "").slice(0, 80), firstAt: prev ? prev.firstAt : now, updatedAt: now, run };
    savePlays(plays);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// === TEAM: every play as a spreadsheet ===
app.get("/api/ffh/export.csv", requireAdmin, (req, res) => {
  const plays = loadPlays();
  const j = v => (v === undefined || v === null) ? "" : (typeof v === "string" ? v : JSON.stringify(v));
  const rows = Object.entries(plays).map(([id, p]) => {
    const r = p.run || {}, lead = r.lead || {};
    return {
      started: r.startedAt || p.firstAt, last_update: p.updatedAt, finished: r.finishedAt || "", completed: r.completed ? "yes" : "no",
      play_id: id, device: p.device, mode: r.mode, kids_ages: j(r.ages), city: r.city,
      persona: r.personaName || r.persona, second_persona: r.secondary, agreement: j(r.agreement),
      instagram_or_email: lead.contact || "", is_email: lead.isEmail ? "yes" : "", prize_entry: lead.consent ? "yes" : "",
      picks: j(r.picks), votes: j(r.players), beliefs: j(r.beliefs), sorted_items: j(r.ease), comments: j(r.notes),
      source: (r.utm || {}).utm_source || (r.utm || {}).ref || "", campaign: (r.utm || {}).utm_campaign || "", ad: (r.utm || {}).utm_content || "", from_meta_ad: (r.utm || {}).fbclid ? "yes" : "",
      villa_click: r.villaClicked ? "yes" : "",
      card_saved: r.imageSaved ? "yes" : "", caption_copied: r.shareCopied ? "yes" : "", music: r.music ? "on" : "off", read_aloud: r.readAloud ? "on" : "off",
    };
  }).sort((a, b) => String(b.started).localeCompare(String(a.started)));
  const headers = ["started","last_update","finished","completed","play_id","device","mode","kids_ages","city","persona","second_persona","agreement","instagram_or_email","is_email","prize_entry","picks","votes","beliefs","sorted_items","comments","source","campaign","ad","from_meta_ad","villa_click","card_saved","caption_copied","music","read_aloud"];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="future_family_holidays_plays.csv"');
  res.send(toCsv(headers, rows));
});
app.get("/api/ffh/export.json", requireAdmin, (req, res) => res.json(loadPlays()));

// === GAME: anonymous behaviour events (screens, cards, time, where people leave) ===
const FFH_EVENTS = path.join(DATA_DIR, "ffh-events.jsonl");
const CAPI_TOKEN = process.env.META_CAPI_TOKEN || "";
const CAPI_TEST  = process.env.META_TEST_EVENT_CODE || "";
const CAPI_MAP   = { game_complete: "CompleteRegistration", lead: "Lead", game_start: "GameStart" };
const clip = (v, n) => String(v === undefined || v === null ? "" : v).slice(0, n);
function sendToMeta(ev, ctx, req) {
  const name = CAPI_MAP[ev.name];
  if (!PIXEL_ID || !CAPI_TOKEN || !name || ev.phase === "kid") return;
  const user_data = { client_ip_address: req.ip, client_user_agent: clip(req.get("user-agent"), 400) };
  if (ctx.fbp) user_data.fbp = ctx.fbp;
  if (ctx.fbc) user_data.fbc = ctx.fbc;
  if (ctx.device) user_data.external_id = [crypto.createHash("sha256").update(ctx.device).digest("hex")];
  const body = { data: [{ event_name: name, event_time: Math.floor(Date.now() / 1000), event_id: ev.eventId, action_source: "website", event_source_url: ctx.page, user_data, custom_data: { content_name: "Future Family Holidays" } }] };
  if (CAPI_TEST) body.test_event_code = CAPI_TEST;
  fetch(`https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(CAPI_TOKEN)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then(r => { if (!r.ok) r.text().then(t => console.error("Meta CAPI", r.status, t.slice(0, 300))); }).catch(e => console.error("Meta CAPI", e.message));
}
app.post("/api/ffh/events", (req, res) => {
  try {
    const b = req.body || {};
    const ctx = { device: clip(b.device, 80), session: clip(b.session, 60), fbp: clip(b.fbp, 120), fbc: clip(b.fbc, 300), page: clip(b.page, 300) };
    const utm = {};
    for (const k of ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","ref"]) if (b.utm && b.utm[k]) utm[k] = clip(b.utm[k], 120);
    if (b.utm && b.utm.fbclid) utm.fbclid = "yes";
    const events = Array.isArray(b.events) ? b.events.slice(0, 50) : [];
    if (!events.length) return res.json({ ok: true });
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const lines = events.map(ev => JSON.stringify({
      at: new Date().toISOString(), device: ctx.device, session: ctx.session, utm,
      name: clip(ev.name, 40), t: Number(ev.t) || 0, playId: clip(ev.playId, 80), phase: clip(ev.phase, 20), idx: ev.idx, props: ev.props || {},
    })).join("\n") + "\n";
    fs.appendFileSync(FFH_EVENTS, lines);
    events.forEach(ev => sendToMeta(ev, ctx, req));
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
function loadEvents() {
  try { return fs.readFileSync(FFH_EVENTS, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); }
  catch (e) { return []; }
}
app.get("/api/ffh/events.csv", requireAdmin, (req, res) => {
  const rows = loadEvents().map(e => ({ at: e.at, session: e.session, play_id: e.playId, event: e.name, round: e.phase, card_no: e.idx, seconds_in: Math.round((e.t || 0) / 1000), details: JSON.stringify(e.props || {}), source: e.utm.utm_source || e.utm.ref || "", campaign: e.utm.utm_campaign || "", ad: e.utm.utm_content || "" }));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="future_family_holidays_events.csv"');
  res.send(toCsv(["at","session","play_id","event","round","card_no","seconds_in","details","source","campaign","ad"], rows));
});

// === TEAM: funnel, drop-off and time-per-card page ===
app.get("/play/stats", requireAdmin, (req, res) => {
  const evs = loadEvents();
  const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 90));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const recent = evs.filter(e => e.at >= since);
  const sess = new Map();
  for (const e of recent) {
    let s = sess.get(e.session);
    if (!s) { s = { device: e.device || e.session, names: new Set(), parts: new Set(), utm: e.utm || {}, last: null, cards: 0 }; sess.set(e.session, s); }
    s.names.add(e.name);
    if (e.name === "part_reached") s.parts.add((e.props.round || "") + ":" + e.props.part);
    if (e.name === "card_answer") s.cards++;
    if (e.name === "leave" || e.name === "card_view" || e.name === "screen") s.last = e;
    if (e.utm && Object.keys(e.utm).length) s.utm = e.utm;
  }
  const all = [...sess.values()];
  const has = (s, n) => s.names.has(n);
  const steps = [
    ["Opened the game", s => has(s, "landing")],
    ["Tapped Let's play", s => has(s, "game_start")],
    ["Chose who's playing", s => has(s, "mode_chosen")],
    ["Finished ages & city", s => has(s, "ages_done")],
    ["Started the cards", s => s.parts.size > 0],
    ["Answered 5+ cards", s => s.cards >= 5],
    ["Answered 15+ cards", s => s.cards >= 15],
    ["Reached the last part", s => [...s.parts].some(p => /:(ease)$/.test(p))],
    ["Finished (saw persona)", s => has(s, "game_complete")],
    ["Entered the prize", s => has(s, "lead")],
    ["Saved / shared card", s => has(s, "card_shared")],
    ["Clicked to the villa", s => has(s, "villa_click")],
  ];
  const top = all.filter(s => has(s, "landing")).length || all.length || 1;
  const uniq = list => new Set(list.map(s => s.device)).size;
  const topU = uniq(all.filter(s => has(s, "landing"))) || uniq(all) || 1;
  const funnel = steps.map(([label, fn]) => { const hit = all.filter(fn), n = hit.length, u = uniq(hit); return { label, n, u, pct: Math.round(n * 100 / top), upct: Math.round(u * 100 / topU) }; });
  // where unfinished games stopped
  const stops = {};
  for (const s of all) {
    if (has(s, "game_complete") || !s.last) continue;
    const l = s.last, p = l.props || {};
    const SCREENS = { "s-intro": "Landing page", "s-pass": "Pass-the-phone page", "s-who": "Who's playing", "s-ages": "Ages & city", "s-section": "Part intro page", "s-deck": "Cards", "s-result": "Results page" };
    const cardName = `${p.title || p.card} (${l.phase === "kid" ? "kid round" : l.phase || ""})`;
    const key = (l.name === "leave" || l.name === "card_view") && p.card ? cardName : (SCREENS[p.screen || p.id] || p.screen || p.id);
    stops[key] = (stops[key] || 0) + 1;
  }
  const stopRows = Object.entries(stops).sort((a, b) => b[1] - a[1]).slice(0, 25);
  // time per card
  const times = {};
  for (const e of recent) if (e.name === "card_answer" && e.props.ms > 0 && e.props.ms < 300000) { const k = (e.props.title || e.props.card) + " · " + (e.phase === "kid" ? "kid round" : e.phase || ""); (times[k] = times[k] || []).push(e.props.ms); }
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const timeRows = Object.entries(times).map(([k, a]) => [k, med(a) / 1000, a.length]).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const durs = recent.filter(e => e.name === "game_complete" && e.props.secs).map(e => e.props.secs);
  // by source
  const src = {};
  for (const s of all) {
    const k = (s.utm.utm_source || s.utm.ref || "direct") + (s.utm.utm_campaign ? " / " + s.utm.utm_campaign : "") + (s.utm.utm_content ? " / " + s.utm.utm_content : "");
    const r = src[k] = src[k] || { open: 0, start: 0, done: 0, lead: 0, share: 0 };
    if (has(s, "landing")) r.open++; if (has(s, "game_start")) r.start++; if (has(s, "game_complete")) r.done++; if (has(s, "lead")) r.lead++; if (has(s, "card_shared")) r.share++;
  }
  const srcRows = Object.entries(src).sort((a, b) => b[1].open - a[1].open);
  const modes = {}; recent.filter(e => e.name === "mode_chosen").forEach(e => modes[e.props.mode] = (modes[e.props.mode] || 0) + 1);
  const e = escapeHtml, tok = encodeURIComponent(req.query.token || "");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game stats · Future Family Holidays</title>
<style>body{font:15px/1.45 -apple-system,system-ui,sans-serif;margin:0;background:#FAF6EE;color:#1E1A16}main{max-width:860px;margin:0 auto;padding:20px 16px 60px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}p.m{color:#6B5F53;margin:0 0 14px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E2D6C2;border-radius:10px;overflow:hidden}td,th{padding:7px 10px;border-bottom:1px solid #EFE6D6;text-align:left;font-variant-numeric:tabular-nums}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6B5F53;background:#FAF6EE}.bar{height:10px;background:#FF851B;border-radius:5px}.r{text-align:right}a{color:#C45F0E}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{background:#fff;border:1px solid #E2D6C2;border-radius:10px;padding:12px}.tile b{display:block;font-size:24px}</style></head><body><main>
<h1>Future Family Holidays · game stats</h1><p class="m">Last ${days} days · ${all.length} visits · ${uniq(all)} unique visitors · <a href="?token=${tok}&days=7">7d</a> · <a href="?token=${tok}&days=30">30d</a> · <a href="?token=${tok}&days=90">90d</a> · <a href="/api/ffh/export.csv?token=${tok}">plays CSV</a> · <a href="/api/ffh/events.csv?token=${tok}">events CSV</a></p>
<div class="tiles"><div class="tile">Finished<b>${funnel[8].u}</b>${funnel[8].upct}% of unique visitors</div><div class="tile">Prize entries<b>${funnel[9].u}</b>${funnel[9].upct}% of unique visitors</div><div class="tile">Median time to finish<b>${durs.length ? Math.round(med(durs) / 60 * 10) / 10 + " min" : "–"}</b>${durs.length} finished games</div><div class="tile">Who played<b style="font-size:15px;margin-top:6px">${Object.entries(modes).map(([k, v]) => e(k) + " " + v).join(" · ") || "–"}</b></div></div>
<h2>Funnel</h2><p class="m">Visits count every time the game is opened (one person can visit several times). Unique visitors count each phone or browser once. % is of unique visitors who opened the game.</p><table><tr><th>Step</th><th class="r">Visits</th><th class="r">Unique visitors</th><th class="r">%</th><th style="width:34%"></th></tr>${funnel.map(f => `<tr><td>${e(f.label)}</td><td class="r">${f.n}</td><td class="r">${f.u}</td><td class="r">${f.upct}%</td><td><div class="bar" style="width:${f.upct}%"></div></td></tr>`).join("")}</table>
<h2>Where unfinished games stopped</h2><p class="m">The last screen or card before someone left without finishing.</p><table><tr><th>Last seen</th><th class="r">Visits</th></tr>${stopRows.map(([k, v]) => `<tr><td>${e(k)}</td><td class="r">${v}</td></tr>`).join("") || "<tr><td colspan=2>No data yet</td></tr>"}</table>
<h2>Slowest cards</h2><p class="m">Median seconds people spent before answering. Long times can mean "interesting" or "confusing".</p><table><tr><th>Card · round</th><th class="r">Median sec</th><th class="r">Answers</th></tr>${timeRows.map(([k, m, n]) => `<tr><td>${e(k)}</td><td class="r">${m.toFixed(1)}</td><td class="r">${n}</td></tr>`).join("") || "<tr><td colspan=3>No data yet</td></tr>"}</table>
<h2>By source / campaign / ad</h2><p class="m">From the utm_ tags on your links. DMs and bio links show as "direct" unless tagged.</p><table><tr><th>Source / campaign / ad</th><th class="r">Opened</th><th class="r">Started</th><th class="r">Finished</th><th class="r">Entered</th><th class="r">Shared</th></tr>${srcRows.map(([k, r]) => `<tr><td>${e(k)}</td><td class="r">${r.open}</td><td class="r">${r.start}</td><td class="r">${r.done}</td><td class="r">${r.lead}</td><td class="r">${r.share}</td></tr>`).join("")}</table>
</main></body></html>`);
});


app.get("/", (req, res) => res.redirect(302, "/play" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "")));
app.get("/healthz", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Future Family Holidays running on port " + PORT));
