import { json, notFound } from "@/lib/http";
import { getJob, save } from "@/lib/store";

export const dynamic = "force-dynamic";

// Panel updates queued for this room; the browser forwards each one into the
// live call with sendContextualUpdate.
export async function GET(_: Request, { params }: { params: Promise<{ jobId: string; candId: string }> }) {
  const { jobId, candId } = await params;
  const room = getJob(jobId)?.rooms[candId];
  if (!room) return notFound("Room not found");
  const updates = room.pending.slice(room.delivered);
  room.delivered = room.pending.length;
  if (updates.length) save();
  return json({ updates, wrapped: room.wrapped, status: room.status });
}
