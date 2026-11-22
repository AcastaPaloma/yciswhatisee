// Mock Ploid API — same paths and response shapes as https://api.ploid.com,
// backed by the fictional pool in people.mjs. Zero dependencies.
//
//   node mock-ploid/server.mjs            # listens on :4010 (PORT to change)
//
// Point clients at it with PLOID_BASE_URL=http://localhost:4010.
// Any non-empty API key is accepted.
//
// Env:
//   PORT                  default 4010
//   MOCK_LATENCY          "0" disables simulated latency (default on)
//   MOCK_RUN_DELAY_MS     how long a fresh /v1/person run takes (default 4000)
//   MOCK_EMAIL_OVERRIDE   e.g. "you+{slug}@gmail.com" — routes every returned
//                         email to a real inbox for demos ({slug}, {first} supported)

import http from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PEOPLE } from "./people.mjs";

const LATENCY = process.env.MOCK_LATENCY !== "0";
const RUN_DELAY_MS = Number(process.env.MOCK_RUN_DELAY_MS ?? 4000);
const EMAIL_OVERRIDE = process.env.MOCK_EMAIL_OVERRIDE || "";
const ROWS_INDEXED = 2_000_000_000; // the pitch: "query 2B people"

// ── helpers ─────────────────────────────────────────────────────────────────
const reqId = () => "req_" + randomUUID().replace(/-/g, "").slice(0, 24);
const sleep = (ms) => new Promise((r) => setTimeout(r, LATENCY ? ms : 0));
const hash = (s) => parseInt(createHash("sha1").update(s).digest("hex").slice(0, 8), 16);
const ascii = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const OBSERVED = "2026-11-15T12:00:00.000Z";
const FIRST_SEEN = "2025-02-01T00:00:00.000Z";

let acuUsed = 0;
const ACU_INCLUDED = 50;
const remaining = () => Math.max(0, ACU_INCLUDED + 10_000 - acuUsed); // generous mock balance

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}

