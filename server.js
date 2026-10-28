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
// The new 4-day-plan game (ffh2/) is the live game at /play since 26 Oct 2026; the original game stays at /play/v1.
const FFH2_DIR = path.join(__dirname, "ffh2");
const pages = {};
function ffhHtml(req, dir) {
  dir = dir || FFH2_DIR;
  if (!pages[dir]) pages[dir] = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const base = (process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"))).replace(/\/$/, "");
  const pixel = PIXEL_ID ? `<script>(function(){try{if(localStorage.getItem('esv_ffh_noads'))return}catch(e){}!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');})();</script>` : "";
  return pages[dir].split("{{BASE}}").join(base).replace("<!--PIXEL-->", pixel);
}
// Which game is live at /play. Roll back by setting GAME_VERSION=v1 in Render (Environment) — no code change needed.
//   v2 = "Plan Game" (4-day plan, live from 26 Oct 2026)   v1 = "Vote Game" (original persona game, 9–26 Oct 2026)
const LIVE_GAME = () => (process.env.GAME_VERSION || "v2").toLowerCase() === "v1" ? FFH_DIR : FFH2_DIR;
app.get(["/play", "/play/", "/play/index.html"], (req, res) => {
  // ?game=v1 = old Vote Game (A/B arm, from 28 Oct 2026); ?intro=1 = Plan Game with the opening page
  const dir = req.query.game === "v1" ? FFH_DIR : LIVE_GAME();
  try { res.set("Cache-Control", "no-cache").type("html").send(ffhHtml(req, dir)); }
  catch (e) { console.error(e); res.status(500).send("Game not found"); }
});
// TEST LINK: /play/next shows the next version before it goes live (same tracking, but open it with ?tester=1)
app.get(["/play/next", "/play/next/"], (req, res) => {
  const dir = fs.existsSync(path.join(__dirname, "ffh2next", "index.html")) ? path.join(__dirname, "ffh2next") : FFH2_DIR;
  try { res.set("Cache-Control", "no-cache").type("html").send(ffhHtml(req, dir).replace("<head>", '<head><meta name="robots" content="noindex">')); }
  catch (e) { console.error(e); res.status(500).send("Game not found"); }
});
// /play/go = the Plan Game with the opening page (intro A/B arm, from 28 Oct 2026)
app.get(["/play/go", "/play/go/", "/play/start"], (req, res) => {
  try { res.set("Cache-Control", "no-cache").type("html").send(ffhHtml(req, FFH2_DIR)); }
  catch (e) { console.error(e); res.status(500).send("Game not found"); }
});
app.get(["/play/v2", "/play/plan-game"], (req, res) => {
  try { res.set("Cache-Control", "no-cache").type("html").send(ffhHtml(req, FFH2_DIR)); }
  catch (e) { console.error(e); res.status(500).send("Game not found"); }
});
app.get(["/play/v1", "/play/v1/", "/play/vote-game"], (req, res) => {
  try { res.set("Cache-Control", "no-cache").type("html").send(ffhHtml(req, FFH_DIR)); }
  catch (e) { console.error(e); res.status(500).send("Game not found"); }
});
app.use("/play/v2", express.static(path.join(FFH2_DIR, "v"), { maxAge: "7d", index: false, acceptRanges: true }));
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
      game: r.game || "v1", adults: r.adults || "", market: r.market || "", travel_window: r.when || "", cards_yes: j(r.yes), cards_no: j(r.no), toys: j(r.toys), pool_hour_pick: r.rest || "", extras: j(r.extras),
      draw_entered: r.drawEntered ? "yes" : "", draw_answers: j(r.draw), snack_taps: j(r.snackTaps), pdf_saved: r.pdfSaved ? "yes" : "",
    };
  }).sort((a, b) => String(b.started).localeCompare(String(a.started)));
  const headers = ["started","last_update","finished","completed","game","play_id","device","mode","adults","kids_ages","city","market","travel_window","persona","second_persona","agreement","instagram_or_email","is_email","prize_entry","draw_entered","draw_answers","cards_yes","cards_no","toys","pool_hour_pick","extras","picks","votes","beliefs","sorted_items","comments","snack_taps","pdf_saved","source","campaign","ad","from_meta_ad","villa_click","card_saved","caption_copied","music","read_aloud"];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="future_family_holidays_plays.csv"');
  res.send(toCsv(headers, rows));
});
// === TEAM: everyone in the 3-nights draw (old game prize entries + new game draw entries) ===
app.get("/api/ffh/draw.csv", requireAdmin, (req, res) => {
  const plays = loadPlays(), j = v => (v === undefined || v === null) ? "" : (typeof v === "string" ? v : JSON.stringify(v));
  const rows = Object.entries(plays).map(([id, p]) => ({ id, p, r: p.run || {} }))
    .filter(x => x.r.drawEntered || (x.r.lead && x.r.lead.consent))
    .map(({ id, p, r }) => ({ entered: r.finishedAt || p.updatedAt, game: r.game || "v1", instagram_or_email: (r.lead || {}).contact || "", adults: r.adults || "", kids_ages: j(r.ages), market: r.market || r.city || "", travel_window: r.when || "", draw_answers: j(r.draw), play_id: id }))
    .sort((a, b) => String(b.entered).localeCompare(String(a.entered)));
  res.setHeader("Content-Type", "text/csv"); res.setHeader("Content-Disposition", 'attachment; filename="ffh_draw_entries.csv"');
  res.send(toCsv(["entered","game","instagram_or_email","adults","kids_ages","market","travel_window","draw_answers","play_id"], rows));
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
      at: new Date().toISOString(), device: ctx.device, session: ctx.session, utm, tester: b.tester === true || undefined,
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

// === GAME: host a family's card image so it can be saved from in-app browsers (Instagram, FB) ===
const CARD_DIR = path.join(DATA_DIR, "cards");
app.post("/api/ffh/card", express.raw({ type: "image/png", limit: "4mb" }), (req, res) => {
  try {
    const id = String(req.query.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
    const buf = req.body;
    if (!id || !Buffer.isBuffer(buf) || buf.length < 100 || buf.slice(1, 4).toString() !== "PNG") return res.status(400).json({ error: "bad card" });
    if (!fs.existsSync(CARD_DIR)) fs.mkdirSync(CARD_DIR, { recursive: true });
    fs.writeFileSync(path.join(CARD_DIR, id + ".png"), buf);
    const base = process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"));
    res.json({ url: base.replace(/\/$/, "") + "/play/card/" + id + ".png" });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});
app.get("/play/card/:id.png", (req, res) => {
  const id = String(req.params.id || "").replace(/[^A-Za-z0-9_-]/g, "");
  const f = path.join(CARD_DIR, id + ".png");
  if (!id || !fs.existsSync(f)) return res.status(404).send("Card not found");
  res.set("Content-Disposition", 'inline; filename="endless-summer-family-card.png"').type("png").sendFile(f);
});

// === NEW GAME: save a family's 4-day plan PDF and send it ===
// Email addresses get it straight away from Gmail (GMAIL_USER + GMAIL_APP_PASSWORD).
// Instagram handles are queued for the daily DM run (the game tells them "within 24 hours").
// Team view of the DM queue: /api/ffh/plan-queue.json?token=ADMIN_TOKEN
const PLAN_DIR = path.join(DATA_DIR, "plans");
const PLAN_QUEUE = path.join(DATA_DIR, "plan-dm-queue.json");
const planHits = new Map(); // ip -> [timestamps], max 5 an hour
let mailer = null;
function getMailer() {
  if (mailer !== null) return mailer;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) { mailer = false; return mailer; }
  const nodemailer = require("nodemailer");
  mailer = nodemailer.createTransport({ service: "gmail", auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, "") } });
  return mailer;
}
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } }
// The plan email: Endless Summer branding, Jayne's voice, plan link + PDF attached, 20% via Instagram DM or email
function planEmailText(url) {
  return `Hi there,

Thank you for playing with your kids. Here's the 4-day plan your family built: every stop is a place we know on the Bukit, timed for your kids' ages and priced for your family. It's attached as a PDF, and you can also open it here: ${url}

Welcome to Bali (almost)
I'm Jayne, a mum of three from Singapore. Endless Summer is our family's home in Ungasan, the quiet, kid-friendly end of Uluwatu, and we share it with other families when we're back in Singapore.
- 4 bedrooms, all en-suite, sleeps 8
- A kids' pool, 1 metre deep, with a ledge little ones can stand on
- A climbing wall in the living room
- Filtered water for the whole house, pool included, gentle on skin and hair
- Ohana's kids' playground restaurant right next door; Melasti Beach 10 minutes away

Your player price: 20% off our Airbnb price, whenever you're ready
Message us on Instagram @endless.summer.bali (https://ig.me/m/endless.summer.bali) or reply to this email with your dates, and we'll send the exact price.

Photos of the house: https://endlesssummerbali.com/photos
Our Uluwatu-with-kids favourites: https://endlesssummerbali.com/uluwatukidsitinerary

See you in Bali,
Jayne
Mum of three · Endless Summer Villa, Ungasan, Bali`;
}
function planEmailHtml(url, base) {
  const O = "#FF851B", INK = "#2B2118", MUTED = "#7A6A5A", CREAM = "#F3EBDD", CARD = "#FFFBF4";
  const btn = (href, label, bg, fg) => `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:999px;margin:4px 6px 4px 0">${label}</a>`;
  const li = t => `<tr><td style="padding:4px 10px 4px 0;vertical-align:top;color:${O};font-size:16px">&#9679;</td><td style="padding:4px 0;font-size:15px;line-height:1.5;color:${INK}">${t}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD};border-radius:20px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;color:${INK}">
<tr><td style="padding:22px 28px 10px"><img src="${base}/play/a/LOGO.png" width="150" alt="Endless Summer Villa" style="display:block;border:0"></td></tr>
<tr><td><img src="${base}/play/v2/email-hero.jpg" width="600" alt="Our girls in the kids' pool at Endless Summer" style="display:block;width:100%;height:auto;border:0"></td></tr>
<tr><td style="padding:26px 28px 6px">
  <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:28px;line-height:1.2">Your family's 4 days in Uluwatu</p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hi there,<br><br>Thank you for playing with your kids. Here's the 4-day plan your family built: every stop is a place we know on the Bukit, timed for your kids' ages and priced for your family. It's attached as a PDF too.</p>
  ${btn(url, "Open our 4-day plan", O, "#fff")}
</td></tr>
<tr><td style="padding:22px 28px 4px">
  <p style="margin:0 0 8px;font-family:Georgia,serif;font-size:22px">Welcome to Bali (almost)</p>
  <p style="margin:0 0 10px;font-size:15px;line-height:1.6">I'm Jayne, a mum of three from Singapore. Endless Summer is our family's home in Ungasan, the quiet, kid-friendly end of Uluwatu, and we share it with other families when we're back in Singapore.</p>
  <table role="presentation" cellpadding="0" cellspacing="0">${li("4 bedrooms, all en-suite, sleeps 8")}${li("A kids' pool, 1 metre deep, with a ledge little ones can stand on")}${li("A climbing wall in the living room")}${li("Filtered water for the whole house, pool included, gentle on skin and hair")}${li("Ohana's kids' playground restaurant right next door; Melasti Beach 10 minutes away")}</table>
  <p style="margin:12px 0 0;font-size:14px"><a href="https://endlesssummerbali.com/photos" style="color:#C45F0E">See the house</a> &nbsp;·&nbsp; <a href="https://endlesssummerbali.com/uluwatukidsitinerary" style="color:#C45F0E">Our Uluwatu-with-kids favourites</a></p>
</td></tr>
<tr><td style="padding:22px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFE7D1;border-radius:16px"><tr><td style="padding:18px 20px">
  <p style="margin:0 0 6px;font-family:Georgia,serif;font-size:21px">Your player price: 20% off</p>
  <p style="margin:0 0 12px;font-size:15px;line-height:1.6">20% off our Airbnb price, whenever you're ready to book. Send us your dates and we'll reply with the exact price.</p>
  ${btn("https://ig.me/m/endless.summer.bali", "Message us on Instagram", INK, "#fff")}${btn("mailto:" + (process.env.GMAIL_USER || "endless.summer.ulu@gmail.com") + "?subject=Our%20dates%20for%20Endless%20Summer", "Email us", "#fff", INK)}
</td></tr></table></td></tr>
<tr><td style="padding:22px 28px 26px;font-size:15px;line-height:1.6">See you in Bali,<br><span style="font-family:Georgia,serif;font-size:20px">Jayne</span><br><span style="color:${MUTED};font-size:13px">Mum of three · Endless Summer Villa, Ungasan, Bali · <a href="https://www.instagram.com/endless.summer.bali/" style="color:${MUTED}">@endless.summer.bali</a></span></td></tr>
</table>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${MUTED};margin:14px 0 0">You're getting this because you asked for your plan in our Future Family Holidays game.</p>
</td></tr></table></body></html>`;
}
app.post("/api/ffh/plan", express.raw({ type: "application/pdf", limit: "8mb" }), async (req, res) => {
  try {
    const ip = req.ip || "x", now = Date.now();
    const hits = (planHits.get(ip) || []).filter(t => now - t < 3600e3);
    if (hits.length >= 5) return res.status(429).json({ error: "Too many plans from here. Try again in an hour." });
    hits.push(now); planHits.set(ip, hits);
    const contact = String(req.query.to || "").trim().slice(0, 120);
    const playId = String(req.query.play || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 500 || buf.slice(0, 4).toString() !== "%PDF") return res.status(400).json({ error: "bad pdf" });
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact);
    const handle = contact.replace(/^@/, "");
    if (!isEmail && !/^[A-Za-z0-9._]{1,30}$/.test(handle)) return res.status(400).json({ error: "Please enter an email address or an Instagram handle." });
    const id = crypto.randomBytes(9).toString("base64url");
    if (!fs.existsSync(PLAN_DIR)) fs.mkdirSync(PLAN_DIR, { recursive: true });
    fs.writeFileSync(path.join(PLAN_DIR, id + ".pdf"), buf);
    const base = (process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"))).replace(/\/$/, "");
    const url = base + "/play/plan/" + id + ".pdf";
    if (isEmail) {
      const m = getMailer();
      if (!m) return res.json({ ok: true, via: "none", url, note: "Email isn't set up on the server yet." });
      await m.sendMail({
        from: `"Jayne at Endless Summer" <${process.env.GMAIL_USER}>`,
        to: contact,
        subject: "Welcome to Bali: your family's 4 days in Uluwatu",
        text: planEmailText(url),
        html: planEmailHtml(url, base),
        attachments: [{ filename: "Our-4-days-in-Uluwatu.pdf", content: buf, contentType: "application/pdf" }]
      });
      return res.json({ ok: true, via: "email", url });
    }
    const q = readJson(PLAN_QUEUE, []);
    q.push({ handle, url, playId, at: new Date().toISOString(), status: "to send" });
    fs.writeFileSync(PLAN_QUEUE, JSON.stringify(q, null, 1));
    res.json({ ok: true, via: "instagram", url });
  } catch (e) { console.error("plan send failed", e.message); res.status(500).json({ error: "Couldn't send it just now. Please use Download instead." }); }
});
app.get("/play/plan/:id.pdf", (req, res) => {
  const id = String(req.params.id || "").replace(/[^A-Za-z0-9_-]/g, "");
  const f = path.join(PLAN_DIR, id + ".pdf");
  if (!id || !fs.existsSync(f)) return res.status(404).send("Plan not found");
  res.set("Content-Disposition", 'inline; filename="Our-4-days-in-Uluwatu.pdf"').type("pdf").sendFile(f);
});
app.get("/api/ffh/plan-queue.json", requireAdmin, (req, res) => res.json(readJson(PLAN_QUEUE, [])));
app.post("/api/ffh/plan-queue/:i/sent", requireAdmin, (req, res) => {
  const q = readJson(PLAN_QUEUE, []); const i = +req.params.i;
  if (!q[i]) return res.status(404).json({ error: "no such row" });
  q[i].status = "sent"; q[i].sentAt = new Date().toISOString(); fs.writeFileSync(PLAN_QUEUE, JSON.stringify(q, null, 1)); res.json(q[i]);
});

