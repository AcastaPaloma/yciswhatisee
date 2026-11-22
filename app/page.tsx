"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { SAMPLE_JD } from "@/lib/sample";
import type { Candidate, Job, LogEntry, Room } from "@/lib/types";

// ── helpers ─────────────────────────────────────────────────────────────────
const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

function score(room: Room, id: string) {
  const base = room.assessments.find((a) => a.criterionId === id && !a.tieBreaker)?.score;
  const tie = room.assessments.filter((a) => a.criterionId === id && a.tieBreaker).at(-1)?.score;
  if (base === undefined) return tie;
  if (tie === undefined) return base;
  return Math.round(((base + 2 * tie) / 3) * 10) / 10;
}

const scoreTag = (s?: number) =>
  s === undefined ? "bg-[#f1f1ef] text-[#9b9a97]" : s >= 4 ? "bg-[#dbeddb] text-[#1c3829]" : s >= 3 ? "bg-[#fdecc8] text-[#402c1b]" : "bg-[#ffe2dd] text-[#5d1715]";

const first = (name: string) => name.split(" ")[0];

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

// ── page ────────────────────────────────────────────────────────────────────
export default function Home() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(process.env.NEXT_PUBLIC_APP_URL || window.location.origin); // room links & QR codes point at the public tunnel
    const id = new URLSearchParams(window.location.search).get("job");
    if (id) setJobId(id);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok && alive) setJob(await res.json());
    };
    tick();
    const id = setInterval(tick, 800);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [jobId]);

  const open = (id: string | null) => {
    setJob(null);
    setJobId(id);
    window.history.replaceState(null, "", id ? `/?job=${id}` : "/");
  };

  const stage = job?.stage ?? "draft";
  const anyJoined = !!job && Object.values(job.rooms).some((r) => r.status !== "waiting");
  const showLive = !!job && (stage === "interviewing" || stage === "deciding" || (stage === "scheduled" && anyJoined));
  const wide = showLive;

  return (
    <main className="min-h-screen flex flex-col bg-white text-[#37352f]">
      <header className="flex items-center justify-between px-6 py-4 text-sm">
        <button onClick={() => open(null)} className="flex items-center gap-2 font-medium">
          <span className="grid h-6 w-6 place-items-center rounded border border-[#37352f] text-xs">P</span> Panel
        </button>
        {job && (
          <div className="flex items-center gap-4 text-[#787774]">
            {job.busy && <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#2383e2] breathe" />Agent working</span>}
            <button onClick={() => open(null)} className="hover:text-[#37352f]">+ New role</button>
          </div>
        )}
      </header>

      <div className="flex-1 flex items-start justify-center px-6 pb-16">
        <div className={`w-full transition-all duration-700 ${wide ? "max-w-6xl" : "max-w-xl"} ${wide ? "mt-2" : "mt-[8vh]"}`}>
          {!jobId ? (
            <Intake onStarted={open} />
          ) : !job ? (
            <Box><p className="text-[#9b9a97]">Loading…</p></Box>
          ) : stage === "draft" || stage === "sourcing" ? (
            <Searching job={job} />
          ) : stage === "sourced" ? (
            <Shortlist job={job} />
          ) : showLive ? (
            <Live job={job} origin={origin} />
          ) : stage === "outreach" || stage === "scheduled" ? (
            <Invites job={job} origin={origin} />
          ) : (
            <Result job={job} />
          )}
        </div>
      </div>
    </main>
  );
}

