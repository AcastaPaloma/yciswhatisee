import { extractRole } from "./extract";
import { newRoom, criterionScore } from "./panel";
import { stopAll } from "./simulate";
import * as ploid from "./ploid";
import { log, save, sleep } from "./store";
import type { Candidate, Job } from "./types";

// The hiring agent: owns the loop from job posting to signed offer.
// Sourcing goes through the Ploid API (mock or live), interviews through
// ElevenLabs. Outreach replies and the offer response are simulated.

export const PANEL_SIZE = Number(process.env.PANEL_SIZE ?? 3);
const SHORTLIST = 5;
const INTERVIEW_CRITERIA = Number(process.env.INTERVIEW_CRITERIA ?? 2); // short calls for the demo
const PACE = Number(process.env.AGENT_PACE_MS ?? 600); // so the activity feed is watchable

const shortId = (personId: string) => personId.replace(/^person_/, "").split("_")[0];

async function toCandidate(r: ploid.SearchResult): Promise<Candidate> {
  const p = r.person;
  const [report, email] = await Promise.all([
    ploid.researchEnabled ? ploid.person(p.person_id).catch(() => null) : Promise.resolve(null),
    ploid.enrich(p.person_id).catch(() => null),
  ]);
  // Without a person report (live mode default), build the background from the search result itself.
  const fromSearch = [
    `${p.title ?? ""} at ${p.company ?? ""}.`,
    ...(r.verification ?? []).map((v) => v.reasoning),
    ...(p.positions ?? []).slice(0, 4).map((x) => `${x.title ?? ""} at ${x.company ?? ""} (${x.started ?? "?"} to ${x.ended ?? "present"}). ${x.description ?? ""}`),
  ].join(" ");
  const summary = report?.summary ?? fromSearch;
  const highlights = summary.split(/(?<=\.)\s+/).filter((s) => /\d|led|built|shipped|founding|designed|grew|won|wrote/i.test(s) && !/^Limitations/.test(s)).slice(0, 4);
  return {
    id: shortId(p.person_id),
    personId: p.person_id,
    name: p.name ?? "Unknown",
    title: p.title ?? "",
    company: p.company ?? "",
    location: p.location ?? "",
    linkedinUrl: p.linkedin_url ?? "",
    matchReasons: (r.verification ?? []).map((v) => v.reasoning.replace(/^Public profile evidence supports this: /, "").replace(/^"|"$/g, "")),
    background: summary,
    highlights,
    interests: (report?.signals.personal_interests ?? []).map((i) => i.interest),
    email: email ?? undefined,
    status: "shortlisted",
  };
}

