"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Candidate, Job, LogEntry, Room } from "@/lib/types";
import { SAMPLE_JD } from "@/lib/sample";

const STAGES: { key: Job["stage"][]; label: string }[] = [
  { key: ["draft"], label: "Role" },
  { key: ["sourcing"], label: "Source" },
  { key: ["outreach"], label: "Outreach" },
  { key: ["scheduled"], label: "Schedule" },
  { key: ["interviewing"], label: "Interview" },
  { key: ["deciding"], label: "Decide" },
  { key: ["hired"], label: "Hired" },
];

const KIND_STYLE: Record<LogEntry["kind"], string> = {
  think: "text-neutral-400",
  tool: "text-sky-300",
  email: "text-amber-200",
  reply: "text-amber-300",
  schedule: "text-emerald-300",
  room: "text-neutral-300",
  pivot: "text-fuchsia-300",
  insight: "text-violet-300",
  decision: "text-emerald-300",
  error: "text-rose-400",
};
const KIND_ICON: Record<LogEntry["kind"], string> = {
  think: "◦", tool: "⚙", email: "✉", reply: "↩", schedule: "◷", room: "●", pivot: "⇄", insight: "◆", decision: "★", error: "!",
};

const STATUS_STYLE: Partial<Record<Candidate["status"], string>> = {
  accepted: "bg-emerald-500/15 text-emerald-300",
  interviewing: "bg-indigo-500/20 text-indigo-200",
  interviewed: "bg-indigo-500/10 text-indigo-300",
  declined: "bg-neutral-800 text-neutral-500",
  no_overlap: "bg-neutral-800 text-neutral-500",
  offered: "bg-amber-500/20 text-amber-200",
  offer_declined: "bg-rose-500/15 text-rose-300",
  hired: "bg-emerald-500 text-neutral-950",
  not_selected: "bg-neutral-800 text-neutral-500",
};

function scoreColor(s?: number) {
  if (s === undefined) return "bg-neutral-900 text-neutral-600";
  if (s >= 4.5) return "bg-emerald-500 text-neutral-950";
  if (s >= 4) return "bg-emerald-600/70 text-white";
  if (s >= 3) return "bg-amber-500/70 text-neutral-950";
  return "bg-rose-600/70 text-white";
}

export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jd, setJd] = useState(SAMPLE_JD);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    const fromUrl = new URLSearchParams(window.location.search).get("job");
    if (fromUrl) setJobId(fromUrl);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok && alive) setJob(await res.json());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [jobId]);

  const start = async () => {
    setError(null);
    const res = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jd }) });
    const data = await res.json();
    if (!res.ok) return setError(data.error);
    setJobId(data.id);
    window.history.replaceState(null, "", `/?job=${data.id}`);
  };

  const resume = async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    const { id } = await res.json();
    if (id) {
      setJobId(id);
      window.history.replaceState(null, "", `/?job=${id}`);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-900 px-8 py-5 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-xl font-semibold tracking-tight">Panel</span>
          <span className="text-sm text-neutral-500">The hiring agent that interviews every finalist at once</span>
        </div>
        {job && (
          <button onClick={() => { setJob(null); setJobId(null); window.history.replaceState(null, "", "/"); }} className="text-sm text-neutral-500 hover:text-neutral-300">
            New role
          </button>
        )}
      </header>

      {!jobId ? (
        <Intake jd={jd} setJd={setJd} start={start} resume={resume} error={error} />
      ) : !job ? (
        <p className="p-8 text-neutral-500">Loading…</p>
      ) : (
        <Dashboard job={job} origin={origin} />
      )}
    </main>
  );
}

function Intake({ jd, setJd, start, resume, error }: { jd: string; setJd: (s: string) => void; start: () => void; resume: () => void; error: string | null }) {
  return (
    <section className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Paste a job posting. Get a hire.</h1>
      <p className="mt-3 text-neutral-400">
        Panel extracts what the role needs, searches 2 billion profiles on Ploid, reaches out, books every finalist into the same slot, and interviews them all at
        once in voice breakout rooms. Because the rooms run at the same time, it rewrites questions the moment one stops telling candidates apart.
      </p>
      <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={16} className="mt-8 w-full rounded-xl border border-neutral-800 bg-neutral-900 p-4 font-mono text-sm text-neutral-200 focus:border-neutral-600 focus:outline-none" />
      <div className="mt-4 flex items-center gap-4">
        <button onClick={start} className="rounded-full bg-white px-6 py-3 font-medium text-neutral-950 hover:bg-neutral-200">Start hiring</button>
        <button onClick={resume} className="text-sm text-neutral-500 hover:text-neutral-300">Resume last run</button>
        {error && <span className="text-sm text-rose-400">{error}</span>}
      </div>
    </section>
  );
}

