"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useAccount } from "@/lib/account-context";
import { createAccountCloudBackupConfig, loadCloudBackupConfig, saveCloudBackupConfig } from "@/lib/cloud-backup/config";
import { listCloudBackups, restoreFromCloudManifest } from "@/lib/cloud-backup/engine";
import { clearModules } from "@/lib/data-management/backup";
import { DATA_MODULES } from "@/lib/data-management/modules";
import { ensureSettingsStorageHydrated, loadApiConfigs, loadBindingConfig, saveApiConfigs, saveBindingConfig } from "@/lib/settings-storage";
import type { ApiConfig } from "@/lib/settings-types";

const LAST_ACCOUNT_KEY = "float_last_local_account_v1";
const READY_PREFIX = "float_account_cloud_ready_v1:";
const PLATFORM_API_ID = "platform-managed";

async function ensurePlatformAiConfig(): Promise<void> {
  await ensureSettingsStorageHydrated();
  const platformConfig: ApiConfig = {
    id: PLATFORM_API_ID,
    name: "Float 平台 AI",
    provider: "Custom",
    apiKey: "platform-session",
    baseUrl: "/api/platform-ai/v1",
    defaultModel: "gpt-5.5",
    enableNativeTools: true,
    enableImageRecognition: false,
    enableImageGeneration: false,
    preventEmptyGenerateRambling: true,
  };
  const existing = loadApiConfigs().filter((config) => config.id !== PLATFORM_API_ID);
  const configs = [platformConfig, ...existing];
  saveApiConfigs(configs);
  const bindings = loadBindingConfig();
  const selectedId = bindings.globalDefaults.apiConfigId;
  const nextId = selectedId && configs.some((config) => config.id === selectedId)
    ? selectedId
    : PLATFORM_API_ID;
  if (nextId !== selectedId) {
    saveBindingConfig({ ...bindings, globalDefaults: { ...bindings.globalDefaults, apiConfigId: nextId } }, false);
  }
}

export function AccountCloudBootstrap({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const [ready, setReady] = useState(account.id === "local_user");
  const [detail, setDetail] = useState("正在准备账号数据…");

  useEffect(() => {
    if (account.id === "local_user") {
      setReady(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      const config = createAccountCloudBackupConfig(account.id);
      const previousAccountId = window.localStorage.getItem(LAST_ACCOUNT_KEY) || "";
      const accountChanged = Boolean(previousAccountId && previousAccountId !== account.id);
      const alreadyReady = window.localStorage.getItem(`${READY_PREFIX}${account.id}`) === "1";

      if (accountChanged) {
        setDetail("正在切换账号数据…");
        await clearModules(DATA_MODULES.map((module) => module.id));
        saveCloudBackupConfig(config);
      } else {
        const existing = loadCloudBackupConfig();
        if (existing.mode !== "account" || existing.managedAccountId !== account.id) saveCloudBackupConfig(config);
      }

      if (!alreadyReady || accountChanged) {
        setDetail("正在检查云端数据…");
        const backups = await listCloudBackups(config);
        const latest = backups.find((item) => !item.error && !item.quarantine);
        if (latest) {
          setDetail("正在恢复云端数据…");
          const result = await restoreFromCloudManifest(config, latest.name, { overwrite: true });
          if (result.errors.length > 0) throw new Error(result.errors[0]);
          await ensurePlatformAiConfig();
          window.localStorage.setItem(LAST_ACCOUNT_KEY, account.id);
          window.localStorage.setItem(`${READY_PREFIX}${account.id}`, "1");
          window.location.reload();
          return;
        }
      }

      await ensurePlatformAiConfig();
      window.localStorage.setItem(LAST_ACCOUNT_KEY, account.id);
      window.localStorage.setItem(`${READY_PREFIX}${account.id}`, "1");
      if (!cancelled) setReady(true);
    })().catch((error) => {
      console.error("[AccountCloudBootstrap] account restore failed", error);
      if (!cancelled) {
        setDetail("云端数据暂时无法读取，本机仍可继续使用");
        window.setTimeout(() => setReady(true), 1400);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [account.id]);

  if (ready) return children;
  return (
    <main className="app-root account-gate-root">
      <section className="account-gate-panel" aria-live="polite">
        <Loader2 className="account-gate-spinner" size={24} />
        <span>{detail}</span>
      </section>
    </main>
  );
}
