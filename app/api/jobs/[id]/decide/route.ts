import { decide } from "@/lib/agent";
import { json, notFound } from "@/lib/http";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return notFound("Job not found");
  if (!Object.keys(job.rooms).length) return json({ error: "No panel scheduled yet" }, 409);
  void decide(job);
  return json({ ok: true });
}
