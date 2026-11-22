// Speaks one transcript line with ElevenLabs TTS, so the dashboard can play
// simulated (text-only) interviews out loud.
export const dynamic = "force-dynamic";

const VOICES: Record<string, string> = {
  ava: process.env.INTERVIEWER_VOICE_ID || "EXAVITQu4vr4xnSDxMaL", // Sarah
  c0: "JBFqnCBsd6RMkjVDRZzb", // George
  c1: "CwhRBWXzGAHq8TQ4Fs17", // Roger
  c2: "Xb7hH8MSUJpSbSDYk0k2", // Alice
  c3: "IKne3meq5aSn9XLyUdCD", // Charlie
};

export async function POST(req: Request) {
  const { text, voice } = (await req.json().catch(() => ({}))) as { text?: string; voice?: string };
  if (!text?.trim()) return new Response("text required", { status: 422 });
  const voiceId = VOICES[voice ?? "ava"] ?? VOICES.ava;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 1200), model_id: "eleven_flash_v2_5" }),
  });
  if (!res.ok || !res.body) return new Response(`TTS failed: ${res.status} ${(await res.text()).slice(0, 200)}`, { status: 502 });
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}