// === PUBLIC counts for the new game (counts only, no personal data), read by the daily Game Counts refresh ===
app.get("/api/ffh/v2.json", (req, res) => {
  const evs = loadEvents(), testers = new Set(evs.filter(e => e.tester).map(e => e.device));
  const since = req.query.since || "2026-10-26";
  // ?variant=intro | nointro splits the opening-page test; ?nobots=1 drops Meta ad-review bursts
  // (3+ new sessions landing in the same minute = bots checking a new or edited ad)
  const variant = req.query.variant || "", nobots = req.query.nobots === "1";
  const perMin = {}, landMin = {};
  for (const e of evs) if (e.name === "landing" && e.at >= since) { const m = e.at.slice(0, 16); if (!landMin[e.session]) { landMin[e.session] = m; perMin[m] = (perMin[m] || 0) + 1; } }
  const isBot = sid => landMin[sid] && perMin[landMin[sid]] >= 3;
  let bots = 0; const botSeen = new Set();
  const sess = new Map();
  for (const e of evs) {
    if (e.at < since || testers.has(e.device) || !(e.props && e.props.v === "v2")) continue;
    if (variant === "intro" && e.props.intro !== 1) continue;
    if (variant === "nointro" && e.props.intro === 1) continue;
    if (nobots && isBot(e.session)) { if (!botSeen.has(e.session)) { botSeen.add(e.session); bots++; } continue; }
    let s = sess.get(e.session); if (!s) { s = { d: e.device, n: new Set(), cards: 0, last: null }; sess.set(e.session, s); }
    s.n.add(e.name); if (e.name === "card_answer") s.cards++; if (e.name === "leave" || e.name === "card_view") s.last = e;
  }
  const a = [...sess.values()], c = f => a.filter(f).length, h = n => s => s.n.has(n);
  const stops = {};
  for (const s of a) { if (s.n.has("game_complete") || !s.last) continue; const p = s.last.props || {}; const k = p.card ? "card " + p.card : (p.screen || "?"); stops[k] = (stops[k] || 0) + 1; }
  res.json({ since, variant: variant || "all", botsExcluded: nobots ? bots : null, opened: c(h("landing")), tappedIntro: c(h("intro_start")), answeredCard1: c(h("game_start")), answered3: c(s => s.cards >= 3), whoDone: c(h("who_done")), proof: c(h("proof_view")), answered12: c(s => s.cards >= 12),
    toys: c(h("toys_done")), lastScreen: c(h("final_done")), gotPlan: c(h("game_complete")), gaveContact: c(h("lead")), planSent: c(h("plan_sent")), savedPdf: c(h("pdf_save")), draw: c(h("draw_entry")), snacks: c(h("snack_taps")),
    topStops: Object.entries(stops).sort((x, y) => y[1] - x[1]).slice(0, 8) });
});

