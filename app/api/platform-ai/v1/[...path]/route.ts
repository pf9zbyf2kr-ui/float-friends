import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account-auth";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const ALLOWED_POST_PATHS = new Set(["chat/completions"]);

function platformConfig() {
  const baseUrl = (process.env.PLATFORM_AI_BASE_URL || "http://gateway:8787/v1").replace(/\/+$/, "");
  const token = (process.env.PLATFORM_AI_TOKEN || "").trim();
  const model = (process.env.PLATFORM_AI_MODEL || "gpt-5.5").trim();
  return { baseUrl, token, model };
}

async function authorize(request: Request) {
  const account = await getCurrentAccount(request);
  if (!account) return { response: NextResponse.json({ error: { message: "请先登录账号。" } }, { status: 401 }) };
  const config = platformConfig();
  if (!config.token) return { response: NextResponse.json({ error: { message: "平台 AI 尚未配置。" } }, { status: 503 }) };
  return { account, config };
}

function cleanPath(parts: string[]): string | null {
  const path = parts.map((part) => String(part || "").trim()).filter(Boolean).join("/");
  return /^[a-z0-9/_-]+$/i.test(path) ? path : null;
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const auth = await authorize(request);
  if ("response" in auth) return auth.response;
  const path = cleanPath((await context.params).path);
  if (path !== "models") return NextResponse.json({ error: { message: "不支持的接口。" } }, { status: 404 });
  return NextResponse.json({ object: "list", managed: true, data: [{ id: auth.config.model, object: "model", owned_by: "float" }] });
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const auth = await authorize(request);
  if ("response" in auth) return auth.response;
  const path = cleanPath((await context.params).path);
  if (!path || !ALLOWED_POST_PATHS.has(path)) {
    return NextResponse.json({ error: { message: "不支持的接口。" } }, { status: 404 });
  }
  const declaredBytes = Number(request.headers.get("content-length") || 0);
  if (declaredBytes > MAX_REQUEST_BYTES) return NextResponse.json({ error: { message: "请求过大。" } }, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: { message: "请求过大。" } }, { status: 413 });

  const upstream = await fetch(`${auth.config.baseUrl}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.config.token}`,
      "Content-Type": "application/json",
      "x-workload": "conversation.reply",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null as Response | null);
  if (!upstream) return NextResponse.json({ error: { message: "平台 AI 暂时不可用。" } }, { status: 502 });

  const headers = new Headers({ "Cache-Control": "no-store" });
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  return new Response(upstream.body, { status: upstream.status, headers });
}
