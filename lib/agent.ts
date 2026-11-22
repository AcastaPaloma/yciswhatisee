import { extractRole } from "./extract";
import { newRoom, criterionScore } from "./panel";
import { stopAll } from "./simulate";
import * as ploid from "./ploid";
import { log, save, sleep } from "./store";
import type { Candidate, Job } from "./types";

// The hiring agent: owns the loop from job posting to signed offer.
// Outreach and replies are simulated for the demo; sourcing goes through the
// Ploid API (mock or live), interviews through ElevenLabs.

export const PANEL_SIZE = Number(process.env.PANEL_SIZE ?? 3);
const SHORTLIST = 5;
const PACE = Number(process.env.AGENT_PACE_MS ?? 700); // so the activity feed is watchable

const shortId = (personId: string) => personId.replace(/^person_/, "").split("_")[0];

function slotLabels() {
  const fmt = (d: Date, day: string) =>
    `${day} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })} ET`;
  const now = new Date();
  const base = new Date(Math.ceil((now.getTime() + 10 * 60_000) / (30 * 60_000)) * 30 * 60_000);
  const plus = (m: number) => new Date(base.getTime() + m * 60_000);
  const tomorrow = (h: number) => {
    const d = new Date(now.getTime() + 864e5);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  return {
    shared: fmt(base, "Today"),
    later: fmt(plus(60), "Today"),
    other: fmt(plus(150), "Today"),
    tmrwAm: fmt(tomorrow(10), "Tomorrow"),
    tmrwPm: fmt(tomorrow(16), "Tomorrow"),
  };
}

async function toCandidate(job: Job, r: ploid.SearchResult): Promise<Candidate> {
  const p = r.person;
  const [report, email] = await Promise.all([ploid.person(p.person_id).catch(() => null), ploid.enrich(p.person_id).catch(() => null)]);
  const summary = report?.summary ?? "";
  const highlights = summary.split(/(?<=\.)\s+/).filter((s) => /\d|led|built|shipped|founding|designed|grew|won|wrote/i.test(s) && !/^Limitations/.test(s)).slice(0, 4);
  return {
    id: shortId(p.person_id),
    personId: p.person_id,
    name: p.name ?? "Unknown",
    title: p.title ?? "",
    company: p.company ?? "",
    location: p.location ?? "",
    linkedinUrl: p.linkedin_url ?? "",
    matchReasons: (r.verification ?? []).map((v) => v.reasoning.replace(/^Public profile evidence supports this: /, "")),
    background: summary,
    highlights,
    interests: (report?.signals.personal_interests ?? []).map((i) => i.interest),
    email: email ?? undefined,
    status: "shortlisted",
  };
}

function draftEmail(job: Job, c: Candidate, slots: ReturnType<typeof slotLabels>) {
  const role = job.role!;
  const first = c.name.split(" ")[0];
  const hook = c.highlights[0] ? ` I read that you ${c.highlights[0].replace(/^[A-Z]/, (m) => m.toLowerCase()).replace(/\.$/, "")}, which is exactly the kind of work we need.` : "";
  const interest = c.interests[0] ? ` (Also, fellow ${c.interests[0].toLowerCase()} fan here.)` : "";
  return {
    subject: `${role.title} at ${role.company}: 15-minute voice interview?`,
    body: `Hi ${first},\n\nI'm the hiring agent for ${role.company}. We're hiring a ${role.title}.${hook}${interest}\n\nWe run a short, AI-led voice interview so you hear back the same day. Would any of these work?\n- ${slots.shared}\n- ${slots.later}\n- ${slots.tmrwAm}\n\nBest,\nThe ${role.company} hiring agent`,
  };
}

// Deterministic simulated replies: most accept the shared slot, one declines, one can't make it.
function simulateReply(i: number, c: Candidate, slots: ReturnType<typeof slotLabels>) {
  const first = c.name.split(" ")[0];
  const pattern = ["accept", "decline", "accept", "no_overlap", "accept", "accept", "accept"][i % 7];
  if (pattern === "decline") return { status: "declined" as const, availability: [], reply: `Thanks for reaching out! I'm happy where I am right now, but keep me in mind next year. — ${first}` };
  if (pattern === "no_overlap") return { status: "no_overlap" as const, availability: [slots.tmrwPm], reply: `Sounds interesting. I'm traveling today; the only time I have is ${slots.tmrwPm}. — ${first}` };
  const avail = i % 2 ? [slots.shared, slots.tmrwAm] : [slots.shared, slots.later];
  return { status: "accepted" as const, availability: avail, reply: `Hi! Yes, I'd love to chat. ${avail.join(" or ")} works for me. — ${first}` };
}

export async function runHiring(job: Job) {
  if (job.busy) return;
  job.busy = true;
  try {
    // 1. Understand the role
    if (!job.role) {
      log(job, "think", "Reading the job posting and extracting what the role needs");
      const { role, note } = await extractRole(job.jd);
      job.role = role;
      if (note) log(job, "error", note);
      log(job, "tool", `Extracted ${role.criteria.length} interview criteria for ${role.title}`, role.criteria.map((c) => `${c.id}. ${c.name}: ${c.description}`).join("\n"));
      await sleep(PACE);
    }
    const role = job.role!;

    // 2. Source from Ploid
    job.stage = "sourcing";
    log(job, "think", `Searching the Ploid people index for "${role.searchQuery}", verified against the top criteria`);
    const attempts = [
      { type: "auto", criteria: role.criteria.slice(0, 2).map((c) => c.description) },
      { type: "auto", criteria: role.criteria.slice(0, 1).map((c) => c.description) },
      { type: "fast", criteria: [] as string[] },
    ];
    let results: ploid.SearchResult[] = [];
    for (const [i, a] of attempts.entries()) {
      const exclude = role.company && role.company !== "our team" ? { filters: { company: { none_of: [role.company] } } } : {}; // don't poach from ourselves
      const res = await ploid.search({ query: role.searchQuery, type: a.type, num_results: 12, ...exclude, ...(a.criteria.length ? { criteria: a.criteria } : {}) });
      log(job, "tool", `POST /v1/search (${a.type}${a.criteria.length ? `, ${a.criteria.length} verified criteria` : ""}) → ${res.data.results.length} matches from ${res.data.rows_indexed.toLocaleString()} profiles`, `Ploid mode: ${ploid.ploidMode}. Credits used: ${res.meta.credits_charged}.`);
      results = res.data.results;
      if (results.length >= SHORTLIST || i === attempts.length - 1) break;
      log(job, "think", "Too few verified matches. Relaxing the criteria and searching again.");
    }
    if (!results.length) {
      log(job, "error", "No candidates found. Try a broader job posting.");
      job.stage = "draft";
      return;
    }

    log(job, "think", `Researching the top ${Math.min(SHORTLIST, results.length)} candidates (POST /v1/person) and finding their work emails (POST /v1/enrich)`);
    const top = await Promise.all(results.slice(0, SHORTLIST).map((r) => toCandidate(job, r)));
    job.candidates = top;
    job.backups = []; // further matches are researched only if someone declines
    for (const c of top) log(job, "tool", `Shortlisted ${c.name}: ${c.title} at ${c.company}`, c.matchReasons.join("\n") || c.highlights[0]);
    save();
    await sleep(PACE);

    // 3. Outreach (simulated)
    job.stage = "outreach";
    const slots = slotLabels();
    let backupQueue = results.slice(SHORTLIST);
    const contact = async (c: Candidate, i: number) => {
      c.outreach = draftEmail(job, c, slots);
      c.status = "contacted";
      log(job, "email", `Emailed ${c.name} <${c.email ?? "no email found"}>`, `Subject: ${c.outreach.subject}\n\n${c.outreach.body}`);
      await sleep(PACE);
      const r = simulateReply(i, c, slots);
      Object.assign(c, { status: r.status, availability: r.availability, reply: r.reply });
      log(job, "reply", `${c.name} ${r.status === "accepted" ? "accepted" : r.status === "declined" ? "declined" : "can't make the shared time"}`, r.reply);
    };
    for (const [i, c] of job.candidates.entries()) await contact(c, i);

    let accepted = job.candidates.filter((c) => c.status === "accepted");
    let i = job.candidates.length;
    while (accepted.length < PANEL_SIZE && backupQueue.length) {
      log(job, "think", `Only ${accepted.length} of ${PANEL_SIZE} panel seats filled. Reaching out to the next best match.`);
      const next = await toCandidate(job, backupQueue.shift()!);
      job.candidates.push(next);
      await contact(next, i++);
      accepted = job.candidates.filter((c) => c.status === "accepted");
    }

    // 4. Schedule one shared slot, one breakout room per candidate
    const panel = accepted.slice(0, PANEL_SIZE);
    const common = panel.reduce<string[]>((acc, c) => acc.filter((s) => c.availability?.includes(s)), panel[0]?.availability ?? []);
    job.slot = common[0] ?? slots.shared;
    for (const c of panel) {
      c.status = "interviewing";
      job.rooms[c.id] = newRoom(c.id);
    }
    job.stage = "scheduled";
    log(job, "schedule", `Booked a simultaneous panel for ${job.slot}: ${panel.map((c) => c.name).join(", ")}`, `Everyone gets their own breakout room with an ElevenLabs interviewer. The panel orchestrator watches all ${panel.length} rooms live and rewrites the questions as answers come in.`);
  } catch (e) {
    log(job, "error", `Agent error: ${(e as Error).message}`);
  } finally {
    job.busy = false;
    save();
  }
}

// ── decision + offer loop ─────────────────────────────────────────────────
export function rank(job: Job) {
  const criteria = job.role!.criteria;
  return Object.values(job.rooms)
    .map((room) => {
      const perCriterion: Record<string, number> = {};
      for (const c of criteria) {
        const s = criterionScore(room, c.id);
        if (s !== undefined) perCriterion[c.id] = s;
      }
      const vals = criteria.map((c, i) => ({ s: perCriterion[c.id], w: criteria.length - i * 0.5 }));
      const covered = vals.filter((v) => v.s !== undefined);
      const total = covered.length ? covered.reduce((a, v) => a + v.s! * v.w, 0) / vals.reduce((a, v) => a + v.w, 0) : 0; // missing = 0
      return { candidateId: room.candidateId, total: Math.round(total * 100) / 100, perCriterion };
    })
    .sort((a, b) => b.total - a.total);
}

export async function decide(job: Job) {
  if (job.busy) return;
  job.busy = true;
  try {
    job.stage = "deciding";
    stopAll(job.id);
    for (const r of Object.values(job.rooms)) if (r.status !== "ended") r.status = "ended";
    const ranking = rank(job);
    const name = (id: string) => job.candidates.find((c) => c.id === id)!.name;
    const pivotNote = job.pivots.length ? ` ${job.pivots.length} live pivot${job.pivots.length > 1 ? "s" : ""} replaced questions that no longer separated candidates.` : "";
    const summary = ranking.length
      ? `${name(ranking[0].candidateId)} ranks first (${ranking[0].total.toFixed(2)}/5)${ranking[1] ? `, ahead of ${name(ranking[1].candidateId)} (${ranking[1].total.toFixed(2)})` : ""}.${pivotNote}`
      : "No interviews were completed.";
    job.decision = { ranking, summary, offers: [] };
    log(job, "decision", `Panel complete. ${summary}`, ranking.map((r, i) => `${i + 1}. ${name(r.candidateId)}: ${r.total.toFixed(2)}`).join("\n"));
    for (const c of job.candidates) if (c.status === "interviewing") c.status = "interviewed";
    save();
    await sleep(PACE);

    // Keep going until someone signs.
    for (const [i, r] of ranking.entries()) {
      const c = job.candidates.find((x) => x.id === r.candidateId)!;
      c.status = "offered";
      job.decision.offers.push({ candidateId: c.id, outcome: "pending", t: Date.now() });
      log(job, "email", `Sent an offer to ${c.name}`, `Subject: Offer: ${job.role!.title} at ${job.role!.company}\n\nHi ${c.name.split(" ")[0]}, the panel loved talking with you today...`);
      save();
      await sleep(PACE * 2);
      const declines = job.simulateOfferDecline && i === 0;
      job.decision.offers.at(-1)!.outcome = declines ? "declined" : "accepted";
      if (declines) {
        c.status = "offer_declined";
        log(job, "reply", `${c.name} declined the offer (accepted a counter-offer)`, "The agent keeps running: moving to the next-ranked candidate.");
        continue;
      }
      c.status = "hired";
      for (const o of job.candidates) if (o.status === "interviewed") o.status = "not_selected";
      job.stage = "hired";
      log(job, "decision", `${c.name} accepted. Role filled. 🎉`, `Sent friendly closing notes to the other candidates.`);
      return;
    }
    log(job, "think", "Every finalist declined. Going back to sourcing for a new panel.");
  } finally {
    job.busy = false;
    save();
  }
}