/** Step 1: understand the role and find the top candidates. Stops at the shortlist. */
export async function runSourcing(job: Job) {
  if (job.busy) return;
  job.busy = true;
  job.startedAt ??= Date.now();
  try {
    job.stage = "sourcing";
    log(job, "think", "Reading the hiring requirements");
    const { role, note } = await extractRole(job.jd);
    role.criteria = role.criteria.slice(0, INTERVIEW_CRITERIA);
    job.role = role;
    if (note) log(job, "error", note);
    log(job, "tool", `Extracted what matters: ${role.criteria.map((c) => c.name).join(", ")}`, role.criteria.map((c) => `${c.id}. ${c.name}: ${c.description}`).join("\n"));
    await sleep(PACE);

    log(job, "think", "Searching 2,000,000,000 profiles on Ploid");
    const exclude = role.company && role.company !== "our team" ? { filters: { company: { none_of: [role.company] } } } : {}; // don't poach from ourselves
    const attempts = [
      { type: "auto", criteria: role.criteria.slice(0, 2).map((c) => c.description) },
      { type: "auto", criteria: role.criteria.slice(0, 1).map((c) => c.description) },
      { type: "fast", criteria: [] as string[] },
    ];
    let results: ploid.SearchResult[] = [];
    for (const [i, a] of attempts.entries()) {
      const res = await ploid.search({ query: role.searchQuery, type: a.type, num_results: ploid.isLive ? 6 : 12, contents: { fields: ["name", "linkedin", "title", "company", "location", "positions"] }, ...exclude, ...(a.criteria.length ? { criteria: a.criteria } : {}) });
      log(job, "tool", `Ploid search → ${res.data.results.length} verified matches`, `POST /v1/search (${a.type}${a.criteria.length ? `, ${a.criteria.length} criteria checked against public evidence` : ""}). Mode: ${ploid.ploidMode}.`);
      results = res.data.results;
      if (results.length >= SHORTLIST || i === attempts.length - 1) break;
      log(job, "think", "Too few verified matches. Relaxing one criterion and searching again.");
    }
    if (!results.length) {
      log(job, "error", "No candidates found. Try broader requirements.");
      job.stage = "draft";
      return;
    }
    log(job, "think", `Researching the top ${Math.min(SHORTLIST, results.length)}: work history, evidence, contact details`);
    job.candidates = await Promise.all(results.slice(0, SHORTLIST).map(toCandidate));
    for (const c of job.candidates) log(job, "tool", `Found ${c.name}, ${c.title} at ${c.company}`, c.matchReasons.join("\n") || c.highlights[0]);
    job.stage = "sourced";
  } catch (e) {
    log(job, "error", `Agent error: ${(e as Error).message}`);
    job.stage = "draft";
  } finally {
    job.busy = false;
    save();
  }
}

/** Step 2: invite the chosen candidates (default: the top PANEL_SIZE) and open one breakout room each. */
export async function invite(job: Job, candidateIds?: string[]) {
  if (job.busy || !job.role) return;
  job.busy = true;
  try {
    job.stage = "outreach";
    const chosen = candidateIds?.length ? job.candidates.filter((c) => candidateIds.includes(c.id)) : [];
    const panel = chosen.length ? chosen : job.candidates.slice(0, PANEL_SIZE);
    for (const c of panel) {
      const first = c.name.split(" ")[0];
      const hook = c.highlights[0] ? ` I saw that you ${c.highlights[0].replace(/^[A-Z]/, (m) => m.toLowerCase()).replace(/\.$/, "")}.` : "";
      c.outreach = {
        subject: `${job.role.title} at ${job.role.company}: quick voice interview?`,
        body: `Hi ${first},\n\nI'm the hiring agent for ${job.role.company}.${hook} We're hiring a ${job.role.title} and you're on our shortlist.\n\nWe run a short voice interview with all finalists at the same time, so you hear back today. Join here: [interview link]\n\nThe ${job.role.company} hiring agent`,
      };
      c.status = "contacted";
      log(job, "email", `Invited ${c.name} <${c.email ?? "email not found"}>`, `Subject: ${c.outreach.subject}\n\n${c.outreach.body}`);
      await sleep(PACE / 2);
    }
    await sleep(PACE);
    for (const c of panel) {
      c.status = "interviewing";
      c.reply = "I'm in. Joining now!";
      job.rooms[c.id] = newRoom(c.id);
      log(job, "reply", `${c.name} accepted`, c.reply);
      await sleep(PACE / 2);
    }
    for (const c of job.candidates) if (!panel.includes(c)) c.status = "not_selected";
    job.slot = "Now";
    job.stage = "scheduled";
    log(job, "schedule", `Opened ${panel.length} breakout rooms. Ava will interview everyone at the same time.`, "Each room has its own ElevenLabs interviewer. The panel watches every room and changes the questions as answers come in.");
  } finally {
    job.busy = false;
    save();
  }
}

// ── decision + offer ──────────────────────────────────────────────────────
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
      const total = vals.reduce((a, v) => a + (v.s ?? 0) * v.w, 0) / vals.reduce((a, v) => a + v.w, 0); // unanswered counts as 0
      return { candidateId: room.candidateId, total: Math.round(total * 100) / 100, perCriterion };
    })
    .sort((a, b) => b.total - a.total);
}

