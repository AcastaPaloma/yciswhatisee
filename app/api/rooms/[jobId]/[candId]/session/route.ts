import { json, notFound } from "@/lib/http";
import { candidateBackground, openingInstruction } from "@/lib/panel";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

// Mints a short-lived ElevenLabs conversation token (the API key never reaches
// the browser) plus the dynamic variables that personalize the interviewer.
export async function GET(_: Request, { params }: { params: Promise<{ jobId: string; candId: string }> }) {
  const { jobId, candId } = await params;
  const job = getJob(jobId);
  const cand = job?.candidates.find((c) => c.id === candId);
  if (!job || !cand || !job.rooms[candId] || !job.role) return notFound("Room not found");
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!agentId || !key) return json({ error: "ELEVENLABS_AGENT_ID / ELEVENLABS_API_KEY not configured. Run npm run setup:agent." }, 500);
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`, { headers: { "xi-api-key": key }, cache: "no-store" });
  if (!res.ok) return json({ error: `ElevenLabs token request failed: ${res.status} ${(await res.text()).slice(0, 200)}` }, 502);
  const { token } = await res.json();
  return json({
    conversationToken: token,
    candidate: { id: cand.id, name: cand.name, title: cand.title, company: cand.company },
    role: { title: job.role.title, company: job.role.company },
    slot: job.slot,
    dynamicVariables: {
      company_name: job.role.company,
      role_title: job.role.title,
      candidate_name: cand.name.split(" ")[0],
      candidate_background: candidateBackground(cand),
      criteria_list: job.role.criteria.map((c) => `${c.id}: ${c.name} — ${c.description}`).join("\n"),
      opening_instruction: openingInstruction(job),
    },
  });
}
