import { runSourcing } from "@/lib/agent";
import { json } from "@/lib/http";
import { latestJob, save, store } from "@/lib/store";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const job = latestJob();
  return json({ id: job?.id ?? null });
}

export async function POST(req: Request) {
  const { jd } = (await req.json().catch(() => ({}))) as { jd?: string };
  if (!jd || jd.trim().length < 40) return json({ error: "Paste a job posting (at least a few lines)." }, 422);
  const job: Job = {
    id: Math.random().toString(36).slice(2, 8), createdAt: Date.now(), jd: jd.trim(), stage: "draft", candidates: [], backups: [],
    log: [], rooms: {}, pivots: [], simulateOfferDecline: false, busy: false, startedAt: Date.now(),
  };
  store.jobs.set(job.id, job);
  save();
  void runSourcing(job); // the agent keeps working after this request returns
  return json({ id: job.id }, 201);
}
