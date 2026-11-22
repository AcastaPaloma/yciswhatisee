import { json, notFound } from "@/lib/http";
import { recordAssessment } from "@/lib/panel";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

// Called from the candidate's browser when the ElevenLabs interviewer invokes
// its `submit_assessment` client tool. The returned instruction goes straight
// back to the interviewer's LLM as the tool result.
export async function POST(req: Request, { params }: { params: Promise<{ jobId: string; candId: string }> }) {
  const { jobId, candId } = await params;
  const job = getJob(jobId);
  if (!job?.rooms[candId] || !job.role) return notFound("Room not found");
  const body = (await req.json().catch(() => ({}))) as { criterion_id: string; score: number; evidence: string };
  return json({ instruction: recordAssessment(job, candId, body) });
}
