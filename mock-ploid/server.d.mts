export function handle(
  method: string,
  path: string,
  headers?: Record<string, string | string[] | undefined>,
  body?: unknown,
): Promise<{ status: number; body: any; headers?: Record<string, string> }>;
export function route(...args: Parameters<typeof handle>): ReturnType<typeof handle>;
export function createServer(): import("node:http").Server;
