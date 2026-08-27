import { NextResponse } from "next/server";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import pathModule from "node:path";
import crypto from "node:crypto";

import { getCurrentAccount } from "@/lib/server/account-auth";
import { formatSupabaseRestError, getSupabaseServerConfig } from "@/lib/server/supabase-rest";

export const runtime = "nodejs";

const BUCKET = "float-account-backups";
const MAX_OBJECT_BYTES = 41 * 1024 * 1024;
const MAX_PATH_LENGTH = 700;

type StorageRow = {
  name?: unknown;
  updated_at?: unknown;
  metadata?: { size?: unknown } | null;
};

function cleanPath(value: unknown, allowEmpty = false): string | null {
  const path = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) return allowEmpty ? "" : null;
  if (path.length > MAX_PATH_LENGTH || path.includes("\\") || path.includes("\u0000")) return null;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return path;
}

function encodeObjectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function storageHeaders(key: string, contentType?: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

async function context(request: Request) {
  const account = await getCurrentAccount(request);
  if (!account) return { response: NextResponse.json({ error: "请先登录账号。" }, { status: 401 }) };
  const localRoot = (process.env.ACCOUNT_STORAGE_ROOT || "").trim();
  const config = getSupabaseServerConfig();
  if (!localRoot && !config) return { response: NextResponse.json({ error: "账号云存储尚未配置。" }, { status: 503 }) };
  return { config, account, localRoot };
}

function localObjectPath(root: string, accountId: string, objectPath: string): string {
  const accountRoot = pathModule.resolve(root, accountId);
  const target = pathModule.resolve(accountRoot, objectPath);
  if (target !== accountRoot && !target.startsWith(`${accountRoot}${pathModule.sep}`)) throw new Error("对象路径越界。");
  return target;
}

async function ensureBucket(url: string, key: string): Promise<Response | null> {
  const response = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: storageHeaders(key, "application/json"),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_OBJECT_BYTES }),
    cache: "no-store",
  });
  if (response.ok || response.status === 409) return null;
  const text = await response.text().catch(() => "");
  if (/already exists|duplicate|resource already exists/i.test(text)) return null;
  return new Response(text || response.statusText, { status: response.status });
}

