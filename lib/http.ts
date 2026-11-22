export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export const notFound = (what = "Not found") => json({ error: what }, 404);
