import { invite } from "@/lib/agent";
import { json, notFound } from "@/lib/http";
import { getJob } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return notFound("Job not found");
  void invite(job);
  return json({ ok: true });
}
