import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqliteUserRecord = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type RegistrationInput = SqliteUserRecord & {
  activated_at: string;
  last_login_at: string;
};

let database: DatabaseSync | null = null;
let databasePath = "";

export function getAccountSqlitePath(): string {
  return (process.env.ACCOUNT_SQLITE_PATH || "").trim();
}

export function isAccountSqliteConfigured(): boolean {
  return Boolean(getAccountSqlitePath());
}

function db(): DatabaseSync {
  const filename = getAccountSqlitePath();
  if (!filename) throw new Error("ACCOUNT_SQLITE_PATH is not configured");
  if (database && databasePath === filename) return database;
  mkdirSync(path.dirname(filename), { recursive: true });
  const next = new DatabaseSync(filename);
  next.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  next.exec(`
    create table if not exists app_users (
      id text primary key,
      username text not null unique,
      password_hash text not null,
      display_name text not null,
      status text not null default 'active',
      activated_at text,
      last_login_at text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists activation_codes (
      code text primary key,
      label text,
      status text not null default 'active',
      max_uses integer not null default 1,
      used_count integer not null default 0,
      last_used_by text,
      last_used_at text,
      expires_at text,
      created_at text not null,
      updated_at text not null
    );
    create table if not exists app_sessions (
      token_hash text primary key,
      user_id text not null references app_users(id) on delete cascade,
      user_agent text,
      expires_at text not null,
      created_at text not null,
      last_seen_at text not null
    );
    create index if not exists app_sessions_user_idx on app_sessions(user_id, expires_at desc);
    create index if not exists app_sessions_expires_idx on app_sessions(expires_at);
  `);
  database = next;
  databasePath = filename;
  return next;
}

export function sqliteFindUserByUsername(username: string): SqliteUserRecord | null {
  return (db().prepare("select * from app_users where username = ? limit 1").get(username) as SqliteUserRecord | undefined) ?? null;
}

export function sqliteFindUserById(id: string): SqliteUserRecord | null {
  return (db().prepare("select * from app_users where id = ? limit 1").get(id) as SqliteUserRecord | undefined) ?? null;
}

export function sqliteCreateUser(input: RegistrationInput): SqliteUserRecord {
  try {
    db().prepare(`
      insert into app_users
        (id, username, password_hash, display_name, status, activated_at, last_login_at, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.username,
      input.password_hash,
      input.display_name,
      input.status,
      input.activated_at,
      input.last_login_at,
      input.created_at,
      input.updated_at,
    );
  } catch (error) {
    if (/unique constraint failed: app_users\.username/i.test(String(error))) throw new Error("username_taken");
    throw error;
  }
  return sqliteFindUserById(input.id)!;
}

export function sqliteRegisterWithCode(input: RegistrationInput & { activationCode: string }): SqliteUserRecord {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const code = database.prepare("select * from activation_codes where code = ? limit 1").get(input.activationCode) as Record<string, unknown> | undefined;
    if (!code) throw new Error("activation_code_not_found");
    if (code.status !== "active") throw new Error("activation_code_disabled");
    if (typeof code.expires_at === "string" && Date.parse(code.expires_at) <= Date.now()) throw new Error("activation_code_expired");
    if (Number(code.used_count) >= Number(code.max_uses)) throw new Error("activation_code_exhausted");
    const user = sqliteCreateUser(input);
    database.prepare(`
      update activation_codes
      set used_count = used_count + 1, last_used_by = ?, last_used_at = ?, updated_at = ?
      where code = ?
    `).run(input.id, input.activated_at, input.updated_at, input.activationCode);
    database.exec("COMMIT");
    return user;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function sqliteValidateActivationCode(code: string): Record<string, unknown> {
  const row = db().prepare("select * from activation_codes where code = ? limit 1").get(code) as Record<string, unknown> | undefined;
  if (!row) throw new Error("激活码不存在。");
  if (row.status !== "active") throw new Error("激活码不可用。");
  if (Number(row.used_count) >= Number(row.max_uses)) throw new Error("激活码已被使用完。");
  if (typeof row.expires_at === "string" && Date.parse(row.expires_at) <= Date.now()) throw new Error("激活码已过期。");
  return row;
}

export function sqliteMarkActivationCodeUsed(code: string, userId: string, now: string): void {
  sqliteValidateActivationCode(code);
  db().prepare("update activation_codes set used_count = used_count + 1, last_used_by = ?, last_used_at = ?, updated_at = ? where code = ?")
    .run(userId, now, now, code);
}

export function sqliteUpdatePassword(userId: string, passwordHash: string, now: string): void {
  db().prepare("update app_users set password_hash = ?, updated_at = ? where id = ?").run(passwordHash, now, userId);
}

export function sqliteTouchLogin(userId: string, now: string): void {
  db().prepare("update app_users set last_login_at = ?, updated_at = ? where id = ?").run(now, now, userId);
}

export function sqliteCreateSession(input: {
  tokenHash: string;
  userId: string;
  userAgent: string;
  expiresAt: string;
  now: string;
}): void {
  db().prepare(`
    insert into app_sessions (token_hash, user_id, user_agent, expires_at, created_at, last_seen_at)
    values (?, ?, ?, ?, ?, ?)
  `).run(input.tokenHash, input.userId, input.userAgent, input.expiresAt, input.now, input.now);
}

export function sqliteDeleteSession(tokenHash: string): void {
  db().prepare("delete from app_sessions where token_hash = ?").run(tokenHash);
}

export function sqliteGetCurrentAccount(tokenHash: string, now: string, touchBefore: string): SqliteUserRecord | null {
  const row = db().prepare(`
    select u.*
    from app_sessions s
    join app_users u on u.id = s.user_id
    where s.token_hash = ? and s.expires_at > ? and u.status = 'active'
    limit 1
  `).get(tokenHash, now) as SqliteUserRecord | undefined;
  if (!row) return null;
  db().prepare("update app_sessions set last_seen_at = ? where token_hash = ? and last_seen_at <= ?")
    .run(now, tokenHash, touchBefore);
  return row;
}
