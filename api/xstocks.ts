export const config = { runtime: "edge" };

const upstream = "https://api.xstocks.fi/api/v2/public";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  }

  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const page = Number(url.searchParams.get("page") ?? "0");
  if (!symbol && (!Number.isInteger(page) || page < 0 || page > 20)) {
    return new Response("Invalid page", { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const upstreamUrl = symbol
      ? `${upstream}/assets/${encodeURIComponent(symbol)}`
      : `${upstream}/assets?page=${page}`;
    const response = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "public, max-age=60, s-maxage=300",
      },
    });
  } catch {
    return new Response("xStocks registry unavailable", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
