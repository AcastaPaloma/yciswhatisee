import { json, notFound } from "@/lib/http";
import { getJob, log, save } from "@/lib/store";
import { stripTags } from "@/lib/text";

export const dynamic = "force-dynamic";

// The last question in an agent message, for the dashboard's "now asking" line.
function lastQuestion(text: string) {
  const parts = text.split(/(?<=[.!?])\s+/).filter((p) => p.includes("?"));
  return (parts.at(-1) ?? text).trim();
}

type Body = { type: "status"; status: "live" | "ended"; conversationId?: string } | { type: "message"; role: "agent" | "user"; text: string };

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string; candId: string }> }) {
  const { jobId, candId } = await params;
  const job = getJob(jobId);
  const room = job?.rooms[candId];
  const cand = job?.candidates.find((c) => c.id === candId);
  if (!job || !room || !cand) return notFound("Room not found");
  const body = (await req.json()) as Body;
  if (body.type === "status") {
    if (body.status === "live" && room.status !== "live") {
      room.status = "live";
      room.conversationId = body.conversationId ?? room.conversationId;
      if (job.stage === "scheduled") job.stage = "interviewing";
      job.interviewsStartedAt ??= Date.now();
      log(job, "room", `${cand.name} joined their breakout room`);
    } else if (body.status === "ended" && room.status === "live") {
      room.status = "ended";
      log(job, "room", `${cand.name}'s interview ended (${room.assessments.length} answers assessed)`);
    }
  } else if (body.type === "message" && stripTags(body.text ?? "")) {
    body.text = stripTags(body.text);
    room.transcript.push({ role: body.role === "user" ? "user" : "agent", text: body.text.trim().slice(0, 2000), t: Date.now() });
    if (body.role !== "user" && body.text.includes("?")) room.currentQuestion = lastQuestion(body.text);
    save();
  }
  return json({ ok: true });
}
