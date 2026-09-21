export const config = { runtime: "edge" };

const upstream = process.env.SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const response = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
