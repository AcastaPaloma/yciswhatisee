export type Criterion = {
  id: string; // c1..c5
  name: string; // short label for the grid
  description: string; // what "good" looks like
  question: string; // opening question for this criterion
  differentiators: string[]; // harder, distinguishing questions used when everyone is strong
};

export type RoleSpec = {
  title: string;
  company: string;
  summary: string;
  mustHaves: string[];
  niceToHaves: string[];
  criteria: Criterion[];
  searchQuery: string;
  source: "claude" | "heuristic";
};

export type CandidateStatus =
  | "shortlisted" | "contacted" | "accepted" | "declined" | "no_overlap"
  | "interviewing" | "interviewed" | "offered" | "offer_declined" | "hired" | "not_selected";

export type Candidate = {
  id: string; // short id used in room URLs
  personId: string;
  name: string;
  title: string;
  company: string;
  location: string;
  linkedinUrl: string;
  matchReasons: string[];
  background: string;
  highlights: string[];
  interests: string[];
  email?: string;
  status: CandidateStatus;
  availability?: string[];
  outreach?: { subject: string; body: string };
  reply?: string;
};

export type LogKind = "think" | "tool" | "email" | "reply" | "schedule" | "room" | "pivot" | "insight" | "decision" | "error";
export type LogEntry = { t: number; kind: LogKind; text: string; detail?: string };

export type Assessment = { criterionId: string; score: number; evidence: string; t: number; tieBreaker: boolean; sentiment?: string; observation?: string };

export type Room = {
  candidateId: string;
  status: "waiting" | "live" | "ended";
  conversationId?: string;
  transcript: { role: "agent" | "user"; text: string; t: number }[];
  assessments: Assessment[];
  pending: string[]; // contextual updates waiting to be pushed into the live call
  delivered: number;
  tieBreakersAsked: string[]; // criterion ids
  tieReminded?: string[]; // tie-breakers re-sent through a tool reply
  questionCount: number;
  wrapped: boolean;
  lastInstruction?: string;
  currentQuestion?: string; // latest question Ava asked
  questionChangedAt?: number; // when the panel last swapped this room's question
  sentiment?: string; // latest live read on the candidate
  listening?: boolean; // dashboard is playing this room out loud
};

export type Pivot = { t: number; criterionId: string; reason: string; question: string; separated?: boolean };

export type Decision = {
  ranking: { candidateId: string; total: number; perCriterion: Record<string, number> }[];
  summary: string;
  offers: { candidateId: string; outcome: "pending" | "accepted" | "declined"; t: number }[];
  reasons: string[]; // why the winner won, from interview evidence
  stats: { elapsedMs: number; interviews: number; parallelMinutes: number; sequentialHours: number; pivots: number };
  offerLetter?: string;
};

export type Stage = "draft" | "sourcing" | "sourced" | "outreach" | "scheduled" | "interviewing" | "deciding" | "decided" | "hired";

export type Job = {
  id: string;
  createdAt: number;
  jd: string;
  role?: RoleSpec;
  stage: Stage;
  candidates: Candidate[]; // shortlisted + contacted, in rank order
  backups: Candidate[]; // further search results, used when someone declines
  log: LogEntry[];
  slot?: string;
  rooms: Record<string, Room>;
  pivots: Pivot[];
  decision?: Decision;
  simulateOfferDecline: boolean;
  startedAt?: number; // when the run began
  interviewsStartedAt?: number;
  busy: boolean;
};
