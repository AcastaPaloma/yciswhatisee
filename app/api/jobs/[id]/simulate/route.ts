import { json, notFound } from "@/lib/http";
import { simulateAll, simulateRoom } from "@/lib/simulate";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

// Fills waiting breakout rooms with simulated candidates (a second ElevenLabs agent).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return notFound("Job not found");
  const { candidateId } = (await req.json().catch(() => ({}))) as { candidateId?: string };
  if (candidateId) {
    const idx = Object.keys(job.rooms).indexOf(candidateId);
    if (idx < 0) return notFound("Room not found");
    void simulateRoom(job.id, candidateId, idx);
  } else void simulateAll(job);
  return json({ ok: true });
}
