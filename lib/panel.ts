import { log, save } from "./store";
import type { Assessment, Candidate, Criterion, Job, Room } from "./types";

// The head-of-panel brain. Every breakout room reports assessments here (via
// the ElevenLabs client tool), and gets its next instruction back. Because all
// rooms run at the same time, the panel can see when a criterion stops
// separating candidates and push a harder, shared tie-breaker into every room.

const STRONG = 4; // score at or above which a candidate counts as "strong"
const MAX_EXTRA = 2; // tie-breaker questions per room beyond the base criteria

export function newRoom(candidateId: string): Room {
  return { candidateId, status: "waiting", transcript: [], assessments: [], pending: [], delivered: 0, tieBreakersAsked: [], questionCount: 0, wrapped: false };
}

const crit = (job: Job, id: string) => job.role!.criteria.find((c) => c.id === id);
const cand = (job: Job, id: string) => job.candidates.find((c) => c.id === id)!;
const panelRooms = (job: Job) => Object.values(job.rooms);
const activeRooms = (job: Job) => panelRooms(job).filter((r) => r.status !== "waiting");

function baseScore(room: Room, criterionId: string) {
  return room.assessments.find((a) => a.criterionId === criterionId && !a.tieBreaker)?.score;
}
function tieScore(room: Room, criterionId: string) {
  return room.assessments.filter((a) => a.criterionId === criterionId && a.tieBreaker).at(-1)?.score;
}

/** Combined score for one criterion: a tie-breaker answer counts double. */
export function criterionScore(room: Room, criterionId: string) {
  const b = baseScore(room, criterionId);
  const t = tieScore(room, criterionId);
  if (b === undefined) return t;
  if (t === undefined) return b;
  return Math.round(((b + 2 * t) / 3) * 10) / 10;
}

function questionFor(c: Criterion) {
  return `Next, assess ${c.id} (${c.name}). ${c.question}`;
}

function tieBreakerQuestion(job: Job, c: Criterion) {
  const idx = job.pivots.filter((p) => p.criterionId === c.id).length;
  return c.differentiators[idx % c.differentiators.length];
}

function pivotInstruction(c: Criterion, question: string) {
  return `PIVOT: every candidate so far is already strong on ${c.id} (${c.name}), so the basic question no longer separates them. Ask this harder, distinguishing question and assess the answer as ${c.id}: "${question}"`;
}

export function openingInstruction(job: Job) {
  return questionFor(job.role!.criteria[0]);
}

/** Decide what this room should ask next. */
function nextInstruction(job: Job, room: Room): string {
  const criteria = job.role!.criteria;
  // 1. A shared tie-breaker this candidate hasn't answered yet (only after they did the base question).
  //    Rooms that were sent it as a mid-call PANEL UPDATE get it again here once, since a tool reply is
  //    followed far more reliably than a contextual update.
  room.tieReminded ??= [];
  for (const p of job.pivots) {
    if (baseScore(room, p.criterionId) === undefined || tieScore(room, p.criterionId) !== undefined) continue;
    if (room.tieBreakersAsked.includes(p.criterionId) && room.tieReminded.includes(p.criterionId)) continue;
    if (!room.tieBreakersAsked.includes(p.criterionId)) room.tieBreakersAsked.push(p.criterionId);
    room.tieReminded.push(p.criterionId);
    return pivotInstruction(crit(job, p.criterionId)!, p.question);
  }
  // 2. Next base criterion. Saturated criteria (everyone strong) go straight to the tie-breaker.
  for (const c of criteria) {
    if (baseScore(room, c.id) !== undefined) continue;
    const pivot = job.pivots.find((p) => p.criterionId === c.id);
    if (pivot) {
      room.tieBreakersAsked.push(c.id);
      room.tieReminded!.push(c.id); // this answer stands in for both the base and the tie-breaker
      return `Skip the basic question on ${c.id}; the panel already knows strong candidates pass it. ` + pivotInstruction(c, pivot.question);
    }
    return questionFor(c);
  }
  // 3. Everything covered: spend the remaining time where candidates are closest together.
  if (room.tieBreakersAsked.length < MAX_EXTRA) {
    const closest = criteria
      .filter((c) => !room.tieBreakersAsked.includes(c.id))
      .map((c) => {
        const scores = activeRooms(job).map((r) => criterionScore(r, c.id)).filter((s): s is number => s !== undefined);
        return { c, spread: scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 9 };
      })
      .sort((a, b) => a.spread - b.spread)[0];
    if (closest && closest.spread <= 1) {
      room.tieBreakersAsked.push(closest.c.id);
      return `Candidates are close on ${closest.c.id} (${closest.c.name}). ` + pivotInstruction(closest.c, tieBreakerQuestion(job, closest.c));
    }
  }
  room.wrapped = true;
  return "WRAP_UP: you have covered everything the panel needs. Thank the candidate warmly, tell them the team will follow up today, and say goodbye.";
}

