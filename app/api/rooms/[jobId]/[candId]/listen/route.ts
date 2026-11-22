import { json, notFound } from "@/lib/http";
import { getJob, save } from "@/lib/store";

export const dynamic = "force-dynamic";

// Marks a room as being listened to: simulated rooms then pace themselves at
// speaking speed so the audio keeps up with the conversation.
export async function POST(req: Request, { params }: { params: Promise<{ jobId: string; candId: string }> }) {
  const { jobId, candId } = await params;
  const job = getJob(jobId);
  if (!job?.rooms[candId]) return notFound("Room not found");
  const { on } = (await req.json().catch(() => ({}))) as { on?: boolean };
  for (const r of Object.values(job.rooms)) r.listening = false; // one room at a time
  job.rooms[candId].listening = !!on;
  save();
  return json({ ok: true });
}
