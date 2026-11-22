// Ploid client. Uses the real API when PLOID_BASE_URL is set (e.g.
// https://api.ploid.com); otherwise calls the contract-compatible mock in-process.
import { handle } from "../mock-ploid/server.mjs";

const BASE = process.env.PLOID_BASE_URL?.replace(/\/$/, "");
const KEY = process.env.PLOID_API_KEY || "mock";
export const ploidMode = BASE ? `live (${BASE})` : "mock (in-process)";
export const isLive = !!BASE;
// Person reports cost 10-25 ACU and take minutes each on the live API; only run them when asked to.
export const researchEnabled = !BASE || process.env.PLOID_RESEARCH === "1";

export class PloidError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  if (!BASE) {
    const out = await handle(method, path, { authorization: `Bearer ${KEY}` }, body ?? {});
    if (out.status >= 400) throw new PloidError(out.status, out.body.error?.code, out.body.error?.message);
    return out;
  }
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...(method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new PloidError(res.status, json.error?.code ?? "http_error", json.error?.message ?? res.statusText);
  return { status: res.status, body: json };
}

export type SearchResult = {
  url: string | null;
  title: string | null;
  score: number | null;
  person: { person_id: string; name: string | null; title: string | null; company: string | null; location: string | null; linkedin_url: string | null;
    positions?: { title: string | null; company: string | null; started: string | null; ended: string | null; description: string | null }[] };
  verification?: { criterion: string; reasoning: string }[];
};

export async function search(req: Record<string, unknown>) {
  const { body } = await call<{ data: { results: SearchResult[]; rows_indexed: number; verification?: { status: string }; coverage: { candidates_seen: number } }; meta: { credits_charged: number } }>("POST", "/v1/search", req);
  return body;
}

export async function person(personId: string, include: string[] = []) {
  let { status, body } = await call("POST", "/v1/person", { identifier: { person_id: personId }, type: "standard", ...(include.length ? { include } : {}) });
  if (status === 202) {
    const runId = body.data.run_id;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      ({ status, body } = await call("GET", `/v1/person/runs/${runId}`));
      const d = body.data;
      if (!d || !("run_id" in d)) break; // finished: person record, or null for an uncertain identity
      if (d.status === "cancelled") return null;
    }
    if (body.data && "run_id" in body.data) return null; // still running after the wait budget
  }
  return body.data as null | {
    summary: string;
    professional: { skills: string[] | null; history: { title: string | null; company: string | null; period: string | null }[] };
    signals: { personal_interests: { interest: string; evidence_quote: string | null }[] };
    contact?: { work_email?: { value: string | null } };
  };
}

export async function enrich(personId: string) {
  const { body } = await call("POST", "/v1/enrich", { person_id: personId, fields: ["work_email"] });
  return body.data.work_email?.value as string | null;
}
