import Anthropic from "@anthropic-ai/sdk";
import type { Criterion, RoleSpec } from "./types";

// Turns a job posting into a role spec: up to 5 interview criteria, each with an
// opening question and harder "differentiator" questions the panel pivots to
// when every candidate is already strong on that criterion.
//
// Uses Claude when ANTHROPIC_API_KEY is set; otherwise a deterministic parser.

export { SAMPLE_JD } from "./sample";

const CRITERION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "question", "differentiators"],
  properties: {
    name: { type: "string", description: "2-4 word label, e.g. 'Realtime voice'" },
    description: { type: "string", description: "What strong evidence looks like" },
    question: { type: "string", description: "Opening interview question for this criterion, under 30 words" },
    differentiators: { type: "array", items: { type: "string" }, description: "3 harder questions that separate candidates who are all strong on this" },
  },
};

const ROLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "company", "summary", "mustHaves", "niceToHaves", "criteria", "searchQuery"],
  properties: {
    title: { type: "string" },
    company: { type: "string" },
    summary: { type: "string", description: "One sentence on the role" },
    mustHaves: { type: "array", items: { type: "string" } },
    niceToHaves: { type: "array", items: { type: "string" } },
    criteria: { type: "array", items: CRITERION_SCHEMA, description: "3 to 5 criteria, most important first" },
    searchQuery: { type: "string", description: "Short people-search query: role plus 3-5 key skills" },
  },
};

async function extractWithClaude(jd: string): Promise<RoleSpec> {
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ROLE_SCHEMA } },
    system:
      "You turn job postings into structured interview plans for a hiring agent. Criteria must be assessable in a short voice interview. Differentiator questions should force specifics (numbers, failures, tradeoffs) so that several strong candidates can be told apart.",
    messages: [{ role: "user", content: `Job posting:\n\n${jd}` }],
  } as any);
  if ((response as any).stop_reason === "refusal") throw new Error("Claude declined to extract this posting");
  const text = (response.content as any[]).find((b) => b.type === "text")?.text;
  if (!text) throw new Error("No text in Claude response");
  const parsed = JSON.parse(text);
  return {
    ...parsed,
    criteria: (parsed.criteria as Omit<Criterion, "id">[]).slice(0, 5).map((c, i) => ({ ...c, id: `c${i + 1}` })),
    source: "claude",
  };
}

// ── deterministic fallback ────────────────────────────────────────────────
const TECH = ["voice", "speech", "realtime", "audio", "latency", "llm", "agents", "tts", "asr", "streaming", "react", "typescript", "python", "go", "rust", "evals", "tool calling", "design", "figma", "sales", "recruiting", "devrel", "infrastructure", "ml", "machine learning", "healthcare"];

const LEAD = /^(has|have|had|is|are|you|been|experience|experienced|strong|proven|deep|solid|excellent|shipped|built|builds|building|owns|a|an|the)\s+/i;
const BOUNDARY = /^(in|with|who|that|to|for|and|on|at|from)$/i;

function label(bullet: string) {
  let s = bullet.replace(/[.;:]$/, "");
  while (LEAD.test(s)) s = s.replace(LEAD, "");
  const out: string[] = [];
  for (const w of s.split(/\s+/)) {
    if (out.length && BOUNDARY.test(w)) break;
    if (/^(a|an|the|or|of)$/i.test(w)) continue;
    out.push(w.replace(/[,]$/, ""));
    if (out.length === 3) break;
  }
  return out.join(" ").replace(/^\w/, (c) => c.toUpperCase());
}

function heuristicCriterion(bullet: string, i: number): Criterion {
  const lower = label(bullet).toLowerCase();
  return {
    id: `c${i + 1}`,
    name: label(bullet),
    description: bullet,
    question: `Ask for one concrete, recent example that shows: "${bullet}". Ask what their own part was.`,
    differentiators: [
      `Walk me through the hardest failure you've hit on ${lower}, and exactly what you changed afterwards.`,
      `Give me real numbers on ${lower}: what did you measure, and what was the before and after?`,
      `If you had to redo that at ten times the scale, what is the first tradeoff on ${lower} you would make differently, and why?`,
    ],
  };
}

export function extractHeuristic(jd: string): RoleSpec {
  const lines = jd.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines[0] ?? "Open role";
  const [titlePart, companyPart] = head.split(/\s+[—–-]\s+|\s+at\s+|\s+@\s+/);
  const title = titlePart.trim();
  const company = (companyPart ?? "").replace(/\(.*\)/, "").trim() || "our team";

  let section: "must" | "nice" | "do" | "other" = "other";
  const must: string[] = [], nice: string[] = [], other: string[] = [];
  for (const l of lines.slice(1)) {
    const isBullet = /^([-*•·]|\d+[.)])\s+/.test(l);
    if (!isBullet) {
      if (/nice|bonus|plus|preferred/i.test(l)) section = "nice";
      else if (/require|qualif|looking for|you have|must|about you|you are|skills/i.test(l)) section = "must";
      else if (/you.ll do|responsib|the role|what you.ll/i.test(l)) section = "do";
      continue;
    }
    const b = l.replace(/^([-*•·]|\d+[.)])\s+/, "");
    (section === "must" ? must : section === "nice" ? nice : other).push(b);
  }
  const mustHaves = must.length ? must : other;
  const words = jd.toLowerCase();
  const skills = TECH.filter((t) => words.includes(t)).slice(0, 5);
  return {
    title,
    company,
    summary: lines.find((l, i) => i > 0 && !/^[-*•]/.test(l) && l.length > 60) ?? `${title} at ${company}.`,
    mustHaves,
    niceToHaves: nice,
    criteria: mustHaves.slice(0, 5).map(heuristicCriterion),
    searchQuery: `${title} ${skills.join(" ")}`.trim(),
    source: "heuristic",
  };
}

export async function extractRole(jd: string): Promise<{ role: RoleSpec; note?: string }> {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    try {
      return { role: await extractWithClaude(jd) };
    } catch (e) {
      return { role: extractHeuristic(jd), note: `Claude extraction failed (${(e as Error).message.slice(0, 120)}); used the built-in parser.` };
    }
  }
  return { role: extractHeuristic(jd) };
}