// === PUBLIC aggregate for the intro-page test (counts only, no personal data) ===
app.get("/api/ffh/ab.json", (req, res) => {
  const evs = loadEvents(), testers = new Set(evs.filter(e => e.tester).map(e => e.device));
  const since = req.query.since || "2026-10-17";
  const sess = new Map();
  for (const e of evs) {
    if (e.at < since || testers.has(e.device)) continue;
    let s = sess.get(e.session); if (!s) { s = { v: "", n: new Set(), last: null, parts: 0 }; sess.set(e.session, s); }
    if (!s.v && e.props && (e.props.v === "intro" || e.props.v === "no-intro")) s.v = e.props.v;
    s.n.add(e.name); if (e.name === "part_reached") s.parts++;
    if (e.name === "screen" || e.name === "leave" || e.name === "card_view") s.last = e;
  }
  const out = {};
  for (const v of ["intro", "no-intro"]) {
    const a = [...sess.values()].filter(s => s.v === v), st = a.filter(s => s.n.has("game_start"));
    out[v] = { opened: a.filter(s => s.n.has("landing")).length, started: st.length, reachedCards: a.filter(s => s.parts > 0).length,
      finished: a.filter(s => s.n.has("game_complete")).length, prizeEntries: a.filter(s => s.n.has("lead")).length,
      leftOnIntroPage: a.filter(s => !s.n.has("game_complete") && s.last && (s.last.props || {}).id === "s-section").length };
  }
  res.set("Cache-Control", "no-store").json({ since, test: "part intro pages on (intro) vs off (no-intro)", groups: out });
});

