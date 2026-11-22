// Generates realistic, role-specific fictional candidates when the curated pool
// has too few strong matches for a search. Deterministic: the same query always
// produces the same people. Output uses the compact shape from people.mjs.

const FIRST = ["Amelia", "Rohan", "Sara", "Mateo", "Hana", "Jonah", "Leila", "Theo", "Nina", "Kwame", "Ines", "Ethan", "Mei", "Oscar", "Zara", "Lukas", "Ana", "Dev", "Clara", "Idris", "Maya", "Felipe", "Yara", "Caleb", "Sofia", "Arjun", "Elif", "Marcus", "Ava", "Tobias", "Noor", "Julian", "Priyanka", "Andre", "Lena", "Kofi", "Hiro", "Camille", "Samir", "Freya"];
const LAST = ["Lindqvist", "Patel", "Moreau", "Okonkwo", "Silva", "Nakamura", "Haddad", "Brennan", "Kowalski", "Mensah", "Duarte", "Wei", "Ferreira", "Castillo", "Ahmed", "Novak", "Rossi", "Tanaka", "Osei", "Varga", "Hughes", "Iyer", "Kaplan", "Laurent", "Morales", "Sato", "Abara", "Nguyen", "Holm", "Becker", "Chopra", "Reyes", "Sorensen", "Achebe", "Kim", "Dubois", "Fraser", "Gill", "Petrov", "Yamada"];
const COMPANIES = [
  ["Arcwell", "arcwell.io"], ["Tessellate Labs", "tessellate.ai"], ["Hollow Pine", "hollowpine.com"], ["Lumora", "lumora.ai"], ["Sablefish", "sablefish.io"],
  ["Corvid Systems", "corvidsystems.com"], ["Brightwater Health", "brightwaterhealth.com"], ["Kitewire", "kitewire.io"], ["Mossgrove", "mossgrove.com"],
  ["Halyard", "halyard.dev"], ["Juniper Rail", "juniperrail.com"], ["Pallas Data", "pallasdata.io"], ["Rivulet", "rivulet.ai"], ["Saltmarsh", "saltmarsh.io"],
  ["Tidal Forge", "tidalforge.com"], ["Umbra Audio", "umbraaudio.com"], ["Vantage Loop", "vantageloop.io"], ["Wren Robotics", "wrenrobotics.com"],
  ["Yarrow Health", "yarrowhealth.com"], ["Zephyr Stack", "zephyrstack.dev"], ["Cobalt Harbor", "cobaltharbor.com"], ["Driftwood AI", "driftwood.ai"],
  ["Emberline", "emberline.io"], ["Glasswing", "glasswing.co"], ["Ironbark", "ironbark.io"], ["Larkspur Labs", "larkspurlabs.com"],
];
const LOCATIONS = ["Toronto, Ontario, Canada", "San Francisco, California, United States", "New York, New York, United States", "Waterloo, Ontario, Canada", "Montreal, Quebec, Canada", "Seattle, Washington, United States", "Vancouver, British Columbia, Canada", "Remote, Canada", "Austin, Texas, United States", "Remote, United States"];
const SCHOOLS = [["University of Waterloo", "uwaterloo.ca"], ["University of Toronto", "utoronto.ca"], ["McGill University", "mcgill.ca"], ["UC Berkeley", "berkeley.edu"], ["Georgia Tech", "gatech.edu"], ["University of British Columbia", "ubc.ca"], ["Carnegie Mellon University", "cmu.edu"], ["Rhode Island School of Design", "risd.edu"], ["University of Michigan", "umich.edu"], ["Queen's University", "queensu.ca"]];
const INTERESTS = [["sport", "Trail running", "Most weekends I'm on a trail somewhere with a podcast on."], ["hobby", "Bouldering", "Climbing is how I reset after a long week."], ["food_drink", "Coffee", "I roast my own beans, badly but enthusiastically."], ["hobby", "Film photography", "Shooting 35mm forces me to slow down."], ["books_media", "Science fiction", "Re-reading Le Guin every winter."], ["hobby", "Chess", "Blitz on the subway, every day."], ["sport", "Cycling", "Commuting by bike year-round."], ["cause", "Mentoring", "I mentor first-generation students learning to code."]];

