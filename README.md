# Panel: the hiring agent that interviews every finalist at once

Paste a job posting. Panel extracts what the role needs, sources candidates from
**Ploid's** 2-billion-person index, reaches out, books every finalist into the
same slot, and interviews them **simultaneously** in voice breakout rooms run by
**ElevenLabs** agents. It keeps going (offers, declines, next candidate) until
the role is filled.

## Why simultaneous interviews

Interviews usually happen one at a time, in rounds. If every candidate is
excellent at X, nobody finds out until the round is over, so every interviewer
keeps spending time on a question that can't separate anyone.

Panel runs all the rooms at once. A head-of-panel orchestrator sees every score
the moment it is given. When a criterion stops separating candidates (everyone
scores 4+), it **pivots live**: it pushes a harder tie-breaker question into
every room. The dashboard shows when that question separates the candidates.

## How it works

```
Job posting ─► role spec (criteria + tie-breaker questions)
           ─► Ploid  POST /v1/search   (verified against the top criteria)
                     POST /v1/person   (research report per candidate)
                     POST /v1/enrich   (work email)
           ─► outreach + replies + common slot   (simulated)
           ─► one breakout room per finalist
                 ElevenLabs interviewer "Ava" (Claude Sonnet 5.5 on ElevenLabs Agents)
                   └─ calls client tool submit_assessment(criterion, score, evidence)
                        └─► panel orchestrator ─► next instruction (tool reply)
                                                 └► PANEL UPDATEs into other rooms (contextual updates)
           ─► ranking ─► offer ─► (declined? next candidate) ─► hired
```

| Piece | Where |
|---|---|
| Autonomous pipeline (source → outreach → schedule → decide → offer loop) | `lib/agent.ts` |
| Panel orchestrator (saturation detection, pivots, tie-breakers, wrap-up) | `lib/panel.ts` |
| Candidate breakout room (WebRTC voice, client tool, contextual updates) | `app/room/[jobId]/[candId]/page.tsx` |
| Dashboard (activity feed, live score grid, pivots, decision) | `app/page.tsx` |
| Simulated candidates (a second ElevenLabs agent plays the candidate) | `lib/simulate.ts` |
| Role extraction (Claude if `ANTHROPIC_API_KEY` is set, otherwise a parser) | `lib/extract.ts` |
| Ploid client (live API or the in-process mock) | `lib/ploid.ts` |
| Mock Ploid API, contract-tested against Ploid's OpenAPI spec | `mock-ploid/` |
| ElevenLabs agent + tool provisioning | `scripts/setup-elevenlabs-agent.mjs` |

## Run it

```bash
npm install
cp .env.example .env          # add ELEVENLABS_API_KEY
npm run setup:agent           # creates the interviewer, its tool, and the candidate-simulator agent
npm run dev                   # http://localhost:3100
```

1. Click **Start hiring** (a sample posting is prefilled). Watch the agent source, research, email, and book a panel.
2. Open each candidate's room link (**open** / **copy link**) on a separate device and click **Start interview**.
   Or click **Simulate candidates** to fill empty rooms with AI candidates played by a second ElevenLabs agent.
3. Watch scores and pivots land in the live grid. Hover a cell for the evidence.
4. Click **End interviews & decide**. With "First offer gets declined" on, the agent moves to the next candidate until someone accepts.

**Teammates on other laptops:** browsers only allow the microphone on HTTPS or localhost. Run `npm run tunnel`
(Cloudflare quick tunnel) and share the `https://…trycloudflare.com` room links. Anyone with the link can start
interviews on your ElevenLabs credits, so close the tunnel after the demo.

## Ploid: live or mock

Ploid's API was down during the hackathon, so `mock-ploid/` reproduces its published contract
(`docs/ploid-openapi.json`) with 35 fictional people. `npm run test:mock` validates every mock response against
the official OpenAPI schemas. Set `PLOID_BASE_URL=https://api.ploid.com` and `PLOID_API_KEY` to switch to the real API;
nothing else changes.

## Checks

```bash
npm run test:mock                                   # mock Ploid responses match the OpenAPI contract
npm run test:interview -- <jobId> <candidateId>     # real ElevenLabs interviewer in text mode, scripted candidate
npx tsc --noEmit
```
