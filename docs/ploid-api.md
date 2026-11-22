# Ploid API — condensed reference

Source: https://ploid.com/documentation (read 2026-11-22). Full contract: https://api.ploid.com/v1/openapi.json (no auth needed).

## Basics
- Base URL: `https://api.ploid.com/v1`
- Auth: `Authorization: Bearer $PLOID_API_KEY` or `x-api-key: $PLOID_API_KEY`. Key from Workspace settings → API keys (shown once, format `ploid_live_...`).
- Scopes: `people:search`, `people:enrich`, `linkedin:read`, `agent:chat`, `account:read`. Missing scope → `403 insufficient_scope`.
- **Server-side only** — never call from browser JS.
- Success envelope: `{ data, meta: { request_id, ... } }`. Error envelope: `{ error: { code, message, request_id } }`.
- Send `Idempotency-Key: <uuid>` on every POST; reuse only when retrying the identical body.
- Billing unit: ACU (1 ACU ≈ $0.10 face value). Failures / not-found are generally free.

## Rate limits (org bucket; key bucket may be lower)
Free 10/min · PAYG 30/min · API Pro/Starter/Pro 300/min · Scale/Teams 1,000/min.
`/v1/socials` and `/v1/linkedin/*`: 60/min, 600/hr. 429s carry `Retry-After`; responses carry `RateLimit-*` headers.

## Endpoints

### Person — `POST /v1/person` (people:enrich)
Evidence-backed research report on one person.
```json
{ "identifier": { "linkedin_url": "..." } }          // or { "person_id": "..." } or { "name": "...", "company_domain": "..." }
  "type": "deep" | "standard",                          // 25 ACU | 10 ACU, free rereads for 90 days
  "include": ["work_email","personal_email","phone"],   // optional, billed per found
  "goal": "...", "website_url": "https://...", "anchors": ["https://..."]  // optional; forces fresh research
```
- `200` = cached reviewed snapshot. `202` = `{ run_id, status: "queued", poll_url }` → poll `GET /v1/person/runs/{id}` (takes ~2 min, up to 15). Cancel: `DELETE /v1/person/runs/{id}`. Runs expire after 7 days (`410`).
- Result: `summary`, `source_links[]`, `identity`, `professional.{current,history,education}`, `presence.platforms[]`, `signals.interests[]`, `research.publications/patents`, `work.open_source`, `media.appearances`, `provenance`.
- Ambiguous person → `200` with `data: null`, `meta.resolution: "unsure"`, `suggested_clues`.

### Search — `POST /v1/search` (people:search)
Synchronous people search, up to 150 results.
```json
{ "query": "software engineers at fintech in SF", "type": "instant|fast|auto|deep",
  "num_results": 25, "offset": 0,
  "filters": { "title": "...", "company": "...", "location": "...", "seniority": "senior", "industry": "fintech" },
  "criteria": ["Has founded a venture-backed company"],  // ≤5, auto/deep only
  "contents": { "fields": ["linkedin","title","company","location"] },
  "freshness": { "max_age_days": 2 } }                    // auto/deep only
```
- Filters accept a value or `{ any_of, none_of }`. Evidence-verified filters (auto/deep only): `company.employee_count`, `company.funding_stage`, `experience.past_companies`, `education.schools`.
- `instant`/`fast` = index only, pageable via `offset`/`meta.next_offset`. `auto`/`deep` = verified (≤60s / ≤120s).
- Results include `person.person_id` (feed to `/v1/person`); contacts excluded (`contact_status: "requires_enrichment"`).
- `num_results > 150` or `async: true` → `202` and a background Set (see Sets).

### Enrich — `POST /v1/enrich` (people:enrich)
Contact info. Identify with exactly one of `linkedin_url`, `person_id`, `email`, or `name`+`company_domain`.
```json
{ "linkedin_url": "...", "fields": ["work_email","personal_email","phone"] }
```
Each field → `{ value, status: found|not_found|unavailable, confidence, source, last_seen }`. Price per found: work_email 1, personal_email 3, phone 10 ACU. `unavailable` + `Retry-After: 30` = still looking up; retry with a new Idempotency-Key.

### Socials — `POST /v1/socials` (people:enrich)
`{ "platform": "linkedin|x|instagram|tiktok|youtube|github|reddit|facebook", "identifier": "handle or URL" }` → full public profile.
LinkedIn reads (linkedin:read): `GET /v1/linkedin/profile?url=...`, `POST /v1/linkedin/search`, `GET /v1/linkedin/posts?identifier=...&limit=10`.

### Datasets — `POST /v1/datasets` (people:search)
Fill columns for rows you already have. `entity.type`: person | company | custom. 1–25 rows sync (`deadline_ms` ≤60s), ≤2,000 with `mode: "async"`; 1–30 columns.
- Company columns: name, domain, description, founded_year, headquarters, headcount, industry, linkedin_url, page_text, socials.*
- Person columns: name, title, company, location, email.work, email.personal, phone, website, socials.*
- Custom: `{ "key": "custom.hobbies", "description": "...", "format": "text|number|date|boolean|..." }` (person research columns → use async).
- Each cell: `{ value, confidence 0..1, status: found|unverified|not_found|timeout, evidence[] }`. Pay only for found cells.
- Async: poll `GET /v1/datasets/{id}`, page `GET /v1/datasets/{id}/rows`.

### Sets (preview) — `POST /v1/sets` (people:search)
Durable, verified people lists built in the background.
`{ "search": { "query": "...", "count": 25, "filters": {...}, "criteria": [...] }, "budget": { "credits": 5 } }`
Routes: `GET /v1/sets`, `GET /v1/sets/{id}`, `GET /v1/sets/{id}/items?status=admitted`, `GET /v1/sets/{id}/events` (SSE), `GET /v1/sets/{id}/export` (CSV or `?format=json`), `POST /v1/sets/{id}/cancel`. 1 ACU per 10 admitted.

### GitHub search (beta) — `POST /v1/github/search` (people:search)
Filters: `query, login, company, repo, repo_owner, language, min_commits, min_merged_pull_requests, active_since, hireable, sort, limit, offset, include_profiles`. 1 ACU + 1 per live profile.
`POST /v1/github/people-search` links GitHub accounts to LinkedIn, with `linkedin` filters.

### Monitors — `POST /v1/monitors` (people:search)
`{ "query": "New LinkedIn posts from Nvidia about AI chips", "schedule": { "preset": "daily" }, "webhook_url": "...", "webhook_secret": "..." }`
Watches linkedin/x/instagram/tiktok. Also `/compile`, `PATCH`, `/run`, `/test`, `/runs`, `/items`. 1 ACU per create, plus per-target fetch and per emitted item.

### Technographics (beta, Scale/Custom plans only) — `POST /v1/technographics`
`{ "domain": "acme.com" }` → detected tech stack with evidence. 1 credit per domain.

### Account
`GET /v1/account/credits`, `GET /v1/account/usage`, `DELETE /v1/account/key` (revokes the calling key).

## Other surfaces
- CLI: `curl https://ploid.com/install -fsS | bash`, `ploid login`, `ploid search "..."`, `ploid enrich <linkedin> --fields work_email`, `ploid --json ...`
- MCP: `https://api.ploid.com/mcp` (OAuth). Tools: `search_people`, `research_person`, `find_people`, `find_decision_makers`, `get_research_status`, `cancel_research`.