/** Look across every room: is any criterion no longer separating candidates? */
function detectSaturation(job: Job, criterionId: string, triggeredBy: string) {
  if (job.pivots.some((p) => p.criterionId === criterionId)) return;
  const rooms = activeRooms(job);
  const scored = rooms.map((r) => ({ r, s: baseScore(r, criterionId) })).filter((x): x is { r: Room; s: number } => x.s !== undefined);
  const needed = Math.min(2, rooms.length);
  if (scored.length < needed || needed < 2) return;
  if (!scored.every((x) => x.s >= STRONG)) {
    const spread = Math.max(...scored.map((x) => x.s)) - Math.min(...scored.map((x) => x.s));
    if (spread >= 2 && scored.length === rooms.length)
      log(job, "insight", `${crit(job, criterionId)!.name} is separating candidates (spread of ${spread} points). No pivot needed.`);
    return;
  }
  const c = crit(job, criterionId)!;
  const question = tieBreakerQuestion(job, c);
  const who = scored.map((x) => `${cand(job, x.r.candidateId).name.split(" ")[0]} ${x.s}/5`).join(", ");
  const reason = `${scored.length} of ${rooms.length} candidates scored ${STRONG}+ on ${c.name} (${who}). That question no longer tells them apart.`;
  job.pivots.push({ t: Date.now(), criterionId, reason, question });
  log(job, "pivot", `Pivot on ${c.name}: every candidate so far is strong, so a tie-breaker goes into all rooms`, `${reason}\nNew question: "${question}"`);
  for (const r of rooms) {
    if (r.status !== "live" || r.wrapped || r.candidateId === triggeredBy) continue; // the triggering room gets it in its tool reply
    // Rooms that haven't reached this criterion get the tie-breaker in their tool reply when they do.
    if (baseScore(r, criterionId) === undefined || r.tieBreakersAsked.includes(criterionId)) continue;
    r.pending.push(`PANEL UPDATE: all candidates so far are strong on ${c.name}. Before moving on, ask this distinguishing question and assess it as ${c.id}: "${question}"`);
    r.tieBreakersAsked.push(criterionId);
  }
}

/** After tie-breaker answers come in: did the harder question split the candidates? */
function checkSeparation(job: Job, criterionId: string) {
  const pivot = job.pivots.find((p) => p.criterionId === criterionId);
  if (!pivot || pivot.separated) return;
  const scored = activeRooms(job).map((r) => ({ r, s: tieScore(r, criterionId) })).filter((x): x is { r: Room; s: number } => x.s !== undefined);
  if (scored.length < 2) return;
  const spread = Math.max(...scored.map((x) => x.s)) - Math.min(...scored.map((x) => x.s));
  if (spread < 2) return;
  pivot.separated = true;
  const who = scored.sort((a, b) => b.s - a.s).map((x) => `${cand(job, x.r.candidateId).name.split(" ")[0]} ${x.s}/5`).join(", ");
  log(job, "insight", `The tie-breaker on ${crit(job, criterionId)!.name} separated the candidates: ${who}`);
}

export function recordAssessment(job: Job, candidateId: string, a: { criterion_id: string; score: number; evidence: string }) {
  const room = job.rooms[candidateId];
  if (!room) return "WRAP_UP: this room is not part of the panel.";
  const c = crit(job, a.criterion_id) ?? job.role!.criteria.find((x) => x.name.toLowerCase() === String(a.criterion_id).toLowerCase());
  if (!c) return `Unknown criterion id "${a.criterion_id}". Use one of: ${job.role!.criteria.map((x) => x.id).join(", ")}. ` + nextInstruction(job, room);
  const score = Math.max(1, Math.min(5, Math.round(Number(a.score) || 1)));
  const hasBase = baseScore(room, c.id) !== undefined;
  const isTie = hasBase && room.tieBreakersAsked.includes(c.id);
  const entry: Assessment = { criterionId: c.id, score, evidence: String(a.evidence ?? "").slice(0, 400), t: Date.now(), tieBreaker: isTie };
  if (hasBase && !isTie) {
    // The interviewer re-scored after a follow-up: replace the base score.
    const i = room.assessments.findIndex((x) => x.criterionId === c.id && !x.tieBreaker);
    room.assessments[i] = entry;
    log(job, "room", `${cand(job, candidateId).name}: ${c.name} revised to ${score}/5 after a follow-up`, entry.evidence);
    detectSaturation(job, c.id, candidateId);
    const next = nextInstruction(job, room);
    room.lastInstruction = next;
    save();
    return next;
  }
  room.assessments.push(entry);
  room.questionCount++;
  log(job, "room", `${cand(job, candidateId).name}: ${c.name} ${isTie ? "tie-breaker " : ""}${score}/5`, entry.evidence);
  if (!isTie) detectSaturation(job, c.id, candidateId);
  else checkSeparation(job, c.id);
  const next = nextInstruction(job, room);
  room.lastInstruction = next;
  save();
  return next;
}

export function candidateBackground(c: Candidate) {
  return `${c.title} at ${c.company} (${c.location}). ${c.highlights.slice(0, 3).join(" ")}`;
}
