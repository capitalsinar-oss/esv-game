// Segment summary of the vote game for the research report.
// Counts "said yes" (love or book) out of all votes, by theme and by idea, for each segment
// (kids' ages, home city, play mode, traffic source, and parent vs kid votes).
// Same filter as the campaign report: vote game (v1), started on or after 17 Oct 2026, finished, not Jayne's test devices.
// No contact details are used or printed.
const fs = require("fs");
const path = require("path");

const TEST_LEAD = /tisjayne|daysatjati/i;

function ideaThemes() {
  const html = fs.readFileSync(path.join(__dirname, "ffh", "index.html"), "utf8");
  const map = {};
  const re = /\{id:"([a-z]\d+)",w:"([a-z])"/g;
  let m;
  while ((m = re.exec(html))) map[m[1]] = m[2];
  return map;
}

function source(u) {
  u = u || {};
  const c = String(u.utm_campaign || "") + " " + String(u.utm_content || "") + " " + String(u.utm_source || "") + " " + String(u.ref || "");
  if (u.fbclid || /meta|facebook|fb|ig_ad|cmp/i.test(c)) {
    if (/(^|[^a-z])au([^a-z]|$)|austral/i.test(c)) return "meta-au";
    if (/expat/i.test(c)) return "meta-sg-expat";
    if (/(^|[^a-z])sg([^a-z]|$)|singapore/i.test(c)) return "meta-sg";
    if (/long|(^|[^a-z])(uk|eu|us)([^a-z]|$)/i.test(c)) return "meta-longhaul";
    return "meta-other";
  }
  if (/instagram|ig|dm/i.test(c)) return "instagram";
  return c.trim() ? "other:" + c.trim().slice(0, 30) : "direct";
}

function summarise(plays) {
  const themes = ideaThemes();
  const testDevices = new Set(Object.values(plays).filter(p => TEST_LEAD.test(String(((p.run || {}).lead || {}).contact || ""))).map(p => p.device));
  const fams = Object.entries(plays).filter(([id, p]) => {
    const r = p.run || {};
    if (!r.completed) return false;
    if ((r.game || "v1") !== "v1") return false;
    if (String(p.firstAt || "") < "2026-10-17") return false;
    if (testDevices.has(p.device) || TEST_LEAD.test(String((r.lead || {}).contact || ""))) return false;
    return true;
  }).map(([id, p]) => p.run);

  const segs = {};
  function add(seg, who, ideaId, vote) {
    const s = segs[seg] = segs[seg] || { fams: new Set(), th: {}, id: {}, all: [0, 0] };
    const yes = vote === "love" || vote === "book" ? 1 : 0;
    const t = themes[ideaId] || "?";
    (s.th[t] = s.th[t] || [0, 0]); s.th[t][0] += yes; s.th[t][1]++;
    (s.id[ideaId] = s.id[ideaId] || [0, 0]); s.id[ideaId][0] += yes; s.id[ideaId][1]++;
    s.all[0] += yes; s.all[1]++;
    s.fams.add(who.fam);
  }
  fams.forEach((r, i) => {
    const keys = ["all"];
    (Array.isArray(r.ages) ? r.ages : []).forEach(a => keys.push("age:" + a));
    keys.push("city:" + (r.city || "unknown"));
    keys.push("mode:" + (r.mode || "unknown"));
    keys.push("src:" + source(r.utm));
    keys.push("kids:" + (Array.isArray(r.ages) ? r.ages.length : 0));
    for (const [who, pl] of Object.entries(r.players || {})) {
      for (const [ideaId, vote] of Object.entries((pl || {}).votes || {})) {
        for (const k of keys) add(k, { fam: i }, ideaId, vote);
        add("player:" + who, { fam: i }, ideaId, vote);
      }
    }
    if (!Object.keys(r.players || {}).length) for (const k of keys) { const s = segs[k] = segs[k] || { fams: new Set(), th: {}, id: {}, all: [0, 0] }; s.fams.add(i); }
  });
  const out = [];
  for (const [k, s] of Object.entries(segs)) {
    const th = Object.entries(s.th).map(([t, v]) => t + ":" + v[0] + "/" + v[1]).join(" ");
    const id = Object.entries(s.id).map(([t, v]) => t + ":" + v[0] + "/" + v[1]).join(" ");
    out.push({ seg: k, n: s.fams.size, yes: s.all[0] + "/" + s.all[1], th, id });
  }
  return { families: fams.length, segments: out.sort((a, b) => a.seg.localeCompare(b.seg)) };
}

module.exports = { summarise, source };