const SENIORITY = /^(senior|sr\.?|staff|principal|lead|founding|head of|junior|jr\.?)\s+/i;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function hashStr(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function roleParts(query) {
  // Leading capitalized words are the job title ("Senior Backend Engineer, Realtime voice ...").
  const words = query.split(/\s+/);
  const title = [];
  for (const w of words) {
    if (!/^[A-Z0-9&(,]/.test(w) && title.length) break;
    title.push(w);
  }
  const full = title.join(" ").replace(/[,\s]+$/, "") || "Software Engineer";
  const [main, spec] = full.split(/\s*,\s*/);
  let core = main;
  while (SENIORITY.test(core)) core = core.replace(SENIORITY, "");
  return { core: core || "Engineer", spec };
}

// Turn a requirement into a first-person-free accomplishment line.
function claim(req, r) {
  let s = req.trim().replace(/\.$/, "");
  s = s.replace(/^(\d+)\+?\s*(years?)/i, (_, n) => `${Number(n) + 1 + Math.floor(r() * 4)} years`);
  s = s.replace(/\b(\d+)\+\s/g, (_, n) => `${Number(n) + 1 + Math.floor(r() * 2)} `);
  s = s.replace(/^has been /i, "Was ").replace(/^(has|have) /i, "");
  s = s.replace(/^strong /i, "Deep experience in ").replace(/^experience (in|with) /i, "Hands-on experience $1 ").replace(/^experience /i, "Hands-on experience ");
  s = s.replace(/^calm under pressure/i, "Stays calm under pressure").replace(/^comfortable /i, "Very comfortable ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function metric(req, r, company) {
  const n = (lo, hi) => Math.round(lo + r() * (hi - lo));
  const t = req.toLowerCase();
  if (/latency|p9\d|real-?time|streaming/.test(t)) return `took p95 from ${n(170, 260)} ms to ${n(55, 95)} ms at ${company}`;
  if (/throughput|scale|performance/.test(t)) return `${(1.8 + r() * 2.5).toFixed(1)}x throughput on the core pipeline at ${company}`;
  if (/incident|outage|on-?call|pressure/.test(t)) return `led ${n(20, 60)}+ incident responses as on-call lead`;
  if (/design system/.test(t)) return `adopted by ${n(3, 7)} product teams`;
  if (/research|customer|interview/.test(t)) return `${n(40, 90)} customer interviews in the last year`;
  if (/figma|prototyp|interaction/.test(t)) return `prototypes tested with ${n(15, 40)} customers before launch`;
  if (/end to end|end-to-end|shipped|launch/.test(t)) return `grew activation ${n(18, 45)}% after launch at ${company}`;
  if (/go\b|rust|distributed|regions|services/.test(t)) return `${n(4, 9)} regions, ${n(20, 80)}k requests per second`;
  if (/sales|revenue|quota|pipeline/.test(t)) return `$${n(800, 2400)}k in new ARR`;
  if (/hire|hiring|team|mentor|lead/.test(t)) return `grew the team from ${n(2, 4)} to ${n(8, 14)}`;
  if (/founding|early|zero to one|0 to 1/.test(t)) return `first ${["engineer", "designer", "hire"][n(0, 2)]} at ${company}, seed to Series A`;
  return `at ${company}`;
}

// Varied, concrete accomplishments per kind of requirement, so candidates don't read alike.
const NOUNS = {
  infra: ["media relay", "streaming ingest path", "WebRTC edge tier", "realtime API gateway", "audio transcoding pipeline", "event bus"],
  product: ["onboarding flow", "admin console", "clinician dashboard", "billing experience", "self-serve setup", "scheduling product"],
};
const HOW = ["moving the hot path to Rust", "batching writes and pinning cores", "replacing the queue with a ring buffer", "adding regional edge nodes", "cutting two network hops"];
function evidenceLine(req, r, company, i, k) {
  const n = (lo, hi) => Math.round(lo + r() * (hi - lo));
  const pick = (a) => a[(i + k) % a.length]; // rotate so neighbours read differently
  const t = req.toLowerCase();
  const infra = pick(NOUNS.infra), prod = pick(NOUNS.product);
  const sets = [
    [/latency|p9\d|real-?time|streaming|throughput/, [
      `Cut p95 on the ${infra} at ${company} from ${n(170, 260)} ms to ${n(55, 95)} ms by ${pick(HOW)}.`,
      `Rebuilt the ${infra} at ${company}; p95 went from ${n(180, 240)} ms to ${n(60, 90)} ms and stayed there.`,
      `Owned the latency budget for the ${infra} and shipped a ${(1.8 + r() * 2.4).toFixed(1)}x throughput gain.`,
      `Led a quarter-long latency push on the ${infra}: ${n(150, 220)} ms down to ${n(70, 99)} ms p95.`]],
    [/incident|outage|on-?call|pressure/, [
      `Ran incident command for ${n(8, 20)} Sev-1s at ${company}, including a ${n(2, 6)}-hour regional outage.`,
      `On-call lead for the ${infra}; wrote the postmortem process the team still uses.`,
      `Kept a ${n(3, 6)}-region failover calm and on script during a major cloud provider outage.`]],
    [/distributed|\bgo\b|rust|services|regions/, [
      `Designed ${n(5, 14)} Go services running across ${n(4, 8)} regions at ${company}.`,
      `Rewrote ${company}'s routing layer in Rust, now serving ${n(30, 90)}k requests per second.`]],
    [/b2b|end to end|end-to-end|shipped|launch|product/, [
      `Took ${company}'s ${prod} from research to launch; activation up ${n(18, 45)}%.`,
      `Led design for a B2B ${prod} end to end, from customer interviews to production.`,
      `Shipped ${company}'s first B2B product as the founding designer.`]],
    [/design system/, [
      `Built ${company}'s design system from scratch; adopted by ${n(3, 7)} product teams.`,
      `Created the component library and tokens used across ${n(3, 6)} products at ${company}.`]],
    [/figma|prototyp|interaction/, [
      `Prototyped the ${prod} in Figma and tested it with ${n(12, 35)} customers before a line of code.`,
      `Known at ${company} for high-fidelity interaction prototypes; shipped ${n(8, 20)} flows last year.`]],
    [/research|customer|interview/, [
      `Runs ${n(40, 90)}+ customer interviews a year and turns them into roadmap decisions.`,
      `Set up ${company}'s research practice: weekly sessions with real customers.`]],
  ];
  for (const [re, lines] of sets) if (re.test(t)) return pick(lines);
  return `${claim(req, r)} (${metric(req, r, company)}).`;
}

/**
 * @param {string} query search query (role title first, then skills)
 * @param {string[]} criteria plain-English requirements every strong candidate should show
 * @param {number} count how many people to create
 * @param {Set<string>} takenSlugs slugs already in the index
 */
export function synthesizeCandidates(query, criteria, count, takenSlugs) {
  const r = rng(hashStr(query + "|" + criteria.join("|")));
  const { core, spec } = roleParts(query);
  const reqs = criteria.length ? criteria : [`${core} experience`];
  const titles = [`Senior ${core}`, `Staff ${core}`, `${core}${spec ? `, ${spec}` : ""}`, `Lead ${core}`, `Senior ${core}${spec ? `, ${spec}` : ""}`, `${core}`];
  const skills = [...new Set(query.toLowerCase().replace(/[^a-z0-9+#\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(senior|staff|lead|founding|the|and|for|with)$/.test(w)))].slice(0, 7);
  const out = [];
  for (let i = 0; out.length < count && i < count * 4; i++) {
    const firstName = FIRST[Math.floor(r() * FIRST.length)];
    const name = `${firstName} ${LAST[Math.floor(r() * LAST.length)]}`;
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
    if (takenSlugs.has(slug) || out.some((o) => o.name.startsWith(firstName + " "))) continue;
    takenSlugs.add(slug);
    const [company, domain] = COMPANIES[Math.floor(r() * COMPANIES.length)];
    const [prevCo, prevDomain] = COMPANIES[Math.floor(r() * COMPANIES.length)];
    const strong = out.length < Math.ceil(count * 0.75); // most candidates meet every requirement; a few only some
    const used = strong ? reqs : reqs.slice(0, 1);
    const evidence = Object.fromEntries(used.map((q, k) => [q, evidenceLine(q, r, company, out.length, k)]));
    const highlights = Object.values(evidence);
    const startYear = 2018 + Math.floor(r() * 5);
    const [school, schoolDomain] = SCHOOLS[Math.floor(r() * SCHOOLS.length)];
    const interest = INTERESTS[Math.floor(r() * INTERESTS.length)];
    out.push({
      slug, name,
      title: titles[out.length % titles.length],
      company, domain,
      location: LOCATIONS[Math.floor(r() * LOCATIONS.length)],
      seniority: /staff|lead/i.test(titles[out.length % titles.length]) ? "staff" : "senior",
      industry: "Software Development",
      since: `${startYear + 2}-0${1 + Math.floor(r() * 8)}`,
      skills,
      bio: `${core} focused on ${skills.slice(0, 3).join(", ") || "shipping"}.`,
      highlights,
      prev: [[`${core}`, prevCo, prevDomain, `${startYear}-0${1 + Math.floor(r() * 8)}`, `${startYear + 2}-0${1 + Math.floor(r() * 8)}`]],
      edu: [school, schoolDomain, /design/i.test(core) ? "BDes" : "BASc", /design/i.test(core) ? "Interaction Design" : "Computer Engineering", startYear - 5, startYear - 1],
      github: /design/i.test(core) ? null : slug.replace(/-/g, ""),
      interests: [interest],
      evidence, // criterion text → the line that proves it (used by search verification)
      oss: [],
      talks: [],
    });
  }
  return out;
}
