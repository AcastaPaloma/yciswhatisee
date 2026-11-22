"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Line = { role: "agent" | "user"; text: string };

export default function RoomPage() {
  return (
    <ConversationProvider>
      <Room />
    </ConversationProvider>
  );
}

function Room() {
  const { jobId, candId } = useParams<{ jobId: string; candId: string }>();
  const base = `/api/rooms/${jobId}/${candId}`;
  const [info, setInfo] = useState<{ candidate: { name: string; title: string; company: string }; role: { title: string; company: string }; slot?: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState(0);
  const [starting, setStarting] = useState(false);
  const wrapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<() => void>(() => {});

  const post = useCallback((body: unknown) => fetch(`${base}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}), [base]);

  const conversation = useConversation({
    clientTools: {
      submit_assessment: async (params: Record<string, unknown>) => {
        const res = await fetch(`${base}/assess`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
        const { instruction } = (await res.json()) as { instruction: string };
        setGuidance((g) => g + 1);
        if (instruction?.startsWith("WRAP_UP") && !wrapTimer.current) wrapTimer.current = setTimeout(() => endRef.current(), 25_000);
        return instruction ?? "Continue the interview.";
      },
    },
    onConnect: ({ conversationId }: { conversationId: string }) => post({ type: "status", status: "live", conversationId }),
    onDisconnect: () => post({ type: "status", status: "ended" }),
    onMessage: ({ message, role }: { message: string; role: "user" | "agent" }) => {
      if (!message?.trim()) return;
      setLines((l) => [...l, { role, text: message }]);
      post({ type: "message", role, text: message });
    },
    onError: (msg: unknown) => setError(typeof msg === "string" ? msg : "Connection error"),
  });
  endRef.current = conversation.endSession;
  const { status, isSpeaking, sendContextualUpdate } = conversation;

  // Forward panel updates from the orchestrator into the live call.
  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(async () => {
      const res = await fetch(`${base}/updates`, { cache: "no-store" }).catch(() => null);
      if (!res?.ok) return;
      const { updates } = (await res.json()) as { updates: string[] };
      for (const u of updates) {
        sendContextualUpdate(u);
        setGuidance((g) => g + 1);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [status, base, sendContextualUpdate]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch(`${base}/session`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start the interview");
      setInfo(data);
      conversation.startSession({ conversationToken: data.conversationToken, connectionType: "webrtc", dynamicVariables: data.dynamicVariables, userId: `${jobId}-${candId}` });
    } catch (e) {
      setError((e as Error).message.includes("Permission") ? "Microphone access is needed for the voice interview." : (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const live = status === "connected";
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center px-6 py-10">
      <div className="w-full max-w-2xl">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">Breakout room · {candId}</p>
        <h1 className="mt-2 text-3xl font-semibold">{info ? `${info.role.title} interview` : "Your interview"}</h1>
        <p className="mt-1 text-neutral-400">
          {info ? `${info.role.company} · with Ava, an AI interviewer` : "A short voice interview with Ava, an AI interviewer. Use headphones if you can."}
        </p>

        <div className="mt-10 flex flex-col items-center gap-6">
          <div className={`relative h-40 w-40 rounded-full transition-all duration-500 ${live ? (isSpeaking ? "scale-110 bg-indigo-500 shadow-[0_0_80px_rgba(99,102,241,0.7)]" : "bg-emerald-500/80 shadow-[0_0_50px_rgba(16,185,129,0.45)]") : "bg-neutral-800"}`}>
            {live && <div className="absolute inset-0 rounded-full animate-ping bg-white/10" />}
          </div>
          <p className="text-sm text-neutral-400 h-5">
            {status === "connecting" ? "Connecting…" : live ? (isSpeaking ? "Ava is speaking" : "Listening… go ahead") : status === "disconnected" && lines.length ? "Interview finished. Thank you!" : ""}
          </p>
          {!live ? (
            <button onClick={start} disabled={starting || status === "connecting"} className="rounded-full bg-white px-8 py-3 font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
              {starting || status === "connecting" ? "Starting…" : lines.length ? "Rejoin interview" : "Start interview"}
            </button>
          ) : (
            <button onClick={() => conversation.endSession()} className="rounded-full border border-neutral-700 px-6 py-2 text-sm text-neutral-300 hover:bg-neutral-900">
              End interview
            </button>
          )}
          {error && <p className="text-sm text-rose-400">{error}</p>}
          {live && guidance > 0 && <p className="text-xs text-neutral-500">Ava has received {guidance} live update{guidance > 1 ? "s" : ""} from the hiring panel.</p>}
        </div>

        <div className="mt-10 space-y-3">
          {lines.slice(-12).map((l, i) => (
            <div key={i} className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${l.role === "user" ? "bg-indigo-600/80" : "bg-neutral-800"}`}>{l.text}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
