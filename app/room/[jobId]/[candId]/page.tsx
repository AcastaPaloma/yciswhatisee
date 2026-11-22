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
    <main className="min-h-screen bg-white text-[#37352f] flex flex-col items-center px-6 py-10">
      <div className="w-full max-w-xl">
        <p className="text-[12px] text-[#9b9a97]">Panel · interview room</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{info ? `${info.role.title}` : "Your interview"}</h1>
        <p className="mt-1 text-[15px] text-[#787774]">
          {info ? `${info.role.company} · with Ava, an AI interviewer` : "A short voice interview with Ava, an AI interviewer. Headphones help."}
        </p>

        <div className="mt-10 flex flex-col items-center gap-5">
          <div className="relative grid h-36 w-36 place-items-center">
            <div className={`absolute inset-0 rounded-full transition-all duration-500 ${live ? (isSpeaking ? "bg-[#2383e2]/25 scale-110 breathe" : "bg-[#448361]/20") : "bg-[#f1f1ef]"}`} />
            <div className={`relative h-20 w-20 rounded-full transition-colors duration-500 ${live ? (isSpeaking ? "bg-[#2383e2]" : "bg-[#448361]") : "bg-[#d3d1cb]"}`} />
          </div>
          <p className="h-5 text-sm text-[#787774]">
            {status === "connecting" ? "Connecting…" : live ? (isSpeaking ? "Ava is speaking" : "Listening… go ahead") : status === "disconnected" && lines.length ? "Interview finished. Thank you!" : ""}
          </p>
          {!live ? (
            <button onClick={start} disabled={starting || status === "connecting"} className="rounded-lg bg-[#2383e2] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#0b6bcb] disabled:opacity-50">
              {starting || status === "connecting" ? "Starting…" : lines.length ? "Rejoin interview" : "Start interview"}
            </button>
          ) : (
            <button onClick={() => conversation.endSession()} className="rounded-lg border border-[#e9e9e7] px-5 py-2 text-sm text-[#787774] hover:bg-[#f7f7f5]">
              End interview
            </button>
          )}
          {error && <p className="text-sm text-[#e03e3e]">{error}</p>}
          {live && guidance > 0 && <p className="text-xs text-[#9b9a97]">Ava has received {guidance} live update{guidance > 1 ? "s" : ""} from the hiring panel.</p>}
        </div>

        <div className="mt-10 space-y-2.5">
          {lines.slice(-12).map((l, i) => (
            <div key={i} className={`flex fade-up ${l.role === "user" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[80%] rounded-2xl px-4 py-2 text-[14px] ${l.role === "user" ? "bg-[#e7f3f8]" : "bg-[#f7f7f5]"}`}>{l.text}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