function Box({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#e9e9e7] bg-white p-7 shadow-[0_1px_2px_rgba(15,15,15,0.04),0_8px_24px_rgba(15,15,15,0.05)] fade-up ${className}`}>{children}</section>;
}

// ── 1. intake ───────────────────────────────────────────────────────────────
function Intake({ onStarted }: { onStarted: (id: string) => void }) {
  const [jd, setJd] = useState(SAMPLE_JD);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const start = async () => {
    setSending(true);
    setError(null);
    const res = await post("/api/jobs", { jd });
    const data = await res.json();
    setSending(false);
    if (!res.ok) return setError(data.error);
    onStarted(data.id);
  };
  return (
    <Box>
      <p className="text-3xl">🧭</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Who are you hiring?</h1>
      <p className="mt-1 text-[15px] text-[#787774]">Paste the requirements. Panel finds the people, interviews the best ones at the same time, and comes back with a hire.</p>
      <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={11} className="mt-5 w-full resize-none rounded-lg bg-[#f7f7f5] text-[#37352f] p-4 text-[14px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#2383e2]/30" />
      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-[#e03e3e]">{error}</span>
        <button onClick={start} disabled={sending} className="rounded-lg bg-[#2383e2] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0b6bcb] disabled:opacity-50">
          {sending ? "Starting…" : "Find candidates →"}
        </button>
      </div>
      <ResumeLink />
    </Box>
  );
}

function ResumeLink() {
  const resume = async () => {
    const { id } = await (await fetch("/api/jobs", { cache: "no-store" })).json();
    if (id) window.location.href = `/?job=${id}`;
  };
  return <button onClick={resume} className="mt-3 text-xs text-[#9b9a97] hover:text-[#787774]">Resume last run</button>;
}

// ── 2. searching ────────────────────────────────────────────────────────────
function Searching({ job }: { job: Job }) {
  const now = useNow(true);
  const elapsed = now - (job.startedAt ?? job.createdAt);
  const scanned = Math.min(2_000_000_000, Math.round(2_000_000_000 * (1 - Math.exp(-elapsed / 2500))));
  const steps = job.log.filter((l) => l.kind === "think" || l.kind === "tool" || l.kind === "error").slice(-5);
  return (
    <Box>
      <p className="text-3xl">🔍</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">Searching</h2>
      <p className="mt-1 text-[15px] text-[#787774]">
        <span className="tabular-nums font-medium text-[#37352f]">{scanned.toLocaleString()}</span> profiles on Ploid
      </p>
      <div className="mt-5 h-1 overflow-hidden rounded-full bg-[#f1f1ef]">
        <div className="h-full w-2/5 rounded-full bg-[#2383e2] scan-bar" />
      </div>
      {job.role && (
        <div className="mt-5 flex flex-wrap gap-2 fade-up">
          {job.role.criteria.map((c) => (
            <span key={c.id} className="rounded bg-[#e7f3f8] px-2 py-0.5 text-[13px] text-[#1d4a5c]">{c.name}</span>
          ))}
        </div>
      )}
      <ul className="mt-5 space-y-2 text-[14px]">
        {steps.map((s, i) => (
          <li key={s.t + s.text} className={`fade-up flex gap-2 ${i === steps.length - 1 ? "text-[#37352f]" : "text-[#9b9a97]"}`}>
            <span>{s.kind === "tool" ? "✓" : s.kind === "error" ? "!" : "·"}</span>
            {s.text}
          </li>
        ))}
      </ul>
    </Box>
  );
}

// ── 3. shortlist ────────────────────────────────────────────────────────────
function Shortlist({ job }: { job: Job }) {
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<string[]>(() => job.candidates.slice(0, 3).map((c) => c.id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const topK = (k: number) => setSelected(job.candidates.slice(0, k).map((c) => c.id));
  return (
    <Box>
      <p className="text-3xl">✨</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">Top 5 for {job.role?.title}</h2>
      <p className="mt-1 text-[15px] text-[#787774]">Out of 2,000,000,000 profiles, verified against public evidence.</p>
      <div className="mt-4 flex items-center gap-2 text-[13px] text-[#787774]">
        <span>Interview:</span>
        {job.candidates.map((_, i) => (
          <button key={i} onClick={() => topK(i + 1)} className={`rounded px-2 py-0.5 ${selected.length === i + 1 && job.candidates.slice(0, i + 1).every((c) => selected.includes(c.id)) ? "bg-[#2383e2] text-white" : "bg-[#f1f1ef] hover:bg-[#e9e9e7]"}`}>
            Top {i + 1}
          </button>
        ))}
        <span className="ml-1 text-[#9b9a97]">or pick below</span>
      </div>
      <ol className="mt-3 divide-y divide-[#f1f1ef]">
        {job.candidates.map((c, i) => (
          <li key={c.id} onClick={() => toggle(c.id)} className="fade-up cursor-pointer py-3 hover:bg-[#fbfbfa]" style={{ animationDelay: `${i * 140}ms` }}>
            <div className="flex items-baseline gap-3">
              <input type="checkbox" readOnly checked={selected.includes(c.id)} className="accent-[#2383e2] translate-y-0.5" />
              <span className="w-4 text-sm text-[#9b9a97]">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name} <span className="font-normal text-[#787774]">· {c.title}, {c.company}</span></p>
                <p className="mt-0.5 text-[13px] text-[#787774] line-clamp-1">{c.matchReasons[0] ?? c.highlights[0]}</p>
              </div>
              {selected.includes(c.id) && <span className="rounded bg-[#dbeddb] px-1.5 py-0.5 text-[11px] text-[#1c3829]">Interview</span>}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex justify-end">
        <button onClick={() => { setSending(true); post(`/api/jobs/${job.id}/invite`, { candidateIds: job.candidates.filter((c) => selected.includes(c.id)).map((c) => c.id) }); }} disabled={sending || !selected.length} className="rounded-lg bg-[#2383e2] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0b6bcb] disabled:opacity-50">
          {sending ? "Inviting…" : `Interview ${selected.length === 1 ? "1 candidate" : `these ${selected.length}`} →`}
        </button>
      </div>
    </Box>
  );
}

// ── 4. invites + room links ─────────────────────────────────────────────────
function Qr({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#37352f", light: "#ffffff" } }).then(setSrc);
  }, [url]);
  return src ? <img src={src} alt="Room QR code" className="h-28 w-28 rounded" /> : <div className="h-28 w-28" />;
}

function Invites({ job, origin }: { job: Job; origin: string }) {
  const panel = job.candidates.filter((c) => ["contacted", "interviewing", "accepted"].includes(c.status));
  const simulateAll = () => post(`/api/jobs/${job.id}/simulate`);
  return (
    <Box>
      <p className="text-3xl">✉️</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">{job.stage === "outreach" ? `Inviting ${panel.length} finalist${panel.length === 1 ? "" : "s"}` : "Rooms are open"}</h2>
      <p className="mt-1 text-[15px] text-[#787774]">Each finalist gets their own voice room with Ava, an ElevenLabs interviewer. {panel.length > 1 ? "They all run at the same time." : ""}</p>
      <div className="mt-5 space-y-3">
        {panel.map((c, i) => {
          const room = job.rooms[c.id];
          const url = `${origin}/room/${job.id}/${c.id}`;
          return (
            <div key={c.id} className="fade-up flex items-center gap-4 rounded-lg bg-[#f7f7f5] p-3" style={{ animationDelay: `${i * 120}ms` }}>
              {room ? <Qr url={url} /> : <div className="grid h-28 w-28 place-items-center text-2xl">✉️</div>}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{c.name}</p>
                <p className="text-[13px] text-[#787774]">{c.email}</p>
                <p className="mt-1 text-[13px]">{room ? <span className="text-[#448361]">✓ Accepted · waiting to join</span> : <span className="text-[#9b9a97]">Invite sent…</span>}</p>
                {room && (
                  <div className="mt-2 flex gap-3 text-[13px]">
                    <a href={url} target="_blank" className="text-[#2383e2] hover:underline">Open room</a>
                    <button onClick={() => navigator.clipboard.writeText(url)} className="text-[#787774] hover:text-[#37352f]">Copy link</button>
                    <button onClick={() => post(`/api/jobs/${job.id}/simulate`, { candidateId: c.id })} className="text-[#787774] hover:text-[#37352f]">Simulate</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {Object.keys(job.rooms).length > 0 && (
        <div className="mt-5 flex items-center justify-between text-[13px] text-[#9b9a97]">
          <span>The dashboard goes live as soon as someone joins.</span>
          <button onClick={simulateAll} className="text-[#787774] hover:text-[#37352f]">Simulate all with AI candidates</button>
        </div>
      )}
    </Box>
  );
}

// ── 5. live panel ───────────────────────────────────────────────────────────
// Plays one room out loud with ElevenLabs TTS (Ava + a voice per candidate).
function useListener(job: Job) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const spoken = useRef(0);
  const queue = useRef<{ text: string; voice: string }[]>([]);
  const playing = useRef(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const active = useRef<string | null>(null);

  const playNext = async () => {
    if (playing.current) return;
    const next = queue.current.shift();
    if (!next) return;
    playing.current = true;
    const owner = active.current;
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      if (res.ok && owner === active.current) {
        const a = new Audio(URL.createObjectURL(await res.blob()));
        audio.current = a;
        await new Promise<void>((done) => {
          a.onended = () => done();
          a.onerror = () => done();
          a.play().catch(() => done());
        });
      }
    } finally {
      playing.current = false;
      if (owner === active.current) void playNext();
    }
  };

  const toggle = (id: string) => {
    const on = roomId !== id;
    audio.current?.pause();
    queue.current = [];
    playing.current = false;
    active.current = on ? id : null;
    setRoomId(on ? id : null);
    if (on) spoken.current = Math.max(0, job.rooms[id].transcript.length - 1); // start from the latest line
    void post(`/api/rooms/${job.id}/${id}/listen`, { on });
  };

  useEffect(() => {
    if (!roomId) return;
    const room = job.rooms[roomId];
    const idx = Object.keys(job.rooms).indexOf(roomId);
    while (spoken.current < room.transcript.length) {
      const l = room.transcript[spoken.current++];
      queue.current.push({ text: l.text, voice: l.role === "agent" ? "ava" : `c${idx}` });
    }
    void playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, roomId]);

  useEffect(() => () => audio.current?.pause(), []);
  return { listeningTo: roomId, toggle };
}

function Live({ job, origin }: { job: Job; origin: string }) {
  const now = useNow(true);
  const rooms = Object.values(job.rooms);
  const criteria = job.role!.criteria;
  const latestPivot = job.pivots.at(-1);
  const liveCount = rooms.filter((r) => r.status === "live").length;
  const insights = job.log.filter((l) => l.kind === "insight" || l.kind === "pivot" || (l.kind === "room" && /\d\/5/.test(l.text)));
  const [deciding, setDeciding] = useState(false);
  const { listeningTo, toggle } = useListener(job);
  return (
    <div className="space-y-4 fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-[#787774]">{job.role!.company} · live panel</p>
          <h2 className="text-2xl font-semibold tracking-tight">{job.role!.title}</h2>
        </div>
        <div className="flex items-center gap-4 text-[13px] text-[#787774]">
          <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${liveCount ? "bg-[#e03e3e] breathe" : "bg-[#d3d1cb]"}`} />{liveCount} rooms live</span>
          <span className="tabular-nums">⏱ {fmtDuration(now - (job.interviewsStartedAt ?? now))}</span>
          <span>🔄 {job.pivots.length} questions swapped</span>
          <button onClick={() => { setDeciding(true); post(`/api/jobs/${job.id}/decide`); }} disabled={deciding || job.stage === "deciding"} className="rounded-lg bg-[#37352f] px-4 py-2 font-medium text-white hover:bg-black disabled:opacity-50">
            {deciding || job.stage === "deciding" ? "Deciding…" : "Wrap up & decide →"}
          </button>
        </div>
      </div>

      {latestPivot && (
        <div key={latestPivot.t} className="rounded-xl border border-[#f5d9b8] bg-[#fbecdd] p-4 fade-up">
          <p className="text-[13px] font-medium text-[#854c1d]">🔄 Panel changed the question in every room · {criteria.find((c) => c.id === latestPivot.criterionId)?.name}</p>
          <p className="mt-1 text-[14px] text-[#5c3b1b]">{latestPivot.reason}</p>
          <p className="mt-2 border-l-2 border-[#d9730d] pl-3 text-[15px] text-[#37352f]">“{latestPivot.question}”</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:[grid-template-columns:var(--cols)]" style={{ ["--cols" as string]: `repeat(${Math.min(rooms.length, 4)}, minmax(0, 1fr)) 300px` }}>
        {rooms.map((r) => (
          <RoomCard key={r.candidateId} job={job} room={r} cand={job.candidates.find((c) => c.id === r.candidateId)!} now={now} origin={origin} listening={listeningTo === r.candidateId} onListen={() => toggle(r.candidateId)} />
        ))}
        <aside className="rounded-xl border border-[#e9e9e7] p-4 lg:max-h-[560px] lg:overflow-y-auto">
          <p className="text-[13px] font-medium">💡 Live insights</p>
          <Feed entries={insights} />
        </aside>
      </div>
    </div>
  );
}

function RoomCard({ job, room, cand, now, origin, listening, onListen }: { job: Job; room: Room; cand: Candidate; now: number; origin: string; listening: boolean; onListen: () => void }) {
  const changed = room.questionChangedAt && now - room.questionChangedAt < 8000;
  const lines = room.transcript.slice(-3);
  const url = `${origin}/room/${job.id}/${cand.id}`;
  return (
    <div className="flex flex-col rounded-xl border border-[#e9e9e7] p-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${room.status === "live" ? "bg-[#448361] breathe" : room.status === "ended" ? "bg-[#d3d1cb]" : "bg-[#dfab01]"}`} />
        <p className="font-medium">{cand.name}</p>
        {room.sentiment && <span className="ml-auto rounded bg-[#e8deee] px-1.5 py-0.5 text-[11px] text-[#412454]">{room.sentiment}</span>}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-[#9b9a97]">{cand.title}</p>
        {room.status !== "waiting" && (
          <button onClick={onListen} className={`shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[12px] ${listening ? "bg-[#2383e2] text-white" : "text-[#787774] hover:bg-[#f1f1ef]"}`}>
            {listening ? "🔊 Listening" : "🔈 Listen"}
          </button>
        )}
      </div>

      <div key={room.questionChangedAt ?? 0} className={`mt-3 rounded-lg bg-[#f7f7f5] p-3 ${changed ? "flash" : ""}`}>
        <p className="text-[11px] uppercase tracking-wide text-[#9b9a97]">{room.status === "ended" ? "Interview finished" : changed ? "🔄 New question from the panel" : "Ava is asking"}</p>
        <p className="mt-1 text-[14px] leading-snug">{room.status === "ended" ? `${room.assessments.length} answers assessed` : room.currentQuestion ?? (room.status === "waiting" ? "Waiting for the candidate to join…" : "…")}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.role!.criteria.map((c) => {
          const s = score(room, c.id);
          return (
            <span key={c.id} className={`rounded px-1.5 py-0.5 text-[12px] transition-colors duration-700 ${scoreTag(s)}`}>
              {c.name} {s ?? "–"}
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex-1 space-y-1.5 text-[13px]">
        {lines.map((l, i) => (
          <p key={l.t + i} className="fade-up line-clamp-2">
            <span className="text-[#9b9a97]">{l.role === "user" ? first(cand.name) : "Ava"}:</span> {l.text}
          </p>
        ))}
      </div>
      {room.status === "waiting" && (
        <div className="mt-3 flex items-center gap-3">
          <Qr url={url} />
          <p className="text-[12px] text-[#787774]">Scan to join as {first(cand.name)}</p>
        </div>
      )}
      {room.status === "waiting" && (
        <div className="mt-3 flex gap-3 text-[12px]">
          <a href={url} target="_blank" className="text-[#2383e2] hover:underline">Open room</a>
          <button onClick={() => post(`/api/jobs/${job.id}/simulate`, { candidateId: cand.id })} className="text-[#787774] hover:text-[#37352f]">Simulate</button>
        </div>
      )}
    </div>
  );
}

function Feed({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [entries.length]);
  const icon = (k: LogEntry["kind"]) => (k === "pivot" ? "🔄" : k === "insight" ? "💡" : "🎙️");
  return (
    <div ref={ref} className="mt-3 space-y-2.5">
      {entries.length === 0 && <p className="text-[13px] text-[#9b9a97]">Insights appear as candidates answer.</p>}
      {entries.map((e) => (
        <p key={e.t + e.text} className={`fade-up text-[13px] leading-snug ${e.kind === "pivot" ? "rounded bg-[#fbecdd] p-2 text-[#5c3b1b]" : e.kind === "insight" ? "text-[#37352f]" : "text-[#787774]"}`}>
          {icon(e.kind)} {e.text}
        </p>
      ))}
    </div>
  );
}

// ── 6. result + offer ───────────────────────────────────────────────────────
function Result({ job }: { job: Job }) {
  const d = job.decision;
  const [sending, setSending] = useState(false);
  const byId = useMemo(() => Object.fromEntries(job.candidates.map((c) => [c.id, c])), [job.candidates]);
  if (!d) return <Box><p className="text-[#9b9a97]">Comparing every answer…</p></Box>;
  const winner = byId[job.decision!.offers.find((o) => o.outcome === "accepted")?.candidateId ?? d.ranking[0]?.candidateId];
  const hired = job.stage === "hired";
  const offerPending = d.offers.some((o) => o.outcome === "pending");
  return (
    <Box>
      <p className="text-3xl">{hired ? "🎉" : "🏆"}</p>
      <p className="mt-3 text-[13px] text-[#787774]">{hired ? "Role filled" : `Best candidate for ${job.role!.title}`}</p>
      <h2 className="text-3xl font-semibold tracking-tight">{winner?.name ?? "No winner"}</h2>
      <p className="text-[15px] text-[#787774]">{winner?.title} · {winner?.company}</p>

      {!hired && d.reasons.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-[14px]">
          {d.reasons.map((r, i) => <li key={i} className="fade-up flex gap-2" style={{ animationDelay: `${i * 120}ms` }}><span>✓</span>{r}</li>)}
        </ul>
      )}

      <div className="mt-5 grid grid-cols-3 gap-3 text-center">
        <Stat value={fmtDuration(d.stats.elapsedMs)} label="requirements → decision" />
        <Stat value={`${d.stats.interviews} at once`} label={`interviews in ${d.stats.parallelMinutes} min`} />
        <Stat value={`~${d.stats.sequentialHours} h`} label="of interviewer time saved" />
      </div>
      {d.stats.pivots > 0 && <p className="mt-3 text-center text-[13px] text-[#787774]">🔄 {d.stats.pivots} question{d.stats.pivots > 1 ? "s" : ""} swapped live when answers stopped separating people</p>}

      {!hired && (
        <ol className="mt-5 space-y-1 text-[14px]">
          {d.ranking.map((r, i) => {
            const offer = d.offers.find((o) => o.candidateId === r.candidateId);
            return (
              <li key={r.candidateId} className="flex items-center gap-3">
                <span className="w-4 text-[#9b9a97]">{i + 1}</span>
                <span className="flex-1">{byId[r.candidateId]?.name}</span>
                {offer && <span className="text-[12px] text-[#787774]">offer {offer.outcome}</span>}
                <span className="tabular-nums text-[#787774]">{r.total.toFixed(1)}</span>
              </li>
            );
          })}
        </ol>
      )}

      {d.offerLetter && (
        <pre className="mt-5 whitespace-pre-wrap rounded-lg bg-[#f7f7f5] p-4 font-sans text-[13px] leading-relaxed text-[#37352f] fade-up">{d.offerLetter}</pre>
      )}
      {hired ? (
        <p className="mt-4 rounded-lg bg-[#dbeddb] px-4 py-3 text-[14px] text-[#1c3829] fade-up">✓ {winner?.name} accepted the offer.</p>
      ) : (
        <div className="mt-5 flex justify-end">
          <button onClick={() => { setSending(true); post(`/api/jobs/${job.id}/offer`); }} disabled={sending || offerPending || job.busy} className="rounded-lg bg-[#2383e2] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#0b6bcb] disabled:opacity-50">
            {offerPending || sending ? "Sending offer…" : "Send offer letter →"}
          </button>
        </div>
      )}
    </Box>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-[#f7f7f5] px-2 py-3">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[12px] text-[#787774]">{label}</p>
    </div>
  );
}
