import { json, notFound } from "@/lib/http";
import { getJob, save } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  return job ? json(job) : notFound("Job not found");
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = getJob((await params).id);
  if (!job) return notFound("Job not found");
  const body = (await req.json().catch(() => ({}))) as { simulateOfferDecline?: boolean };
  if (typeof body.simulateOfferDecline === "boolean") job.simulateOfferDecline = body.simulateOfferDecline;
  save();
  return json(job);
}