// === TEAM: funnel, drop-off and time-per-card page ===
app.get("/play/stats", requireAdmin, (req, res) => {
  const evs = loadEvents();
  const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 90));
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const testers = new Set(evs.filter(e => e.tester).map(e => e.device));
  const showTesters = req.query.testers === "1";
  const recent = evs.filter(e => e.at >= since && (showTesters || !testers.has(e.device)));
  const sess = new Map();
  for (const e of recent) {
    let s = sess.get(e.session);
    if (!s) { s = { device: e.device || e.session, names: new Set(), parts: new Set(), utm: e.utm || {}, last: null, cards: 0, v: "", first: null, answers: 0, top: 0, secView: {}, secGo: {} }; sess.set(e.session, s); }
    if (!s.v && e.props && (e.props.v === "intro" || e.props.v === "no-intro")) s.v = e.props.v;
    if (e.props && e.props.v === "v2") s.v2 = true;
    if (e.name === "card_answer") { s.answers++; if (!s.first) s.first = e.t; if (/^(book|so|delight)$/i.test(String(e.props.answer || "")) ) s.top++; }
    if (e.name === "section_view") s.secView[(e.phase || "") + ":" + e.props.part] = e.t;
    if (e.name === "part_reached" && e.props.intro !== false) s.secGo[(e.props.round || "") + ":" + e.props.part] = e.t;
    s.names.add(e.name);
    if (e.name === "part_reached") s.parts.add((e.props.round || "") + ":" + e.props.part);
    if (e.name === "card_answer") s.cards++;
    if (e.name === "leave" || e.name === "card_view" || e.name === "screen") s.last = e;
    if (e.utm && Object.keys(e.utm).length) s.utm = e.utm;
  }
  // ?game=v2 shows the new 4-day-plan game; without it, the original game
  const V2 = req.query.game === "v2";
  const all = [...sess.values()].filter(s => V2 ? s.v2 : !s.v2);
  const has = (s, n) => s.names.has(n);
  const stepsV2 = [
    ["Opened the game", s => has(s, "landing")],
    ["Answered card 1", s => has(s, "game_start")],
    ["Answered 3 cards", s => s.cards >= 3],
    ["Filled in who's coming", s => has(s, "who_done")],
    ["Saw 'You're in good company'", s => has(s, "proof_view")],
    ["Answered all 12 cards", s => s.cards >= 12],
    ["Filled the toy box", s => has(s, "toys_done")],
    ["Answered the last screen (when)", s => has(s, "final_done")],
    ["Got their plan", s => has(s, "game_complete")],
    ["Gave email or Instagram", s => has(s, "lead")],
    ["Saved or shared the PDF", s => has(s, "pdf_save")],
    ["Entered the draw", s => has(s, "draw_entry")],
    ["Kids tapped the snacks", s => has(s, "snack_taps")],
  ];
  const steps = V2 ? stepsV2 : [
    ["Opened the game", s => has(s, "landing")],
    ["Tapped Let's play", s => has(s, "game_start")],
    ["Finished setup (who's playing, ages)", s => has(s, "ages_done")],
    ["Started the cards", s => s.parts.size > 0],
    ["Answered 5+ cards", s => s.cards >= 5],
    ["Answered 15+ cards", s => s.cards >= 15],
    ["Reached the last part", s => [...s.parts].some(p => /:(ease)$/.test(p)) || has(s, "game_complete")],
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
    const V2SCREENS = { card: "Cards", who: "Who's coming", proof: "Good company page", toys: "Toy box", rest: "Pool hour pick", final: "When + extras", load: "Building the plan", plan: "Plan page" };
    const key = V2 ? ((l.name === "leave" || l.name === "card_view") && p.card ? "Card: " + p.card : (V2SCREENS[p.screen] || p.screen || "?"))
      : ((l.name === "leave" || l.name === "card_view") && p.card ? cardName : (SCREENS[p.screen || p.id] || p.screen || p.id));
    stops[key] = (stops[key] || 0) + 1;
  }
  const stopRows = Object.entries(stops).sort((a, b) => b[1] - a[1]).slice(0, 25);
  // time per card
  const times = {};
  for (const e of recent) if (e.name === "card_answer" && e.props.ms > 0 && e.props.ms < 300000) { const k = (e.props.title || e.props.card) + " · " + (e.phase === "kid" ? "kid round" : e.phase || ""); (times[k] = times[k] || []).push(e.props.ms); }
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const timeRows = Object.entries(times).map(([k, a]) => [k, med(a) / 1000, a.length]).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const durs = recent.filter(e => e.name === "game_complete" && e.props.secs).map(e => e.props.secs);
  const fin = funnel.find(f => f.label.startsWith("Finished (") || f.label === "Got their plan"), ent = funnel.find(f => f.label === "Entered the prize" || f.label === "Entered the draw");
  const lands = recent.filter(e => e.name === "landing");
  const loads = lands.map(e => e.props.loadMs).filter(v => v > 0 && v < 120000);
  const inApp = lands.length ? Math.round(lands.filter(e => e.props.inApp).length * 100 / lands.length) : 0;
  // by source
  const src = {};
  for (const s of all) {
    const k = (s.utm.utm_source || s.utm.ref || "direct") + (s.utm.utm_campaign ? " / " + s.utm.utm_campaign : "") + (s.utm.utm_content ? " / " + s.utm.utm_content : "");
    const r = src[k] = src[k] || { open: 0, start: 0, done: 0, lead: 0, share: 0 };
    if (has(s, "landing")) r.open++; if (has(s, "game_start")) r.start++; if (has(s, "game_complete")) r.done++; if (has(s, "lead")) r.lead++; if (has(s, "card_shared")) r.share++;
  }
  const srcRows = Object.entries(src).sort((a, b) => b[1].open - a[1].open);
  // A/B test: part intro pages on vs off
  const arms = ["intro", "no-intro"].map(v => {
    const a = all.filter(s => s.v === v), started = a.filter(s => has(s, "game_start")), cards = a.filter(s => s.parts.size > 0);
    const done = a.filter(s => has(s, "game_complete")), lead = a.filter(s => has(s, "lead"));
    const ans = a.reduce((t, s) => t + s.answers, 0), top = a.reduce((t, s) => t + s.top, 0);
    const secs = recent.filter(e => e.name === "game_complete" && e.props.v === v && e.props.secs).map(e => e.props.secs);
    const pct = (x, y) => y ? Math.round(x * 100 / y) + "%" : "–";
    return { v, open: a.filter(s => has(s, "landing")).length, started: started.length, cards: cards.length, done: done.length, lead: lead.length,
      cardsPct: pct(cards.length, started.length), donePct: pct(done.length, started.length), leadPct: pct(lead.length, started.length),
      topPct: pct(top, ans), mins: secs.length ? (Math.round(med(secs) / 6) / 10) + " min" : "–", left: a.filter(s => !has(s, "game_complete") && s.last && (s.last.props || {}).id === "s-section").length };
  });
  // A/B test: ad clickers land on the first card (quick) vs the welcome page (classic)
  const landOf = s => s.land || "";
  for (const e of recent) { const s = sess.get(e.session); if (s && !s.land && e.props && (e.props.land === "quick" || e.props.land === "classic")) s.land = e.props.land; }
  const lands2 = ["classic", "quick"].map(v => {
    const a = all.filter(s => landOf(s) === v), open = a.filter(s => has(s, "landing")).length;
    const ans1 = a.filter(s => s.answers >= 1).length, done = a.filter(s => has(s, "game_complete")).length, lead = a.filter(s => has(s, "lead")).length;
    const pct = (x, y) => y ? Math.round(x * 100 / y) + "%" : "–";
    return { v, open, ans1, done, lead, ans1Pct: pct(ans1, open), donePct: pct(done, open), leadPct: pct(lead, open) };
  });
  // each intro page: shown, tapped Start, median seconds on the page
  const PARTNAME = { idea: "Part 1 Holiday ideas", ideaKid: "Kids: Hi I'm Sunny", pick: "Part 2 Pick favourites", pickKid: "Kids: Pick favourites", belief: "Part 3 About you", ease: "Part 4 Little things" };
  const secRows = {};
  for (const s of all) for (const [k, t0] of Object.entries(s.secView)) {
    const r = secRows[k] = secRows[k] || { shown: 0, go: 0, ms: [] }; r.shown++;
    if (s.secGo[k] !== undefined) { r.go++; const d = s.secGo[k] - t0; if (d >= 0 && d < 600000) r.ms.push(d); }
  }
  const secList = Object.entries(secRows).map(([k, r]) => [PARTNAME[k.split(":")[1]] || k, r.shown, r.go, r.shown - r.go, r.ms.length ? (med(r.ms) / 1000).toFixed(1) : "–"]);
  const modes = {}; recent.filter(e => e.name === "mode_chosen").forEach(e => modes[e.props.mode] = (modes[e.props.mode] || 0) + 1);
  const e = escapeHtml, tok = encodeURIComponent(req.query.token || "");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Game stats · Future Family Holidays</title>
