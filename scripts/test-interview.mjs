// End-to-end check of one breakout room without a microphone: runs the real
// ElevenLabs interviewer in text-only mode, plays a scripted candidate, and
// routes the agent's submit_assessment tool calls through the app's panel API.
//
//   node scripts/test-interview.mjs <jobId> <candidateId> [appUrl]
import { readFileSync } from "node:fs";
import { Conversation } from "@elevenlabs/client";

const [jobId, candId, app = "http://localhost:3100"] = process.argv.slice(2);
if (!jobId || !candId) throw new Error("usage: node scripts/test-interview.mjs <jobId> <candidateId> [appUrl]");
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

const ANSWERS = [
  "Yes, I can hear you fine, thanks.",
  "At my last company I led a team of four that shipped a production voice agent handling about two million calls a month. I owned the streaming TTS pipeline and the turn-taking logic.",
  "The worst failure was a TTS provider outage that left callers in silence for twenty minutes. Afterwards I added a fallback voice, health checks every five seconds, and an alert on silence longer than two seconds.",
  "We cut end to end latency from 1.4 seconds to 380 milliseconds by streaming LLM tokens into TTS and starting playback on the first sentence. We measured p50 and p95 per call.",
  "I built a tool-calling support agent and an eval suite of about twelve hundred graded conversations that gates every prompt change.",
  "I was the first engineer at a seed startup, so I did everything from on-call to talking with customers every week.",
  "I sit in on customer calls weekly and turn feedback into small shipped changes within a few days.",
  "Thanks, that was fun!",
];

const base = `${app}/api/rooms/${jobId}/${candId}`;
const session = await (await fetch(`${base}/session`)).json();
if (session.error) throw new Error(session.error);
const signed = await (await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${env.ELEVENLABS_AGENT_ID}`, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } })).json();

let answer = 0;
let done = false;
const post = (body) => fetch(`${base}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const conversation = await Conversation.startSession({
  signedUrl: signed.signed_url,
  textOnly: true,
  dynamicVariables: session.dynamicVariables,
  clientTools: {
    submit_assessment: async (params) => {
      const res = await fetch(`${base}/assess`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
      const { instruction } = await res.json();
      console.log(`\n  ⚙ submit_assessment(${JSON.stringify(params)})\n  ↩ ${instruction.slice(0, 160)}`);
      if (instruction.startsWith("WRAP_UP")) done = true;
      return instruction;
    },
  },
  onConnect: ({ conversationId }) => { console.log("connected", conversationId); post({ type: "status", status: "live", conversationId }); },
  onDisconnect: () => { post({ type: "status", status: "ended" }); console.log("\ndisconnected"); process.exit(0); },
  onError: (e) => console.error("error", e),
  onMessage: ({ message, role }) => {
    console.log(`\n${role === "agent" ? "Ava" : "Candidate"}: ${message}`);
    post({ type: "message", role, text: message });
    if (role === "agent" && answer < ANSWERS.length) {
      if (done && answer < ANSWERS.length - 1) answer = ANSWERS.length - 1;
      const text = ANSWERS[answer++];
      setTimeout(() => conversation.sendUserMessage(text), 800);
      if (answer === ANSWERS.length) setTimeout(() => conversation.endSession(), 8000);
    }
  },
});
setTimeout(() => { console.log("\ntimeout"); conversation.endSession(); }, 180_000);
