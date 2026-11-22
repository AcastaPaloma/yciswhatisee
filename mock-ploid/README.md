# Mock Ploid API

Stand-in for `https://api.ploid.com` while the real API is down. Same paths, same
request validation, same response shapes as the published OpenAPI contract
(`docs/ploid-openapi.json`), backed by 35 fictional candidates in `people.mjs`.

```bash
npm run mock:ploid          # http://localhost:4010
npm run test:mock           # validates every response against the OpenAPI schemas
```

Switch to the real API by changing one env var: `PLOID_BASE_URL=https://api.ploid.com`.

## Simulated endpoints

| Endpoint | Behaviour |
|---|---|
| `POST /v1/search` | Ranks by query words (role phrase weighted highest), applies hard filters (`title`, `company`, `location`, `seniority`, `industry`, `experience.past_companies`, `education.schools`). `auto`/`deep` verify each `criteria` entry against profile evidence and attach `verification[]`; people who fail are dropped. `instant`/`fast` support `offset` paging. |
| `POST /v1/person` | First call returns `202` with a `run_id`; cached people return `200`. Supports `include: ["work_email","personal_email","phone"]`. Unknown people return the `resolution: "unsure"` shape. |
| `GET/DELETE /v1/person/runs/{id}` | `queued` → `running` → full person record after `MOCK_RUN_DELAY_MS` (default 4s). |
| `POST /v1/enrich` | Work email for everyone, personal email for ~70%, phone for ~50%. |
| `GET /v1/account/credits` | Running ACU usage. |
| `GET /mock/people` | Mock-only: the whole pool, with contact info. |

Any non-empty `Authorization: Bearer …` or `x-api-key` is accepted; missing auth returns `401 missing_api_key`.

## Demo tips

- Emails use the reserved `.example` domain so nothing is delivered by accident.
  Set `MOCK_EMAIL_OVERRIDE="you+{slug}@gmail.com"` to send outreach to your own inbox.
- Phone numbers are in the fictional `555-01xx` range.
- `MOCK_LATENCY=0` removes the simulated search latency.
