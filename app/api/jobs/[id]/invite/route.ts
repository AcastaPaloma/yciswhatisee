import { invite } from "@/lib/agent";
import { json, notFound } from "@/lib/http";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return notFound("Job not found");
  const { candidateIds } = (await req.json().catch(() => ({}))) as { candidateIds?: string[] };
  void invite(job, Array.isArray(candidateIds) ? candidateIds.map(String) : undefined);
  return json({ ok: true });
}