function Dashboard({ job, origin }: { job: Job; origin: string }) {
  const stageIdx = STAGES.findIndex((s) => s.key.includes(job.stage));
  const rooms = Object.values(job.rooms);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-0">
      <div className="px-8 py-6 space-y-8 min-w-0">
        <ol className="flex flex-wrap gap-2">
          {STAGES.map((s, i) => (
            <li key={s.label} className={`rounded-full px-3 py-1 text-xs ${i < stageIdx ? "bg-neutral-800 text-neutral-300" : i === stageIdx ? "bg-white text-neutral-950 font-medium" : "bg-neutral-900 text-neutral-600"}`}>
              {i + 1}. {s.label}
            </li>
          ))}
          {job.busy && <li className="px-3 py-1 text-xs text-neutral-500 animate-pulse">agent working…</li>}
        </ol>

        {job.role && <RoleCard job={job} />}
        {rooms.length > 0 && <LivePanel job={job} origin={origin} />}
        {job.candidates.length > 0 && <Candidates job={job} />}
      </div>
      <Activity log={job.log} />
    </div>
  );
}

function RoleCard({ job }: { job: Job }) {
  const role = job.role!;
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold">{role.title}</h2>
        <span className="text-sm text-neutral-500">{role.company} · criteria by {role.source === "claude" ? "Claude" : "built-in parser"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {role.criteria.map((c) => (
          <span key={c.id} title={c.description} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm">
            <span className="text-neutral-500 mr-1">{c.id}</span>
            {c.name}
          </span>
        ))}
      </div>
    </section>
  );
}

function criterionScoreClient(room: Room, id: string) {
  const base = room.assessments.find((a) => a.criterionId === id && !a.tieBreaker)?.score;
  const tie = room.assessments.filter((a) => a.criterionId === id && a.tieBreaker).at(-1)?.score;
  if (base === undefined) return tie;
  if (tie === undefined) return base;
  return Math.round(((base + 2 * tie) / 3) * 10) / 10;
}

