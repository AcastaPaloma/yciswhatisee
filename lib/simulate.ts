import { Conversation } from "@elevenlabs/client";
import { candidateBackground, openingInstruction, recordAssessment } from "./panel";
import { getJob, log, save } from "./store";
import type { Job } from "./types";

// Runs a breakout room with no human: the real interviewer agent (text mode)
// talks to a second ElevenLabs agent that plays the candidate from their Ploid
// profile. Same tool calls, same panel orchestration, same pivots as a voice room.

const STYLES = [
  "Very strong. You give specific numbers, name tradeoffs, and tell the story of failures honestly.",
  "Strong and confident, but you sometimes stay high level and forget to give concrete numbers unless pushed.",
  "Solid and thoughtful, a bit less experienced. You are honest when something was outside your role.",
  "Experienced and articulate; you like to talk about team impact more than technical detail.",
];

type Bridge = { stop: () => void };
const g = globalThis as unknown as { __sims?: Map<string, Bridge> };
const sims = (g.__sims ??= new Map());

async function signedUrl(agentId: string) {
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`signed url ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { signed_url: string }).signed_url;
}

export async function simulateRoom(jobId: string, candidateId: string, index: number) {
  const job = getJob(jobId);
  const room = job?.rooms[candidateId];
  const cand = job?.candidates.find((c) => c.id === candidateId);
  if (!job || !room || !cand || !job.role) throw new Error("Room not found");
  if (room.status === "live" || sims.has(`${jobId}/${candidateId}`)) return;
  const interviewerId = process.env.ELEVENLABS_AGENT_ID;
  const candidateAgentId = process.env.ELEVENLABS_CANDIDATE_AGENT_ID;
  if (!interviewerId || !candidateAgentId) throw new Error("Run npm run setup:agent first");

  const key = `${jobId}/${candidateId}`;
  let interviewer: Conversation | undefined;
  let candidate: Conversation | undefined;
  let finished = false;
  let wrapped = false; // after WRAP_UP: allow one goodbye each way, then hang up
  let afterWrap = 0;
  let pump: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (finished) return;
    finished = true;
    clearInterval(pump);
    sims.delete(key);
    void interviewer?.endSession().catch(() => {});
    void candidate?.endSession().catch(() => {});
  };
  sims.set(key, { stop });
  const say = (role: "agent" | "user", text: string) => {
    room.transcript.push({ role, text, t: Date.now() });
    save();
  };

  try {
    candidate = await Conversation.startSession({
      signedUrl: await signedUrl(candidateAgentId),
      textOnly: true,
      dynamicVariables: {
        candidate_name: cand.name,
        role_title: job.role.title,
        company_name: job.role.company,
        persona: `${cand.background}`.slice(0, 2500),
        style: STYLES[index % STYLES.length],
      },
      onMessage: ({ message, role }) => {
        if (role !== "agent" || !message.trim() || finished) return;
        say("user", message);
        if (wrapped) {
          setTimeout(stop, 1500); // candidate said goodbye; end both sides
          return;
        }
        interviewer?.sendUserMessage(message);
      },
      onDisconnect: () => stop(),
      onError: (e) => console.error("candidate sim error", e),
    });

    interviewer = await Conversation.startSession({
      signedUrl: await signedUrl(interviewerId),
      textOnly: true,
      dynamicVariables: {
        company_name: job.role.company,
        role_title: job.role.title,
        candidate_name: cand.name.split(" ")[0],
        candidate_background: candidateBackground(cand),
        criteria_list: job.role.criteria.map((c) => `${c.id}: ${c.name} — ${c.description}`).join("\n"),
        opening_instruction: openingInstruction(job),
      },
      clientTools: {
        submit_assessment: async (params: Record<string, unknown>) => {
          const instruction = recordAssessment(job, candidateId, params as { criterion_id: string; score: number; evidence: string });
          if (instruction.startsWith("WRAP_UP")) {
            wrapped = true;
            setTimeout(stop, 30_000); // safety net
          }
          return instruction;
        },
      },
      onConnect: ({ conversationId }) => {
        room.status = "live";
        room.conversationId = conversationId;
        if (job.stage === "scheduled") job.stage = "interviewing";
        log(job, "room", `${cand.name} joined their breakout room (simulated candidate)`);
      },
      onMessage: ({ message, role }) => {
        if (role !== "agent" || !message.trim() || finished) return;
        say("agent", message);
        if (wrapped && ++afterWrap > 1) return; // only the first goodbye goes to the candidate
        candidate?.sendUserMessage(message);
      },
      onDisconnect: () => {
        if (room.status === "live") {
          room.status = "ended";
          log(job, "room", `${cand.name}'s interview ended (${room.assessments.length} answers assessed)`);
        }
        stop();
      },
      onError: (e) => console.error("interviewer sim error", e),
    });

    // Forward panel updates into the live interviewer, same as the browser does.
    pump = setInterval(() => {
      const updates = room.pending.slice(room.delivered);
      room.delivered = room.pending.length;
      for (const u of updates) interviewer?.sendContextualUpdate(u);
    }, 1000);
    setTimeout(stop, 8 * 60_000); // hard cap per simulated interview
  } catch (e) {
    stop();
    log(job, "error", `Could not simulate ${cand.name}'s room: ${(e as Error).message}`);
  }
}

export async function simulateAll(job: Job) {
  const waiting = Object.values(job.rooms).filter((r) => r.status === "waiting");
  // Stagger joins slightly so rooms are at different points, like real people.
  await Promise.all(waiting.map((r, i) => new Promise((res) => setTimeout(() => simulateRoom(job.id, r.candidateId, i).then(res, res), i * 2500))));
}

export function stopAll(jobId: string) {
  for (const [k, b] of sims) if (k.startsWith(`${jobId}/`)) b.stop();
}
