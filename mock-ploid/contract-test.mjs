// Validates mock responses against Ploid's published OpenAPI schemas
// (docs/ploid-openapi.json). Run: npm run test:mock
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { handle } from "./server.mjs";

const spec = JSON.parse(readFileSync(new URL("../docs/ploid-openapi.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: "ploid", components: spec.components });
const schema = (name) => ajv.getSchema(`ploid#/components/schemas/${name}`);
// oneOf run/person schemas reference components; rewrite local refs to the registered doc
const compileInline = (s) => ajv.compile(JSON.parse(JSON.stringify(s).replaceAll('"#/components', '"ploid#/components')));

const H = { authorization: "Bearer test" };
let failures = 0;
function check(label, validate, res, expectStatus) {
  const ok = validate(res.body) && (!expectStatus || res.status === expectStatus);
  if (!ok) {
    failures++;
    console.log(`✗ ${label} (status ${res.status})`);
    console.log(JSON.stringify(validate.errors?.slice(0, 8), null, 2));
  } else console.log(`✓ ${label}`);
  return res.body;
}

const search = schema("SyncSearchResponse");
const err = schema("PublicApiError");
const enrich = schema("EnrichContactResponse");
const credits = schema("AccountCreditsResponse");
const personRun = schema("PersonRunResponse");
const pollSchema = compileInline(spec.paths["/v1/person/runs/{id}"].get.responses["200"].content["application/json"].schema);
const person = schema("PersonResponse");

const s1 = check("search instant", search, await handle("POST", "/v1/search", H, { query: "voice AI engineer", type: "instant", num_results: 5 }), 200);
console.log("   top:", s1.data.results.map((r) => r.person.name).join(", "));
const s2 = check("search auto + criteria + filters", search, await handle("POST", "/v1/search", H, {
  query: "machine learning engineer for realtime voice agents", type: "auto", num_results: 5,
  criteria: ["Has shipped a production voice agent", "Experience reducing latency"],
  filters: { location: { countries: ["Canada", "United States"] } },
  contents: { fields: ["name", "linkedin", "title", "company", "location", "positions", "education"] },
}), 200);
console.log("   top:", s2.data.results.map((r) => r.person.name).join(", "));
check("search fast with offset", search, await handle("POST", "/v1/search", H, { query: "engineer", type: "fast", num_results: 5, offset: 5 }), 200);
check("search deep + past_companies", search, await handle("POST", "/v1/search", H, { query: "engineer", type: "deep", filters: { experience: { past_companies: { any_of: ["Shopwell"] } } } }), 200);
check("search 422 criteria on instant", err, await handle("POST", "/v1/search", H, { query: "x", type: "instant", criteria: ["y"] }), 422);
check("401 without key", err, await handle("POST", "/v1/search", {}, { query: "x" }), 401);

const pid = s2.data.results[0].person.person_id;
const p1 = check("person → 202 run", personRun, await handle("POST", "/v1/person", H, { identifier: { person_id: pid }, include: ["work_email", "phone"] }), 202);
const p2 = check("poll run → completed record", pollSchema, await handle("GET", `/v1/person/runs/${p1.data.run_id}`, H), 200);
check("  record matches PersonResponse", person, { status: 200, body: p2 }, 200);
check("person cached → 200 free", person, await handle("POST", "/v1/person", H, { identifier: { linkedin_url: s2.data.results[0].person.linkedin_url } }), 200);
check("person unknown → unsure", person, await handle("POST", "/v1/person", H, { identifier: { name: "Nobody Atall", company_domain: "nowhere.example" } }), 200);

check("enrich", enrich, await handle("POST", "/v1/enrich", H, { person_id: pid, fields: ["work_email", "personal_email", "phone"] }), 200);
check("enrich 422", err, await handle("POST", "/v1/enrich", H, { fields: ["work_email"] }), 422);
check("account credits", credits, await handle("GET", "/v1/account/credits", H), 200);

console.log(failures ? `\n${failures} contract failure(s)` : "\nAll responses match the Ploid OpenAPI contract.");
process.exit(failures ? 1 : 0);