<style>body{font:15px/1.45 -apple-system,system-ui,sans-serif;margin:0;background:#FAF6EE;color:#1E1A16}main{max-width:860px;margin:0 auto;padding:20px 16px 60px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}p.m{color:#6B5F53;margin:0 0 14px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E2D6C2;border-radius:10px;overflow:hidden}td,th{padding:7px 10px;border-bottom:1px solid #EFE6D6;text-align:left;font-variant-numeric:tabular-nums}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6B5F53;background:#FAF6EE}.bar{height:10px;background:#FF851B;border-radius:5px}.r{text-align:right}a{color:#C45F0E}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tile{background:#fff;border:1px solid #E2D6C2;border-radius:10px;padding:12px}.tile b{display:block;font-size:24px}</style></head><body><main>
<h1>Future Family Holidays · game stats</h1><p class="m"><b>${V2 ? "New game (4-day plan)" : "Original game"}</b> · <a href="?token=${tok}&game=v2">new game</a> · <a href="?token=${tok}">original game</a> · <a href="/api/ffh/draw.csv?token=${tok}">draw entries (CSV)</a> · <a href="/api/ffh/plan-queue.json?token=${tok}">plans to DM</a><br>Last ${days} days · ${all.length} visits · ${uniq(all)} unique visitors · <a href="?token=${tok}&days=7">7d</a> · <a href="?token=${tok}&days=30">30d</a> · <a href="?token=${tok}&days=90">90d</a> · <a href="/api/ffh/export.csv?token=${tok}">plays CSV</a> · <a href="/api/ffh/events.csv?token=${tok}">events CSV</a> · ${testers.size ? (showTesters ? `<a href="?token=${tok}&days=${days}">hide tester plays</a>` : `${testers.size} tester device(s) hidden · <a href="?token=${tok}&days=${days}&testers=1">show</a>`) : `mark your phone as a tester: open the game once with <b>?tester=1</b>`}</p>
<div class="tiles"><div class="tile">Finished<b>${fin.u}</b>${fin.upct}% of unique visitors</div><div class="tile">Prize entries<b>${ent.u}</b>${ent.upct}% of unique visitors</div><div class="tile">Page ready in<b>${loads.length ? (med(loads)/1000).toFixed(1) + " s" : "–"}</b>median · ${inApp}% inside Instagram/FB</div><div class="tile">Median time to finish<b>${durs.length ? Math.round(med(durs) / 60 * 10) / 10 + " min" : "–"}</b>${durs.length} finished games</div><div class="tile">Who played<b style="font-size:15px;margin-top:6px">${Object.entries(modes).map(([k, v]) => e(k) + " " + v).join(" · ") || "–"}</b></div></div>
<h2>Funnel</h2><p class="m">Visits count every time the game is opened (one person can visit several times). Unique visitors count each phone or browser once. % is of unique visitors who opened the game.</p><table><tr><th>Step</th><th class="r">Visits</th><th class="r">Unique visitors</th><th class="r">%</th><th style="width:34%"></th></tr>${funnel.map(f => `<tr><td>${e(f.label)}</td><td class="r">${f.n}</td><td class="r">${f.u}</td><td class="r">${f.upct}%</td><td><div class="bar" style="width:${f.upct}%"></div></td></tr>`).join("")}</table>
<h2>Test: welcome page vs straight to the first card (ad clickers only)</h2><p class="m">Since 20 Oct, people arriving from Meta ads are split 50/50 for good: "classic" sees the welcome page and setup; "quick" lands on the first card (parent mode, no setup). Percentages are of people who opened the game.</p><table><tr><th>Group</th><th class="r">Opened</th><th class="r">Answered 1+ card</th><th class="r">Finished</th><th class="r">Prize entry</th></tr>${lands2.map(a => `<tr><td>${e(a.v)}</td><td class="r">${a.open}</td><td class="r">${a.ans1} (${a.ans1Pct})</td><td class="r">${a.done} (${a.donePct})</td><td class="r">${a.lead} (${a.leadPct})</td></tr>`).join("")}</table>
<h2>Test: part intro pages on vs off</h2><p class="m">Since 17 Oct each phone is put in one group for good. "intro" sees the "Part 1 of 4 · how the buttons work" pages; "no-intro" skips them and Sunny gives a one-line cue on the first card instead. Percentages are of people who tapped Let's play. Wait for about 100 starts per group before deciding; with fewer, a gap of under 10 points can be chance.</p><table><tr><th>Group</th><th class="r">Opened</th><th class="r">Started</th><th class="r">Reached cards</th><th class="r">Finished</th><th class="r">Prize entry</th><th class="r">Biggest-button answers</th><th class="r">Median time</th><th class="r">Left on an intro page</th></tr>${arms.map(a => `<tr><td>${e(a.v)}</td><td class="r">${a.open}</td><td class="r">${a.started}</td><td class="r">${a.cards} (${a.cardsPct})</td><td class="r">${a.done} (${a.donePct})</td><td class="r">${a.lead} (${a.leadPct})</td><td class="r">${a.topPct}</td><td class="r">${a.mins}</td><td class="r">${a.left}</td></tr>`).join("")}</table>
<h2>Intro pages one by one</h2><p class="m">Only the "intro" group sees these. "Left" = shown but never tapped Start. Seconds = median time on the page before tapping Start.</p><table><tr><th>Page</th><th class="r">Shown</th><th class="r">Tapped Start</th><th class="r">Left</th><th class="r">Median sec</th></tr>${secList.map(r => `<tr><td>${e(r[0])}</td><td class="r">${r[1]}</td><td class="r">${r[2]}</td><td class="r">${r[3]}</td><td class="r">${r[4]}</td></tr>`).join("") || "<tr><td colspan=5>No data yet</td></tr>"}</table>
<h2>Feedback: "How was the game?"</h2><p class="m">The one question on the results page (since 20 Oct). Free-text answers are in the plays CSV.</p><table><tr><th>Answer</th><th class="r">Count</th></tr>${(()=>{const f={};recent.filter(x=>x.name==="feedback").forEach(x=>{const k=x.props.answer||"?";f[k]=(f[k]||0)+1;});const L={loved:"Loved it",long:"A bit long",confusing:"Confusing in places",broken:"Something didn't work"};return Object.entries(f).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${e(L[k]||k)}</td><td class="r">${v}</td></tr>`).join("")||"<tr><td colspan=2>No answers yet</td></tr>";})()}</table>
<h2>Where unfinished games stopped</h2><p class="m">The last screen or card before someone left without finishing.</p><table><tr><th>Last seen</th><th class="r">Visits</th></tr>${stopRows.map(([k, v]) => `<tr><td>${e(k)}</td><td class="r">${v}</td></tr>`).join("") || "<tr><td colspan=2>No data yet</td></tr>"}</table>
<h2>Slowest cards</h2><p class="m">Median seconds people spent before answering. Long times can mean "interesting" or "confusing".</p><table><tr><th>Card · round</th><th class="r">Median sec</th><th class="r">Answers</th></tr>${timeRows.map(([k, m, n]) => `<tr><td>${e(k)}</td><td class="r">${m.toFixed(1)}</td><td class="r">${n}</td></tr>`).join("") || "<tr><td colspan=3>No data yet</td></tr>"}</table>
<h2>By source / campaign / ad</h2><p class="m">From the utm_ tags on your links. DMs and bio links show as "direct" unless tagged.</p><table><tr><th>Source / campaign / ad</th><th class="r">Opened</th><th class="r">Started</th><th class="r">Finished</th><th class="r">Entered</th><th class="r">Shared</th></tr>${srcRows.map(([k, r]) => `<tr><td>${e(k)}</td><td class="r">${r.open}</td><td class="r">${r.start}</td><td class="r">${r.done}</td><td class="r">${r.lead}</td><td class="r">${r.share}</td></tr>`).join("")}</table>
</main></body></html>`);
});


app.get("/", (req, res) => res.redirect(302, "/play" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "")));
app.get("/healthz", (req, res) => res.send("ok"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Future Family Holidays running on port " + PORT));
