import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Job, LogEntry, LogKind } from "./types";

// One process, in-memory state, snapshotted to .data/ so a dev-server restart
// mid-demo doesn't lose the hiring run.
const FILE = path.join(process.cwd(), ".data", "jobs.json");

type Store = { jobs: Map<string, Job>; saveTimer?: NodeJS.Timeout };
const g = globalThis as unknown as { __hireStore?: Store };

function load(): Store {
  const jobs = new Map<string, Job>();
  try {
    if (existsSync(FILE)) for (const j of JSON.parse(readFileSync(FILE, "utf8")) as Job[]) jobs.set(j.id, { ...j, busy: false });
  } catch (e) {
    console.error("Could not load saved jobs", e);
  }
  return { jobs };
}

export const store: Store = (g.__hireStore ??= load());

export function save() {
  clearTimeout(store.saveTimer);
  store.saveTimer = setTimeout(() => {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify([...store.jobs.values()]));
  }, 200);
}

export function getJob(id: string) {
  return store.jobs.get(id);
}

export function latestJob() {
  return [...store.jobs.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function log(job: Job, kind: LogKind, text: string, detail?: string) {
  const entry: LogEntry = { t: Date.now(), kind, text, detail };
  job.log.push(entry);
  save();
  return entry;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