const STOP = new Set("a an and are as at be been by for from has have in is it its of on or that the this to was were who with will can our we you your at least years year experience strong someone person people looking hire hiring role candidate candidates work working based ideally must should".split(" "));
const SYN = {
  ml: ["machine", "learning"], ai: ["ai", "llm", "machine"], llm: ["llm", "agents"], voice: ["voice", "speech", "tts", "audio"],
  speech: ["speech", "voice", "tts", "asr"], tts: ["tts", "speech", "synthesis"], frontend: ["react", "frontend"], fullstack: ["full", "stack", "react", "node"],
  realtime: ["realtime", "webrtc", "websockets", "streaming"], latency: ["latency", "streaming", "realtime"], design: ["design", "designer", "figma"],
  devrel: ["developer", "relations", "advocate"], recruiter: ["recruiting", "recruiter"], sales: ["sales", "account", "executive"],
};
const stem = (w) => w.replace(/(ing|ers|er|ed|es|s)$/, "") || w;
function tokens(text) {
  const out = [];
  for (const raw of ascii(text || "").split(/[^a-z0-9+#.]+/)) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (!w || w.length < 2 || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return [...new Set(out)];
}

// ── expand compact people into indexed records ─────────────────────────────
const LEVELS = ["entry", "junior", "mid", "senior", "staff", "principal", "director", "vp", "cxo"];
const POS_SENIORITY = { entry: "Specialist", junior: "Specialist", mid: "Specialist", senior: "Senior", staff: "Senior", principal: "Senior", director: "Director", vp: "President/Vice President", cxo: "C-Level" };
const monthsBetween = (a, b) => {
  const [ay, am = 1] = a.split("-").map(Number);
  const [by, bm = 1] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
};

const INDEX = PEOPLE.map((p) => {
  const tag = hash(p.slug).toString(36).slice(0, 3);
  const linkedin_url = `https://www.linkedin.com/in/${p.slug}-${tag}`;
  const person_id = `person_${p.slug.replace(/-/g, "_")}_${tag}`;
  const [first, ...rest] = p.name.split(" ");
  const last = rest.join(" ");
  const text = {
    title: tokens(p.title),
    skills: tokens(p.skills.join(" ")),
    body: tokens([p.bio, ...p.highlights, p.industry, p.company, ...p.oss.map((o) => o[2]), ...p.talks.map((t) => t[4])].join(" ")),
  };
  return { ...p, tag, linkedin_url, person_id, first, last, text };
});
// Rarity weights: a word most profiles share ("engineer") counts for little.
const DF = new Map();
for (const p of INDEX) for (const t of new Set([...p.text.title, ...p.text.skills, ...p.text.body])) DF.set(t, (DF.get(t) ?? 0) + 1);
const idf = (t) => Math.log((INDEX.length + 1) / ((DF.get(t) ?? 0) + 0.5));

const byId = new Map(INDEX.map((p) => [p.person_id, p]));
const byLinkedIn = new Map(INDEX.map((p) => [p.linkedin_url.replace(/\/$/, ""), p]));

function findPerson(identifier = {}) {
  if (identifier.person_id) return byId.get(identifier.person_id);
  if (identifier.linkedin_url) {
    const u = identifier.linkedin_url.replace(/[?#].*$/, "").replace(/\/$/, "");
    return byLinkedIn.get(u) ?? INDEX.find((p) => u.endsWith("/in/" + p.slug) || u.endsWith("/in/" + p.slug + "-" + p.tag));
  }
  if (identifier.name) {
    const n = ascii(identifier.name);
    return INDEX.find((p) => ascii(p.name) === n && (!identifier.company_domain || p.domain === identifier.company_domain.toLowerCase())) ??
      INDEX.find((p) => ascii(p.name) === n);
  }
  if (identifier.email) {
    return INDEX.find((p) => contacts(p).work === identifier.email || contacts(p).personal === identifier.email);
  }
}

function contacts(p) {
  const f = ascii(p.first).replace(/[^a-z]/g, "");
  const l = ascii(p.last).replace(/[^a-z]/g, "");
  const h = hash(p.slug);
  const tmpl = (t) => t.replace("{slug}", p.slug).replace("{first}", f);
  return {
    work: EMAIL_OVERRIDE ? tmpl(EMAIL_OVERRIDE) : `${f}.${l}@${p.domain}`,
    personal: h % 10 < 7 ? (EMAIL_OVERRIDE ? tmpl(EMAIL_OVERRIDE) : `${f}${l}${h % 90 + 10}@mail.example`) : null,
    phone: h % 2 === 0 ? `+1-555-01${String(h % 100).padStart(2, "0")}` : null, // 555-01xx is reserved for fiction
  };
}

const positions = (p) => [
  { title: p.title, company: p.company, company_domain: p.domain, company_linkedin_url: `https://www.linkedin.com/company/${p.domain.split(".")[0]}`, company_logo_url: null,
    location: p.location, description: p.highlights[0], started: p.since, ended: null, current: true, duration_months: monthsBetween(p.since, "2026-11"),
    seniority: POS_SENIORITY[p.seniority] ?? null, department: null },
  ...p.prev.map(([title, company, domain, started, ended]) => ({
    title, company, company_domain: domain, company_linkedin_url: `https://www.linkedin.com/company/${domain.split(".")[0]}`, company_logo_url: null,
    location: null, description: null, started, ended, current: false, duration_months: monthsBetween(started, ended), seniority: null, department: null,
  })),
];
const education = (p) => {
  const [school, school_domain, degree, field, s, e] = p.edu;
  return [{ school, school_domain, school_linkedin_url: null, school_logo_url: null, degree: `${degree}, ${field}`, description: null, started_year: s, ended_year: e }];
};
const socials = (p) => ({ linkedin: p.linkedin_url, ...(p.github ? { github: `https://github.com/${p.github}` } : {}) });

// ── filters ─────────────────────────────────────────────────────────────────
const INDEXED_FILTERS = ["title", "company", "location", "seniority", "industry", "company_domain"];
const VERIFIED_FILTERS = ["experience", "education", "company_size"];
const normCo = (s) => ascii(s).replace(/[.,]/g, "").replace(/\b(inc|llc|ltd|corp|co|gmbh|plc)\b/g, "").replace(/\s+/g, " ").trim();
const wordIn = (hay, needle) => new RegExp(`\\b${ascii(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(ascii(hay));

const MATCHERS = {
  title: (p, v) => wordIn(p.title, v) && p.title,
  company: (p, v) => normCo(p.company) === normCo(v) && p.company,
  company_domain: (p, v) => normCo(p.company).replace(/ /g, "") === ascii(v).split(".")[0] && p.company,
  location: (p, v) => v.split(",").map((s) => s.trim()).filter(Boolean).every((part) => wordIn(p.location, part)) && p.location,
  seniority: (p, v) => {
    const lv = ascii(v);
    const ok = p.seniority === lv || (lv === "senior" && /senior|sr\.|manager/i.test(p.title)) || (lv === "director" && /head|director/i.test(p.title)) ||
      (lv === "cxo" && /chief|founder|ceo|cto/i.test(p.title)) || (!LEVELS.includes(lv) && wordIn(p.title, lv));
    return ok && p.seniority;
  },
  industry: (p, v) => ascii(p.industry).includes(ascii(v)) && p.industry,
};

function applyFilter(p, key, spec) {
  const m = MATCHERS[key];
  if (typeof spec === "string") {
    const obs = m(p, spec);
    return obs ? { status: "matched", basis: "indexed_field", observed: obs, matched: spec } : null;
  }
  if (spec.none_of?.some((v) => m(p, v))) return null;
  const anyOf = [...(spec.any_of ?? []), ...(key === "location" ? [...(spec.cities ?? []), ...(spec.countries ?? [])] : [])];
  if (anyOf.length) {
    const hit = anyOf.find((v) => m(p, v));
    return hit ? { status: "matched", basis: "indexed_field", observed: m(p, hit), matched: hit } : null;
  }
  return { status: "matched", basis: "indexed_field", observed: p[key] ?? null, matched: "none_of" };
}

// evidence-verified filters we can actually check from the mock data
function verifiedFilters(filters) {
  const out = [];
  const past = filters.experience?.past_companies?.any_of;
  if (past) out.push({ path: "experience.past_companies", criterion: `Worked at one of: ${past.join(", ")}`,
    check: (p) => { const hit = p.prev.find((x) => past.some((c) => normCo(x[1]).startsWith(normCo(c)))); return hit && `${hit[0]} at ${hit[1]} (${hit[3]} to ${hit[4]})`; } });
  const schools = filters.education?.schools?.any_of;
  if (schools) out.push({ path: "education.schools", criterion: `Attended one of: ${schools.join(", ")}`,
    check: (p) => schools.some((s) => ascii(p.edu[0]).includes(ascii(s))) && `${p.edu[2]} ${p.edu[3]}, ${p.edu[0]}` });
  const co = typeof filters.company === "object" ? filters.company : {};
  if (co.employee_count || filters.company_size) out.push({ path: "company.employee_count", criterion: "Current employer headcount in range", check: (p) => `${p.company} headcount (simulated)` });
  if (co.funding_stage) out.push({ path: "company.funding_stage", criterion: `Current employer stage in ${co.funding_stage.in.join(", ")}`, check: (p) => `${p.company} funding stage (simulated)` });
  return out;
}

// ── /v1/search ──────────────────────────────────────────────────────────────
// One group per query word: the word's stem plus its synonyms, weighted by rarity.
// `boost` > 1 for the role phrase ("product designer" in "product designer for X").
function terms(text, boost = 1) {
  return tokens(text).map((t) => {
    const alts = new Set([t]);
    for (const [k, v] of Object.entries(SYN)) if (stem(k) === t) v.forEach((s) => alts.add(stem(s)));
    return { alts, w: idf(t) * boost };
  });
}
const hit = (g, set) => [...g.alts].some((a) => set.includes(a));

function queryTerms(query, criteria) {
  const [role, ...rest] = query.split(/\b(?:for|with|who|that|at|in|to|having)\b/i);
  return [...terms(role, rest.length ? 2 : 1), ...terms(rest.join(" ")), ...terms(criteria.join(" "))];
}

function scorePerson(p, groups) {
  let s = 0;
  for (const g of groups) {
    if (hit(g, p.text.title)) s += 6 * g.w;
    if (hit(g, p.text.skills)) s += 2 * g.w;
    if (hit(g, p.text.body)) s += 1 * g.w;
  }
  return s;
}

function bestEvidence(p, criterion) {
  const ct = terms(criterion);
  const total = ct.reduce((a, g) => a + g.w, 0) || 1;
  const sentences = [...p.highlights, p.bio, `Skills: ${p.skills.join(", ")}.`, `Currently ${p.title} at ${p.company}.`,
    ...p.prev.map(([t, c, , s, e]) => `Previously ${t} at ${c} (${s} to ${e}).`), ...p.oss.map((o) => o[2]), ...p.talks.map((t) => t[4]),
    `${p.edu[2]} in ${p.edu[3]} from ${p.edu[0]}.`];
  let best = null, bestHits = 0;
  for (const s of sentences) {
    const st = tokens(s);
    const hits = ct.filter((g) => hit(g, st)).reduce((a, g) => a + g.w, 0);
    if (hits > bestHits) { best = s; bestHits = hits; }
  }
  return bestHits ? { quote: best, hits: bestHits, ratio: bestHits / total } : null;
}

async function search(body) {
  const t0 = Date.now();
  const allowed = new Set(["query", "type", "category", "num_results", "offset", "criteria", "async", "webhook_url", "filters", "contents", "freshness"]);
  for (const k of Object.keys(body)) if (!allowed.has(k)) throw new ApiError(422, "validation_failed", `Unknown field: ${k}`);
  const { query = "", type = "auto", category = "people", num_results = 10, offset, criteria = [], filters = {}, contents = {}, freshness } = body;
  if (category !== "people") throw new ApiError(422, "unsupported_category", "Only category 'people' is supported.");
  if (!["instant", "fast", "auto", "deep"].includes(type)) throw new ApiError(422, "validation_failed", "type must be instant, fast, auto or deep.");
  if (body.async || num_results > 150) throw new ApiError(422, "unsupported_request", "Async searches (People Sets) are not simulated by the mock; use num_results <= 150.");
  const verified = type === "auto" || type === "deep";
  if (criteria.length > 5) throw new ApiError(422, "too_many_criteria", "At most 5 criteria.");
  if (criteria.length && !verified) throw new ApiError(422, "unsupported_request", "criteria require type auto or deep.");
  if (freshness && !verified) throw new ApiError(422, "unsupported_freshness", "freshness requires type auto or deep.");
  if (offset !== undefined && verified) throw new ApiError(422, "unsupported_pagination", "offset is only supported for instant and fast.");
  for (const k of Object.keys(filters)) {
    if (k === "radius_km" || k === "tenure") throw new ApiError(422, "unsupported_filters", `${k} is not supported.`);
    if (!INDEXED_FILTERS.includes(k) && !VERIFIED_FILTERS.includes(k)) throw new ApiError(422, "unsupported_filters", `Unknown filter: ${k}`);
  }
  const vf = verifiedFilters(filters);
  if (vf.length && !verified) throw new ApiError(422, "unsupported_filters", "Evidence-verified filters need type auto or deep.");
  if (vf.length + criteria.length > 5) throw new ApiError(422, "too_many_criteria", "Criteria plus evidence-verified filters exceed 5.");
  const hasPositive = query.trim() || INDEXED_FILTERS.some((k) => typeof filters[k] === "string" || filters[k]?.any_of);
  if (!hasPositive) throw new ApiError(422, "unsupported_request", "Provide a query or a positive title, company, location, seniority, or industry filter.");

  await sleep({ instant: 120, fast: 350, auto: 1400, deep: 2800 }[type]);

  const qTokens = queryTerms(query, criteria);
  let pool = [];
  let rejected = 0;
  for (const p of INDEX) {
    const filter_match = {};
    let ok = true;
    for (const k of INDEXED_FILTERS) {
      if (filters[k] === undefined) continue;
      const m = applyFilter(p, k, filters[k]);
      if (!m) { ok = false; break; }
      filter_match[k] = verified ? { ...m, basis: "verified_evidence" } : m;
    }
    if (!ok) continue;
    const score = scorePerson(p, qTokens);
    if (query.trim() && score === 0) continue;
    const verification = [];
    if (verified) {
      let pass = true;
      for (const [i, f] of vf.entries()) {
        const obs = f.check(p);
        if (!obs) { pass = false; break; }
        filter_match[f.path] = { status: "matched", basis: "verified_evidence", observed: obs, criterion: f.criterion };
        verification.push({ criterionId: `f${i + 1}`, criterion: f.criterion, status: "satisfied", reasoning: `Profile shows ${obs}.`, references: [{ url: p.linkedin_url, source: "ploid", quote: obs }] });
      }
      for (const [i, c] of criteria.entries()) {
        if (!pass) break;
        const ev = bestEvidence(p, c);
        if (!ev || ev.ratio < 0.34) { pass = false; break; }
        verification.push({ criterionId: `c${i + 1}`, criterion: c, status: "satisfied", reasoning: `Public profile evidence supports this: "${ev.quote}"`, references: [{ url: p.linkedin_url, source: "ploid", quote: ev.quote }] });
      }
      if (!pass) { rejected++; continue; }
    }
    pool.push({ p, score: score + verification.length, filter_match, verification });
  }
  pool.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));

  const start = verified ? 0 : offset ?? 0;
  const page = pool.slice(start, start + num_results);
  const fields = new Set(contents.fields ?? ["name", "linkedin", "title", "company", "location"]);
  const results = page.map(({ p, filter_match, verification }, i) => {
    const rank = page.length === 1 ? 1 : +(1 - i / page.length).toFixed(3);
    const person = {
      person_id: p.person_id, name: p.name, title: p.title, company: p.company, location: p.location, linkedin_url: p.linkedin_url,
      confidence: rank, contact_status: "requires_enrichment", socials: socials(p), identity_verified: false, resolution_source: "ploid",
    };
    if (verified && filters.location) person.location_match = "exact";
    if (fields.has("photo")) person.photo_url = null;
    if (fields.has("positions")) person.positions = positions(p);
    if (fields.has("education")) person.education = education(p);
    const r = { url: p.linkedin_url, title: `${p.name} - ${p.title} at ${p.company}`, score: rank, person };
    if (Object.keys(filter_match).length) r.filter_match = filter_match;
    if (verified) r.verification = verification;
    return r;
  });

  const ms = Date.now() - t0;
  const data = {
    results,
    grounding: verified
      ? { status: "complete", source_counts: { ploid: results.length }, provider_outcomes: { ploid: "completed" }, search_time_ms: ms,
          results: page.map(({ p, verification }) => ({ url: p.linkedin_url, title: `${p.name} - ${p.title}`, snippet: verification.map((v) => v.reasoning).join(" ") || p.highlights[0],
            source: "ploid", observed_at: OBSERVED, person: { name: p.name, title: p.title, company: p.company, location: p.location, linkedin_url: p.linkedin_url, identity_verified: false, resolution_source: "ploid" } })) }
      : { status: "not_needed", results: [], source_counts: {}, provider_outcomes: {}, search_time_ms: 0 },
    search_time_ms: Math.min(ms, 180),
    total_time_ms: ms,
    rows_indexed: ROWS_INDEXED,
    coverage: { has_more: pool.length > start + num_results, candidates_seen: pool.length + rejected, candidates_checked: verified ? pool.length + rejected : pool.length },
    request: { query, type, category: "people", num_results, criteria, interpretation: `People matching: ${query || JSON.stringify(filters)}`,
      notes: ["Served by the mock Ploid API (fictional data)."] },
  };
  if (vf.length) data.request.verified_filters = vf.map((f) => f.path);
  if (verified) {
    data.request.freshness = freshness?.max_age_days !== undefined ? { max_age_days: freshness.max_age_days, source: "request" } : { max_age_days: type === "deep" ? 1.8 : 4.6, source: "default" };
    data.verification = { status: results.length >= num_results ? "complete" : "partial", candidates_checked: pool.length + rejected, search_time_ms: ms };
    if (results.length < num_results) data.verification.rejected = rejected;
  }
  const credits = verified ? Math.max(1, Math.ceil(results.length / 10)) : 1;
  acuUsed += credits;
  const meta = { request_id: reqId(), credits_charged: credits, remaining_credits: remaining() };
  if (!verified && pool.length > start + num_results && start + num_results <= 149) meta.next_offset = start + num_results;
  return { status: 200, body: { data, meta } };
}

// ── /v1/person ──────────────────────────────────────────────────────────────
const RUNS = new Map(); // run_id -> { p, type, include, created, status, request_id }
const ACCESS = new Map(); // person_id -> "standard" | "deep"

function fieldResult(value, kind, p) {
  if (!value) return { value: null, status: "not_found", confidence: null, source: null, last_seen: null, ...(kind === "work_email" ? { employer: null } : {}) };
  const r = { value, status: "found", confidence: kind === "phone" ? "strong" : "verified", source: "contact_network", last_seen: "2026-10-31T00:00:00.000Z" };
  if (kind === "work_email") r.employer = { name: p.company, domain: value.split("@")[1] };
  return r;
}

function personRecord(p, include = []) {
  const c = contacts(p);
  const gh = p.github ? `https://github.com/${p.github}` : null;
  const prov = (url, conf = 0.9) => [{ source: "ploid", source_url: url, first_seen: FIRST_SEEN, last_seen: OBSERVED, confidence: conf }];
  const finding = ([title, url, statement], org = null, period = null) => ({ title, organization: org, period, url, statement, evidence_quote: statement, source_urls: [url], timeframe: period ? "dated" : "undated" });
  const record = {
    person_id: p.person_id,
    summary: [
      `${p.name} is ${/^[AEIOU]/i.test(p.title) ? "an" : "a"} ${p.title} at ${p.company}, based in ${p.location} (current as of the profile observed ${OBSERVED.slice(0, 10)}).`,
      p.bio,
      ...p.highlights,
      p.prev.length ? `Previously: ${p.prev.map(([t, co, , s, e]) => `${t} at ${co} (${s} to ${e})`).join("; ")}.` : "",
      `Education: ${p.edu[2]} in ${p.edu[3]}, ${p.edu[0]} (${p.edu[4]}–${p.edu[5]}).`,
      "Limitations: simulated record from the mock Ploid API; all people and sources are fictional.",
    ].filter(Boolean).join(" "),
    age_range: null,
    identity: { name: p.name, linkedin_url: p.linkedin_url, headline: `${p.title} at ${p.company}`, company: p.company, location: p.location, confidence: 0.96 },
    source_links: [
      { title: `${p.name} | LinkedIn`, url: p.linkedin_url, categories: ["profile", "professional"], status: "found", confidence: 0.97 },
      ...(gh ? [{ title: `${p.github} on GitHub`, url: gh, categories: ["code"], status: "found", confidence: 0.92 }] : []),
      ...p.oss.map(([t, url]) => ({ title: t, url, categories: ["open_source"], status: "found", confidence: 0.9 })),
      ...p.talks.map(([t, , , url]) => ({ title: t, url, categories: ["media"], status: "found", confidence: 0.85 })),
    ],
    professional: {
      current: { headline: p.title, company: p.company, location: p.location },
      history: positions(p).map((x) => ({ title: x.title, company: x.company, period: `${x.started} – ${x.ended ?? "present"}`, location: x.location, confidence: x.current ? 0.95 : 0.88,
        current: x.current, timeframe: "dated", evidence_statement: `LinkedIn lists ${x.title} at ${x.company} from ${x.started}${x.ended ? ` to ${x.ended}` : ""}.` })),
      education: [{ school: p.edu[0], degree: p.edu[2], field_of_study: p.edu[3], period: `${p.edu[4]} – ${p.edu[5]}`, confidence: 0.9, timeframe: "dated", evidence_statement: `LinkedIn lists ${p.edu[2]}, ${p.edu[3]} at ${p.edu[0]}.` }],
      skills: p.skills,
    },
    presence: {
      platforms: [
        { platform: "linkedin", handle: `${p.slug}-${p.tag}`, url: p.linkedin_url, display_name: p.name, bio: `${p.title} at ${p.company}`, avatar_url: null,
          followers: 300 + (hash(p.slug) % 4000), following: null, content_count: null, total_likes: null, verified: null, private: false, last_active: null,
          topics: p.skills.slice(0, 4), recent_activity: [], confidence: 0.97, timeframe: "dated", evidence_statement: "Profile name, employer and location match the identity.", source_urls: [p.linkedin_url] },
        ...(gh ? [{ platform: "github", handle: p.github, url: gh, display_name: p.name, bio: p.bio, avatar_url: null, followers: 20 + (hash(p.github) % 900), following: null,
          content_count: 10 + (hash(p.github) % 80), total_likes: null, verified: null, private: false, last_active: "2026-11-10T00:00:00.000Z", topics: p.skills.slice(0, 3),
          recent_activity: p.oss.map(([t, url, s]) => ({ kind: "repository", url, text: s, published_at: null, media_urls: [], likes: null, stars: null, comments: null, shares: null, views: null })),
          confidence: 0.9, timeframe: "undated", evidence_statement: "GitHub profile links to the LinkedIn profile.", source_urls: [gh] }] : []),
      ],
    },
    signals: {
      interests: p.skills.slice(0, 3).map((s, i) => ({ interest: s, strength: +(0.9 - i * 0.15).toFixed(2), evidence_count: 3 - i, status: "found", source_url: p.linkedin_url })),
      activity_cadence: null,
      affinities: [],
      personal_interests: p.interests.map(([category, interest, quote]) => ({ category, interest, evidence_quote: quote, source_url: p.linkedin_url, source_urls: [p.linkedin_url], timeframe: "undated" })),
      coverage: { professional: { status: "found", evidenceCount: 1 + p.prev.length }, interests: { status: p.interests.length ? "found" : "not_found", evidenceCount: p.interests.length } },
    },
    research: { publications: p.highlights.filter((h) => /paper|author/i.test(h)).map((h) => finding([h, p.linkedin_url, h])), patents: p.highlights.filter((h) => /patent/i.test(h)).map((h) => finding([h, p.linkedin_url, h])) },
    work: { open_source: p.oss.map((o) => finding(o, p.github)) },
    media: { appearances: p.talks.map(([t, org, period, url, s]) => finding([t, url, s], org, period)) },
    provenance: { "identity.headline": prov(p.linkedin_url, 0.95), "identity.location": prov(p.linkedin_url, 0.9), "professional.current": prov(p.linkedin_url, 0.95) },
  };
  if (include.length) {
    record.contact = {};
    if (include.includes("work_email")) record.contact.work_email = fieldResult(c.work, "work_email", p);
    if (include.includes("personal_email")) record.contact.personal_email = fieldResult(c.personal, "personal_email", p);
    if (include.includes("phone")) record.contact.phone = fieldResult(c.phone, "phone", p);
  }
  return record;
}

const CONTACT_PRICE = { work_email: 1, personal_email: 3, phone: 10 };
function personFound(p, type, include, firstAccess) {
  const contactsInc = include.filter((x) => CONTACT_PRICE[x]);
  const record = personRecord(p, contactsInc);
  const billed = [], free = [], not_found = [];
  let acu = 0;
  if (firstAccess) { billed.push(`person.${type}`); acu += type === "deep" ? 25 : 10; } else free.push(`person.${type}`);
  for (const k of contactsInc) {
    if (record.contact[k].status === "found") { billed.push(k); acu += CONTACT_PRICE[k]; } else not_found.push(k);
  }
  acuUsed += acu;
  return { status: 200, body: { data: record, meta: { request_id: reqId(), found: true, stale: false, access_expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
    usage: { acu_used: acu, acu_remaining: remaining(), acu_value_usd: 0.1, billed, free, not_found }, research: { status: "completed", missing_sections: [] } } } };
}

const unsure = (reason = "insufficient_evidence") => ({ status: 200, body: { data: null, meta: { resolution: "unsure", reason,
  message: "The available evidence does not reliably identify one person.", limitations: [], suggested_clues: ["linkedin_url"], request_id: reqId(), found: false, stale: false,
  usage: { acu_used: 0, acu_remaining: remaining(), acu_value_usd: 0.1, billed: [], free: [], not_found: [] } } } });

async function person(body) {
  const { identifier, type = "deep", include = [], goal, anchors, website_url } = body;
  const forms = identifier ? ["person_id", "linkedin_url", "name"].filter((k) => identifier[k]) : [];
  if (forms.length !== 1 || (identifier.name && !identifier.company_domain)) throw new ApiError(422, "identity_required", "Identify the person with exactly one of person_id, linkedin_url, or name plus company_domain.");
  if (!["standard", "deep"].includes(type)) throw new ApiError(422, "validation_failed", "type must be standard or deep.");
  await sleep(250);
  const p = findPerson(identifier);
  if (!p) return unsure();
  const fresh = goal || anchors || website_url;
  const have = ACCESS.get(p.person_id);
  if (!fresh && (have === "deep" || have === type)) return personFound(p, type, include, false);
  const run_id = "run_" + randomUUID().replace(/-/g, "").slice(0, 20);
  RUNS.set(run_id, { p, type, include, created: Date.now(), status: "queued" });
  return { status: 202, body: { data: { run_id, status: "queued", poll_url: `/v1/person/runs/${run_id}` },
    meta: { request_id: reqId(), usage: { acu_used: 0, acu_remaining: remaining(), acu_value_usd: 0.1, billed: [], free: [], not_found: [] } } } };
}

function pollRun(id, method) {
  const run = RUNS.get(id);
  if (!run) throw new ApiError(404, "not_found", "Run not found.");
  const runMeta = () => ({ request_id: reqId(), usage: { acu_used: 0, acu_remaining: remaining(), acu_value_usd: 0.1, billed: [], free: [], not_found: [] } });
  if (method === "DELETE") {
    if (run.status === "completed") throw new ApiError(409, "run_completed", "Run already completed.");
    run.status = "cancelled";
    return { status: 200, body: { data: { run_id: id, status: "cancelled" }, meta: runMeta() } };
  }
  if (run.status === "cancelled") return { status: 200, body: { data: { run_id: id, status: "cancelled" }, meta: runMeta() } };
  const elapsed = Date.now() - run.created;
  if (run.status !== "completed" && elapsed < RUN_DELAY_MS) {
    run.status = elapsed < RUN_DELAY_MS / 4 ? "queued" : "running";
    return { status: 200, body: { data: { run_id: id, status: run.status, poll_url: `/v1/person/runs/${id}` }, meta: runMeta() } };
  }
  const first = run.status !== "completed";
  run.status = "completed";
  if (first) {
    const prev = ACCESS.get(run.p.person_id);
    if (prev !== "deep") ACCESS.set(run.p.person_id, run.type);
  }
  return personFound(run.p, run.type, run.include, first);
}

// ── /v1/enrich ──────────────────────────────────────────────────────────────
async function enrich(body) {
  const { fields } = body;
  if (!Array.isArray(fields) || !fields.length || fields.length > 4 || fields.some((f) => !["work_email", "personal_email", "phone", "linkedin_url"].includes(f)))
    throw new ApiError(422, "validation_failed", "fields must list 1-4 of work_email, personal_email, phone, linkedin_url.");
  const ids = ["linkedin_url", "person_id", "email", "name"].filter((k) => body[k]);
  if (ids.length !== 1 || (body.name && !body.company_domain)) throw new ApiError(422, "identity_required", "Identify the person with exactly one of linkedin_url, person_id, email, or name plus company_domain.");
  if (fields.includes("linkedin_url") && !body.email) throw new ApiError(422, "validation_failed", "linkedin_url needs an email identifier.");
  await sleep(600);
  const p = findPerson(body);
  const c = p ? contacts(p) : {};
  const data = {}, billed = [], not_found = [];
  let acu = 0;
  for (const f of fields) {
    const value = p ? { work_email: c.work, personal_email: c.personal, phone: c.phone, linkedin_url: p.linkedin_url }[f] : null;
    data[f] = fieldResult(value, f, p);
    if (f === "linkedin_url" && value) data[f].source = "linked_profile";
    if (value) { billed.push(f); acu += CONTACT_PRICE[f] ?? 1; } else not_found.push(f);
  }
  acuUsed += acu;
  return { status: 200, body: { data, meta: { request_id: reqId(), warnings: [], usage: { acu_used: acu, acu_remaining: remaining(), acu_value_usd: 0.1, billed, free: [], not_found } } } };
}

// ── account ─────────────────────────────────────────────────────────────────
const budget = () => ({ daily_budget_cents: null, monthly_budget_cents: null, daily_used_cents: acuUsed * 10, monthly_used_cents: acuUsed * 10, daily_remaining_cents: null,
  monthly_remaining_cents: null, daily_reset_at: new Date(Date.now() + 864e5).toISOString().slice(0, 10) + "T00:00:00.000Z", monthly_reset_at: "2026-12-01T00:00:00.000Z" });
const credits = () => ({ status: 200, body: { data: { plan: "PAYG", acu: { included: ACU_INCLUDED, purchased: 10_000, used: acuUsed, available: remaining(), overage: 0 }, acu_value_usd: 0.1,
  api_key_budget: budget() }, meta: { request_id: reqId() } } });

// ── router ──────────────────────────────────────────────────────────────────
export async function route(method, path, headers, body) {
  if (method === "GET" && (path === "/" || path === "/health")) return { status: 200, body: { ok: true, mock: true, people: INDEX.length } };
  if (method === "GET" && path === "/v1/openapi.json") return { status: 302, headers: { location: "https://api.ploid.com/v1/openapi.json" }, body: null };
  const key = (headers.authorization || "").replace(/^Bearer\s+/i, "") || headers["x-api-key"];
  if (!key) throw new ApiError(401, "missing_api_key", "No supported credential header was present.");
  if (method === "POST" && path === "/v1/search") return search(body);
  if (method === "POST" && path === "/v1/person") return person(body);
  const run = path.match(/^\/v1\/person\/runs\/([^/]+)$/);
  if (run && (method === "GET" || method === "DELETE")) return pollRun(run[1], method);
  if (method === "POST" && path === "/v1/enrich") return enrich(body);
  if (method === "GET" && path === "/v1/account/credits") return credits();
  // Mock-only helper so the agent/UI can show who is in the fictional pool.
  if (method === "GET" && path === "/mock/people") return { status: 200, body: { data: INDEX.map((p) => ({ person_id: p.person_id, name: p.name, title: p.title, company: p.company, location: p.location, linkedin_url: p.linkedin_url, ...contacts(p) })) } };
  throw new ApiError(404, "not_found", `${method} ${path} is not simulated by the mock Ploid API.`);
}

export async function handle(method, path, headers = {}, body = {}) {
  try {
    return await route(method, path, headers, body ?? {});
  } catch (e) {
    if (e instanceof ApiError) return { status: e.status, body: { error: { code: e.code, message: e.message, request_id: reqId(), ...e.extra } } };
    console.error(e);
    return { status: 500, body: { error: { code: "internal_error", message: String(e.message || e), request_id: reqId() } } };
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    if (raw) {
      try { body = JSON.parse(raw); } catch {
        res.writeHead(422, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "validation_failed", message: "Body is not valid JSON.", request_id: reqId() } }));
      }
    }
    const out = await handle(req.method, url.pathname, req.headers, body);
    res.writeHead(out.status, { "content-type": "application/json", "access-control-allow-origin": "*", ...(out.headers ?? {}) });
    res.end(out.body === null ? "" : JSON.stringify(out.body));
    console.log(`${req.method} ${url.pathname} → ${out.status}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4010);
  createServer().listen(port, () => console.log(`Mock Ploid API on http://localhost:${port} (${INDEX.length} fictional people)`));
}
