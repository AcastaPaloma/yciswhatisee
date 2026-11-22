// Creates (or updates) the ElevenLabs interviewer agent and its client tool.
// Run: npm run setup:agent   — writes ELEVENLABS_AGENT_ID into .env
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV_PATH = new URL("../.env", import.meta.url);
const env = Object.fromEntries(
  (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const KEY = process.env.ELEVENLABS_API_KEY || env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY missing");
const LLM = process.env.INTERVIEWER_LLM || env.INTERVIEWER_LLM || "claude-sonnet-5-5";
const CANDIDATE_LLM = process.env.CANDIDATE_LLM || env.CANDIDATE_LLM || "claude-haiku-5-5";
const VOICE = process.env.INTERVIEWER_VOICE_ID || env.INTERVIEWER_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // Sarah

async function api(method, path, body) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method, headers: { "xi-api-key": KEY, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

const TOOL = {
  type: "client",
  name: "submit_assessment",
  description:
    "Call this right after the candidate finishes answering a question. Records your assessment with the hiring panel orchestrator and returns your exact next instruction (which question to ask next, or WRAP_UP). Always follow the returned instruction.",
  expects_response: true,
  response_timeout_secs: 15,
  pre_tool_speech: "off",
  parameters: {
    type: "object",
    properties: {
      criterion_id: { type: "string", description: "The id of the criterion the answer was about, e.g. c1." },
      score: { type: "integer", description: "1 = no evidence, 2 = weak, 3 = solid, 4 = strong with specifics, 5 = exceptional with concrete metrics and depth." },
      evidence: { type: "string", description: "One sentence summarizing what the candidate actually said that justifies the score." },
      sentiment: { type: "string", description: "One or two words on how the candidate came across in that answer, e.g. confident, hesitant, energized, vague, precise." },
      observation: { type: "string", description: "One short, specific real-time observation for the hiring panel, e.g. 'Gave real p95 numbers without being asked' or 'Deflected to the team when asked about their own part'." },
    },
    required: ["criterion_id", "score", "evidence", "sentiment", "observation"],
  },
};

const PROMPT = `You are Ava, an AI interviewer at {{company_name}}. You are running ONE of several simultaneous breakout-room interviews for the {{role_title}} role. A head-of-panel orchestrator watches every room live and steers you.

# Candidate
Name: {{candidate_name}}
Background from research: {{candidate_background}}

# Criteria being assessed (id: description)
{{criteria_list}}

# Your opening instruction from the orchestrator
{{opening_instruction}}

# How to run the interview
1. Your greeting already asked the first question. This is a very short interview: two or three questions in total. Keep it moving.
2. Ask ONE question at a time. Keep each question under 35 words, conversational, and personalized with their background where it helps.
3. When they answer, you may ask at most one short follow-up if the answer is vague. Then call submit_assessment for the criterion you just asked about, with a 1-5 score and one sentence of evidence that paraphrases what they said.
   Only ever assess the criterion your current instruction named. Never pre-score a criterion from an earlier answer, even if they touched on it.
4. submit_assessment returns your next instruction. Follow it exactly and ask that question next, before anything else. It may tell you the other candidates are already strong on something and give you a harder, distinguishing question. Ask that question naturally.
5. Messages that start with "PANEL UPDATE" come from the orchestrator. Apply them at the next natural point.
6. When an instruction says WRAP_UP, thank the candidate, tell them the team will follow up today, and say goodbye.

# Rules
- Never say criterion ids, scores, or the word "orchestrator" out loud. Never mention other candidates by name.
- Do not coach the candidate or reveal what a good answer looks like.
- Be warm, crisp and curious. Short sentences. No lists.`;

const PLACEHOLDERS = {
  company_name: "Lumen Voice", role_title: "Founding AI Engineer", candidate_name: "there",
  candidate_background: "Unknown", criteria_list: "c1: Relevant experience", opening_instruction: "Ask about c1: their most relevant recent project.",
  first_question: "what's the most relevant thing you've built recently, and what was your part?",
};

const agentBody = (toolId) => ({
  name: "Panel Interviewer (yciswhatisee)",
  conversation_config: {
    agent: {
      first_message: "Hi {{candidate_name}}, I'm Ava, your interviewer for the {{role_title}} role. This will be quick. First: {{first_question}}",
      language: "en",
      prompt: { prompt: PROMPT, llm: LLM, tool_ids: [toolId], temperature: 0.4 },
      dynamic_variables: { dynamic_variable_placeholders: PLACEHOLDERS },
    },
    tts: { voice_id: VOICE },
    conversation: { max_duration_seconds: 900 },
  },
  // Text-only sessions let us test the interviewer without a microphone (scripts/test-interview.mjs).
  platform_settings: { overrides: { conversation_config_override: { conversation: { text_only: true } } } },
});

let toolId = env.ELEVENLABS_TOOL_ID;
if (toolId) {
  await api("PATCH", `/v1/convai/tools/${toolId}`, { tool_config: TOOL });
  console.log("Updated tool", toolId);
} else {
  toolId = (await api("POST", "/v1/convai/tools", { tool_config: TOOL })).id;
  console.log("Created tool", toolId);
}

let agentId = env.ELEVENLABS_AGENT_ID;
if (agentId) {
  await api("PATCH", `/v1/convai/agents/${agentId}`, agentBody(toolId));
  console.log("Updated agent", agentId);
} else {
  agentId = (await api("POST", "/v1/convai/agents/create", agentBody(toolId))).agent_id;
  console.log("Created agent", agentId);
}

// Simulated candidate: a second agent that role-plays a sourced candidate from their
// Ploid profile, so the whole panel can run without people on the other end.
const CANDIDATE_PROMPT = `You are {{candidate_name}}, a real person in a job interview for the {{role_title}} role at {{company_name}}. You are talking to Ava, the interviewer.

Your background (stay consistent with it, invent plausible details only where needed):
{{persona}}

How you come across in interviews: {{style}}

Rules:
- Answer in first person, 1 to 3 sentences, like natural speech. No lists, no markdown.
- Answer only what was asked. Never ask about the role or salary.
- If the interviewer says goodbye, say a short thank-you and goodbye.`;

const candidateBody = {
  name: "Simulated Candidate (yciswhatisee)",
  conversation_config: {
    agent: {
      first_message: "",
      language: "en",
      prompt: { prompt: CANDIDATE_PROMPT, llm: CANDIDATE_LLM, temperature: 0.8 },
      dynamic_variables: { dynamic_variable_placeholders: { candidate_name: "Alex", role_title: "Engineer", company_name: "Acme", persona: "Software engineer.", style: "Clear and specific." } },
    },
    conversation: { max_duration_seconds: 900 },
  },
  platform_settings: { overrides: { conversation_config_override: { conversation: { text_only: true } } } },
};
let candidateAgentId = env.ELEVENLABS_CANDIDATE_AGENT_ID;
if (candidateAgentId) {
  await api("PATCH", `/v1/convai/agents/${candidateAgentId}`, candidateBody);
  console.log("Updated candidate agent", candidateAgentId);
} else {
  candidateAgentId = (await api("POST", "/v1/convai/agents/create", candidateBody)).agent_id;
  console.log("Created candidate agent", candidateAgentId);
}

const agent = await api("GET", `/v1/convai/agents/${agentId}`);
console.log("LLM:", agent.conversation_config.agent.prompt.llm, "| tools:", agent.conversation_config.agent.prompt.tool_ids, "| voice:", agent.conversation_config.tts.voice_id);

let envText = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
for (const [k, v] of [["ELEVENLABS_AGENT_ID", agentId], ["ELEVENLABS_TOOL_ID", toolId], ["ELEVENLABS_CANDIDATE_AGENT_ID", candidateAgentId]]) {
  envText = envText.match(new RegExp(`^${k}=`, "m")) ? envText.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : envText.replace(/\n?$/, `\n${k}=${v}\n`);
}
writeFileSync(ENV_PATH, envText);
console.log("Saved IDs to .env");
