import { json, notFound } from "@/lib/http";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

// Lightweight room details for the room page before the call starts.
export async function GET(_: Request, { params }: { params: Promise<{ jobId: string; candId: string }> }) {
  const { jobId, candId } = await params;
  const job = getJob(jobId);
  const room = job?.rooms[candId];
  const cand = job?.candidates.find((c) => c.id === candId);
  if (!job || !room || !cand || !job.role) return notFound("Room not found");
  return json({ candidate: { name: cand.name, title: cand.title, company: cand.company }, role: { title: job.role.title, company: job.role.company }, status: room.status });
}