export async function GET(request: Request) {
  try {
    const ctx = await context(request);
    if ("response" in ctx) return ctx.response;
    const path = cleanPath(new URL(request.url).searchParams.get("path"));
    if (!path) return NextResponse.json({ error: "对象路径无效。" }, { status: 400 });
    if (ctx.localRoot) {
      try {
        const filename = localObjectPath(ctx.localRoot, ctx.account.id, path);
        const [data, info] = await Promise.all([readFile(filename), stat(filename)]);
        return new Response(data, {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/octet-stream",
            "Content-Length": String(info.size),
          },
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "Object not found" }, { status: 404 });
        throw error;
      }
    }
    const fullPath = `${ctx.account.id}/${path}`;
    const upstream = await fetch(`${ctx.config!.url}/storage/v1/object/${BUCKET}/${encodeObjectPath(fullPath)}`, {
      headers: storageHeaders(ctx.config!.key),
      cache: "no-store",
    });
    if (!upstream.ok) return new Response(await upstream.text().catch(() => ""), { status: upstream.status });
    const headers = new Headers({ "Cache-Control": "no-store" });
    const contentType = upstream.headers.get("Content-Type");
    const contentLength = upstream.headers.get("Content-Length");
    if (contentType) headers.set("Content-Type", contentType);
    if (contentLength) headers.set("Content-Length", contentLength);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return NextResponse.json({ error: formatSupabaseRestError(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await context(request);
    if ("response" in ctx) return ctx.response;
    const path = cleanPath(new URL(request.url).searchParams.get("path"));
    if (!path) return NextResponse.json({ error: "对象路径无效。" }, { status: 400 });
    const declaredBytes = Number(request.headers.get("content-length") || 0);
    if (declaredBytes > MAX_OBJECT_BYTES) return NextResponse.json({ error: "对象超过上传上限。" }, { status: 413 });
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_OBJECT_BYTES) return NextResponse.json({ error: "对象超过上传上限。" }, { status: 413 });
    if (ctx.localRoot) {
      const filename = localObjectPath(ctx.localRoot, ctx.account.id, path);
      await mkdir(pathModule.dirname(filename), { recursive: true });
      const temporary = `${filename}.upload-${crypto.randomUUID()}`;
      try {
        await writeFile(temporary, Buffer.from(body));
        await rename(temporary, filename);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return new Response(null, { status: 204 });
    }
    const bucketError = await ensureBucket(ctx.config!.url, ctx.config!.key);
    if (bucketError) return bucketError;
    const fullPath = `${ctx.account.id}/${path}`;
    const upstream = await fetch(`${ctx.config!.url}/storage/v1/object/${BUCKET}/${encodeObjectPath(fullPath)}`, {
      method: "POST",
      headers: { ...storageHeaders(ctx.config!.key, request.headers.get("content-type") || "application/octet-stream"), "x-upsert": "true" },
      body,
      cache: "no-store",
    });
    if (!upstream.ok) return new Response(await upstream.text().catch(() => ""), { status: upstream.status });
    return new Response(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: formatSupabaseRestError(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await context(request);
    if ("response" in ctx) return ctx.response;
    const path = cleanPath(new URL(request.url).searchParams.get("path"));
    if (!path) return NextResponse.json({ error: "对象路径无效。" }, { status: 400 });
    if (ctx.localRoot) {
      try {
        await unlink(localObjectPath(ctx.localRoot, ctx.account.id, path));
        return new Response(null, { status: 204 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "Object not found" }, { status: 404 });
        throw error;
      }
    }
    const fullPath = `${ctx.account.id}/${path}`;
    const upstream = await fetch(`${ctx.config!.url}/storage/v1/object/${BUCKET}/${encodeObjectPath(fullPath)}`, {
      method: "DELETE",
      headers: storageHeaders(ctx.config!.key),
      cache: "no-store",
    });
    if (!upstream.ok) return new Response(await upstream.text().catch(() => ""), { status: upstream.status });
    return new Response(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: formatSupabaseRestError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await context(request);
    if ("response" in ctx) return ctx.response;
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (input.action === "ensure") {
      if (ctx.localRoot) {
        await mkdir(localObjectPath(ctx.localRoot, ctx.account.id, ""), { recursive: true });
        return NextResponse.json({ ok: true });
      }
      const bucketError = await ensureBucket(ctx.config!.url, ctx.config!.key);
      return bucketError ?? NextResponse.json({ ok: true });
    }
    if (input.action !== "list") return NextResponse.json({ error: "不支持的操作。" }, { status: 400 });
    const prefix = cleanPath(input.prefix, true);
    if (prefix === null) return NextResponse.json({ error: "对象前缀无效。" }, { status: 400 });
    const limit = Math.min(2000, Math.max(1, Math.round(Number(input.limit) || 100)));
    if (ctx.localRoot) {
      const directory = localObjectPath(ctx.localRoot, ctx.account.id, prefix);
      try {
        const entries = (await readdir(directory, { withFileTypes: true }))
          .filter((entry) => !entry.name.includes(".upload-"))
          .slice(0, limit);
        const rows = await Promise.all(entries.map(async (entry) => {
          const info = await stat(pathModule.join(directory, entry.name));
          return { name: entry.isDirectory() ? `${entry.name}/` : entry.name, size: entry.isDirectory() ? 0 : info.size, updated_at: info.mtime.toISOString() };
        }));
        return NextResponse.json(rows.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json([]);
        throw error;
      }
    }
    const bucketError = await ensureBucket(ctx.config!.url, ctx.config!.key);
    if (bucketError) return bucketError;
    const accountPrefix = prefix ? `${ctx.account.id}/${prefix}` : ctx.account.id;
    const upstream = await fetch(`${ctx.config!.url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: storageHeaders(ctx.config!.key, "application/json"),
      body: JSON.stringify({ prefix: accountPrefix, limit, offset: 0, sortBy: { column: "name", order: "asc" } }),
      cache: "no-store",
    });
    if (!upstream.ok) return new Response(await upstream.text().catch(() => ""), { status: upstream.status });
    const rows = await upstream.json().catch(() => []) as StorageRow[];
    return NextResponse.json((Array.isArray(rows) ? rows : []).map((row) => ({
      name: String(row.name ?? ""),
      size: Number(row.metadata?.size ?? 0),
      updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
    })).filter((row) => row.name));
  } catch (error) {
    return NextResponse.json({ error: formatSupabaseRestError(error) }, { status: 500 });
  }
}
