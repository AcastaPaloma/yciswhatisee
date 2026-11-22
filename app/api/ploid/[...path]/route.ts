// Exposes the in-process mock Ploid API over HTTP at /api/ploid/v1/... for debugging.
import { handle } from "@/mock-ploid/server.mjs";

export const dynamic = "force-dynamic";

async function proxy(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = "/" + (await params).path.join("/");
  const body = req.method === "GET" || req.method === "DELETE" ? {} : await req.json().catch(() => ({}));
  const out = await handle(req.method, path, Object.fromEntries(req.headers), body);
  return Response.json(out.body, { status: out.status });
}
export { proxy as GET, proxy as POST, proxy as DELETE };