function LivePanel({ job, origin }: { job: Job; origin: string }) {
  const criteria = job.role!.criteria;
  const rooms = Object.values(job.rooms);
  const byId = (id: string) => job.candidates.find((c) => c.id === id)!;
  const pivotIds = new Set(job.pivots.map((p) => p.criterionId));
  const [copied, setCopied] = useState<string | null>(null);
  const decided = !!job.decision;

  const decide = () => fetch(`/api/jobs/${job.id}/decide`, { method: "POST" });
  const simulate = (candidateId?: string) =>
    fetch(`/api/jobs/${job.id}/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId }) });
  const anyWaiting = rooms.some((r) => r.status === "waiting");
  const toggleDecline = () =>
    fetch(`/api/jobs/${job.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ simulateOfferDecline: !job.simulateOfferDecline }) });

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Live panel {job.slot && <span className="text-neutral-500 font-normal">· {job.slot}</span>}</h3>
          <p className="text-sm text-neutral-500">One ElevenLabs interviewer per room. Scores arrive as candidates answer; the panel rewrites questions across rooms.</p>
        </div>
        {!decided && (
          <div className="flex items-center gap-4 shrink-0">
            <label className="flex items-center gap-2 text-xs text-neutral-500 cursor-pointer">
              <input type="checkbox" checked={job.simulateOfferDecline} onChange={toggleDecline} className="accent-indigo-500" />
              First offer gets declined
            </label>
            {anyWaiting && (
              <button onClick={() => simulate()} className="rounded-full border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900" title="Fill empty rooms with AI candidates played by a second ElevenLabs agent">
                Simulate candidates
              </button>
            )}
            <button onClick={decide} disabled={job.busy} className="rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-40">
              End interviews & decide
            </button>
          </div>
        )}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="font-normal px-2">Candidate</th>
              {criteria.map((c) => (
                <th key={c.id} className="font-normal px-2 text-center" title={c.description}>
                  {c.name}
                  {pivotIds.has(c.id) && <span className="ml-1 text-fuchsia-300" title="Pivoted to a tie-breaker">⇄</span>}
                </th>
              ))}
              <th className="font-normal px-2">Room</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => {
              const c = byId(r.candidateId);
              const url = `${origin}/room/${job.id}/${r.candidateId}`;
              const last = r.transcript.at(-1);
              return (
                <tr key={r.candidateId}>
                  <td className="px-2 py-2 align-top">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${r.status === "live" ? "bg-emerald-400 animate-pulse" : r.status === "ended" ? "bg-neutral-600" : "bg-amber-400"}`} />
                      <span className="font-medium">{c.name}</span>
                    </div>
                    <p className="text-xs text-neutral-500 truncate max-w-[220px]">{last ? `${last.role === "user" ? c.name.split(" ")[0] : "Ava"}: ${last.text}` : r.status === "waiting" ? "Waiting to join" : ""}</p>
                  </td>
                  {criteria.map((k) => {
                    const s = criterionScoreClient(r, k.id);
                    const tie = r.assessments.some((a) => a.criterionId === k.id && a.tieBreaker);
                    const ev = r.assessments.filter((a) => a.criterionId === k.id).map((a) => `${a.tieBreaker ? "Tie-breaker" : "Base"} ${a.score}/5: ${a.evidence}`).join("\n");
                    return (
                      <td key={k.id} title={ev} className={`rounded-md text-center font-semibold transition-colors duration-500 ${scoreColor(s)}`}>
                        {s ?? "·"}
                        {tie && <sup className="ml-0.5">⇄</sup>}
                      </td>
                    );
                  })}
                  <td className="px-2 align-top">
                    <div className="flex gap-2 text-xs">
                      <a href={url} target="_blank" className="text-indigo-300 hover:underline">open</a>
                      {r.status === "waiting" && !decided && (
                        <button onClick={() => simulate(r.candidateId)} className="text-neutral-500 hover:text-neutral-300">simulate</button>
                      )}
                      <button onClick={() => { navigator.clipboard.writeText(url); setCopied(r.candidateId); setTimeout(() => setCopied(null), 1500); }} className="text-neutral-500 hover:text-neutral-300">
                        {copied === r.candidateId ? "copied" : "copy link"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {job.pivots.length > 0 && (
        <div className="mt-5 space-y-2">
          {job.pivots.map((p) => (
            <div key={p.t} className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 px-4 py-3 text-sm">
              <p className="text-fuchsia-200 font-medium">⇄ Pivot on {criteria.find((c) => c.id === p.criterionId)?.name}</p>
              <p className="text-neutral-400 mt-1">{p.reason}</p>
              <p className="text-neutral-200 mt-1">New question in every room: “{p.question}”</p>
            </div>
          ))}
        </div>
      )}

      {job.decision && (
        <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="font-medium text-emerald-200">{job.stage === "hired" ? "Hired" : "Decision"}</p>
          <p className="text-sm text-neutral-300 mt-1">{job.decision.summary}</p>
          <ol className="mt-3 space-y-1 text-sm">
            {job.decision.ranking.map((r, i) => {
              const c = byId(r.candidateId);
              const offer = job.decision!.offers.find((o) => o.candidateId === r.candidateId);
              return (
                <li key={r.candidateId} className="flex items-center gap-3">
                  <span className="w-5 text-neutral-500">{i + 1}.</span>
                  <span className="w-44">{c.name}</span>
                  <span className="w-16 text-neutral-400">{r.total.toFixed(2)}</span>
                  {offer && <span className={`rounded px-2 py-0.5 text-xs ${offer.outcome === "accepted" ? "bg-emerald-500 text-neutral-950" : offer.outcome === "declined" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-200"}`}>offer {offer.outcome}</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}

function Candidates({ job }: { job: Job }) {
  return (
    <section>
      <h3 className="text-lg font-semibold">Candidates <span className="text-neutral-500 font-normal text-sm">from Ploid</span></h3>
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {job.candidates.map((c) => (
          <article key={c.id} className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-neutral-400 truncate">{c.title} · {c.company}</p>
                <p className="text-xs text-neutral-600">{c.location}{c.email ? ` · ${c.email}` : ""}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[c.status] ?? "bg-neutral-800 text-neutral-300"}`}>{c.status.replace("_", " ")}</span>
            </div>
            {(c.matchReasons[0] || c.highlights[0]) && <p className="mt-2 text-sm text-neutral-300 line-clamp-2">{c.matchReasons[0] ?? c.highlights[0]}</p>}
            {c.reply && <p className="mt-2 text-xs text-neutral-500 italic line-clamp-2">“{c.reply}”</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function Activity({ log }: { log: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [log.length]);
  const fmt = useMemo(() => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }), []);
  return (
    <aside className="border-l border-neutral-900 bg-neutral-950 xl:h-[calc(100vh-69px)] xl:sticky xl:top-0 flex flex-col">
      <p className="px-5 pt-5 pb-3 text-xs uppercase tracking-[0.2em] text-neutral-500">Agent activity</p>
      <div ref={ref} className="flex-1 overflow-y-auto px-5 pb-6 space-y-2">
        {log.map((e, i) => (
          <div key={i} className={`text-sm ${KIND_STYLE[e.kind]}`}>
            <button onClick={() => setOpen(open === i ? null : i)} className="text-left w-full flex gap-2">
              <span className="w-4 shrink-0 text-center">{KIND_ICON[e.kind]}</span>
              <span className="flex-1">{e.text}</span>
              <span className="shrink-0 text-[10px] text-neutral-600 pt-1">{fmt.format(e.t)}</span>
            </button>
            {e.detail && open === i && <pre className="ml-6 mt-1 whitespace-pre-wrap rounded-lg bg-neutral-900 p-3 text-xs text-neutral-400 font-sans">{e.detail}</pre>}
          </div>
        ))}
      </div>
    </aside>
  );
}
