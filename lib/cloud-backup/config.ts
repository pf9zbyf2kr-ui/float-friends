import { kvGet, kvSet, registerKvMigration } from "../kv-db";

/** Fixed bucket name — users never type this; the app auto-creates it via the service_role key. */
export const CLOUD_BACKUP_BUCKET = "ai-phone-backup";

const CLOUD_BACKUP_CONFIG_KEY = "ai_phone_cloud_backup_config_v1";
registerKvMigration(CLOUD_BACKUP_CONFIG_KEY);

export type CloudBackupConfig = {
  /** Personal projects talk to Supabase directly; account backups use the signed-in server proxy. */
  mode?: "personal" | "account";
  /** User's Supabase project URL, e.g. https://xxxx.supabase.co */
  url: string;
  /** User's Supabase service_role key (needed to auto-create the bucket). */
  key: string;
  /** Auto-backup on/off (engine wired in a later step). */
  enabled: boolean;
  /** Auto-backup interval in hours. */
  intervalHours: number;
  /** How many healthy backups to keep (rolling). */
  keepCount: number;
  /** Strip images/multimedia from backups (local + cloud) to keep them small. */
  excludeMedia: boolean;
  /** Project provisioned by AI Phone. Old/manual configs deliberately have no marker. */
  managedProjectRef?: string;
  /** Organization selected by the user when the managed project was created. */
  managedOrganizationSlug?: string;
  /** Binds local scheduler state to the account that enabled managed backup. */
  managedAccountId?: string;
};

export const DEFAULT_CLOUD_BACKUP_CONFIG: CloudBackupConfig = {
  mode: "personal",
  url: "",
  key: "",
  enabled: false,
  intervalHours: 6,
  keepCount: 3,
  excludeMedia: true,
};

/** Strip trailing slashes; tolerate a pasted URL with or without protocol. */
export function normalizeBackupUrl(url: string): string {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function loadCloudBackupConfig(): CloudBackupConfig {
  try {
    const raw = kvGet(CLOUD_BACKUP_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CLOUD_BACKUP_CONFIG };
    const parsed = JSON.parse(raw) as Partial<CloudBackupConfig>;
    return {
      url: typeof parsed.url === "string" ? parsed.url : "",
      key: typeof parsed.key === "string" ? parsed.key : "",
      mode: parsed.mode === "account" ? "account" : "personal",
      enabled: Boolean(parsed.enabled),
      intervalHours: clampInterval(parsed.intervalHours),
      keepCount: clampKeepCount(parsed.keepCount),
      excludeMedia: parsed.excludeMedia !== false,
      managedProjectRef: typeof parsed.managedProjectRef === "string" ? parsed.managedProjectRef : undefined,
      managedOrganizationSlug: typeof parsed.managedOrganizationSlug === "string" ? parsed.managedOrganizationSlug : undefined,
      managedAccountId: typeof parsed.managedAccountId === "string" ? parsed.managedAccountId : undefined,
    };
  } catch {
    return { ...DEFAULT_CLOUD_BACKUP_CONFIG };
  }
}

export function saveCloudBackupConfig(config: CloudBackupConfig): void {
  const accountManaged = config.mode === "account";
  kvSet(CLOUD_BACKUP_CONFIG_KEY, JSON.stringify({
    ...config,
    mode: accountManaged ? "account" : "personal",
    url: accountManaged ? "" : normalizeBackupUrl(config.url),
    key: accountManaged ? "" : (config.key || "").trim(),
    intervalHours: clampInterval(config.intervalHours),
    keepCount: clampKeepCount(config.keepCount),
    excludeMedia: config.excludeMedia !== false,
  }));
}

export function isCloudBackupConfigured(config: CloudBackupConfig): boolean {
  if (config.mode === "account") return true;
  return Boolean(normalizeBackupUrl(config.url) && config.key.trim());
}

export function isAccountCloudBackup(config: CloudBackupConfig): boolean {
  return config.mode === "account";
}

export function createAccountCloudBackupConfig(accountId: string): CloudBackupConfig {
  return {
    ...DEFAULT_CLOUD_BACKUP_CONFIG,
    mode: "account",
    enabled: true,
    intervalHours: 1,
    keepCount: 3,
    excludeMedia: false,
    managedAccountId: accountId,
  };
}

function clampInterval(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CLOUD_BACKUP_CONFIG.intervalHours;
  // Floor at 0.5h to avoid hammering; cap at a week.
  return Math.min(168, Math.max(0.5, n));
}

function clampKeepCount(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_CLOUD_BACKUP_CONFIG.keepCount;
  return Math.min(5, Math.max(2, n));
}