/** Step 3: end the interviews and pick the best candidate. */
export async function decide(job: Job) {
  if (job.busy) return;
  job.busy = true;
  try {
    job.stage = "deciding";
    stopAll(job.id);
    for (const r of Object.values(job.rooms)) if (r.status !== "ended") r.status = "ended";
    log(job, "think", "Comparing every answer across all rooms");
    await sleep(PACE * 2);
    const ranking = rank(job);
    const name = (id: string) => job.candidates.find((c) => c.id === id)!.name;
    const best = ranking[0];
    const bestRoom = best ? job.rooms[best.candidateId] : undefined;
    const reasons = (bestRoom?.assessments ?? [])
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((a) => a.evidence)
      .filter(Boolean);
    const elapsedMs = Date.now() - (job.startedAt ?? job.createdAt);
    const interviews = Object.values(job.rooms).filter((r) => r.assessments.length).length || Object.keys(job.rooms).length;
    const parallelMinutes = Math.max(1, Math.round((Date.now() - (job.interviewsStartedAt ?? Date.now())) / 60_000));
    const summary = best
      ? `${name(best.candidateId)} is the strongest fit (${best.total.toFixed(1)}/5)${ranking[1] ? `, ahead of ${name(ranking[1].candidateId)} (${ranking[1].total.toFixed(1)})` : ""}.`
      : "No interviews were completed.";
    job.decision = {
      ranking,
      summary,
      offers: [],
      reasons,
      // Typical funnel: ~45 min per interview + ~30 min scheduling each, done one after another.
      stats: { elapsedMs, interviews, parallelMinutes, sequentialHours: Math.round(interviews * 1.25 * 10) / 10, pivots: job.pivots.length },
    };
    for (const c of job.candidates) if (c.status === "interviewing") c.status = "interviewed";
    job.stage = "decided";
    log(job, "decision", summary, ranking.map((r, i) => `${i + 1}. ${name(r.candidateId)}: ${r.total.toFixed(2)}`).join("\n"));
  } finally {
    job.busy = false;
    save();
  }
}

/** Step 4: send the offer; if it's declined, move down the ranking until someone accepts. */
export async function sendOffer(job: Job) {
  if (job.busy || !job.decision) return;
  job.busy = true;
  try {
    const role = job.role!;
    for (const [i, r] of job.decision.ranking.entries()) {
      const c = job.candidates.find((x) => x.id === r.candidateId)!;
      if (c.status === "offer_declined") continue;
      const letter = `Hi ${c.name.split(" ")[0]},\n\nThe panel loved talking with you today. We'd like to offer you the role of ${role.title} at ${role.company}.\n\nWhat stood out: ${job.decision.reasons[0] ?? "your answers"}\n\nReply to accept and we'll send the paperwork.\n\nThe ${role.company} team`;
      job.decision.offerLetter = letter;
      c.status = "offered";
      job.decision.offers.push({ candidateId: c.id, outcome: "pending", t: Date.now() });
      log(job, "email", `Sent the offer letter to ${c.name}`, letter);
      save();
      await sleep(PACE * 3);
      const declines = job.simulateOfferDecline && i === 0;
      job.decision.offers.at(-1)!.outcome = declines ? "declined" : "accepted";
      if (declines) {
        c.status = "offer_declined";
        log(job, "reply", `${c.name} declined (accepted a counter-offer). Moving to the next candidate.`);
        continue;
      }
      c.status = "hired";
      for (const o of job.candidates) if (o.status === "interviewed") o.status = "not_selected";
      job.stage = "hired";
      log(job, "decision", `${c.name} accepted. Role filled.`);
      return;
    }
    log(job, "think", "Every finalist declined. Going back to sourcing.");
  } finally {
    job.busy = false;
    save();
  }
}
