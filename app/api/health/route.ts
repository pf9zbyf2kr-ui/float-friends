import { NextResponse } from "next/server";

import { isAccountStorageConfigured } from "@/lib/server/account-auth";

export async function GET() {
  return NextResponse.json({
    ok: true,
    accountStorage: isAccountStorageConfigured(),
    cloudStorage: Boolean((process.env.ACCOUNT_STORAGE_ROOT || "").trim() || process.env.SUPABASE_URL),
  }, {
    status: isAccountStorageConfigured() ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
