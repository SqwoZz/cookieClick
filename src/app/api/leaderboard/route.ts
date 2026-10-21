import { promises as fs } from "node:fs";
import path from "node:path";

import { ADMIN_PASSWORD } from "@/lib/admin";
import { validateDisplayName } from "@/lib/name-filter";

export const dynamic = "force-dynamic";

// File-backed shared storage. Good enough for the preview: all visitors of this
// deployment see the same board, data survives server restarts. On serverless
// hosts with ephemeral disks it would need a real database instead.
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "leaderboard.json");
const MAX_ENTRIES = 100;
const TOP_LISTED = 50;
const MAX_NAME_LENGTH = 24;
const MAX_SCORE = 1e15;

export type LeaderboardEntry = {
  name: string;
  score: number;
  updatedAt: string;
};

// Simple flood guard: max 5 submissions per 10 seconds per client.
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 5;
const recentPosts = new Map<string, number[]>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "local";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const stamps = (recentPosts.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (stamps.length >= RATE_MAX) {
    recentPosts.set(key, stamps);
    return true;
  }
  stamps.push(now);
  recentPosts.set(key, stamps);
  return false;
}

function sanitizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

function sanitizeScore(value: unknown): number | null {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0) return null;
  return Math.min(Math.floor(score), MAX_SCORE);
}

function sanitizeEntry(raw: unknown): LeaderboardEntry | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const name = sanitizeName(source.name);
  const score = sanitizeScore(source.score);
  // Stored entries with disallowed names are dropped on read too, so the
  // board self-cleans.
  if (!name || score === null || !validateDisplayName(name).ok) return null;
  const updatedAt = new Date(source.updatedAt as string | number);
  return {
    name,
    score,
    updatedAt: Number.isNaN(updatedAt.getTime())
      ? ""
      : updatedAt.toISOString(),
  };
}

async function readEntries(): Promise<LeaderboardEntry[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: LeaderboardEntry[] = [];
    for (const item of parsed) {
      const entry = sanitizeEntry(item);
      if (entry) entries.push(entry);
    }
    return entries;
  } catch {
    // Missing or corrupted file — start with an empty board.
    return [];
  }
}

async function writeEntries(entries: LeaderboardEntry[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}

function sortEntries(entries: LeaderboardEntry[]): void {
  entries.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru")
  );
}

export async function GET() {
  const entries = await readEntries();
  sortEntries(entries);
  return Response.json({
    entries: entries.slice(0, TOP_LISTED),
    total: entries.length,
  });
}

export async function POST(request: Request) {
  if (isRateLimited(clientKey(request))) {
    return Response.json(
      { error: "Слишком часто. Подождите немного." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;
  const name = sanitizeName(source.name);
  const score = sanitizeScore(source.score);
  if (!name || score === null) {
    return Response.json(
      { error: "Нужны имя и корректный счёт" },
      { status: 400 }
    );
  }
  const check = validateDisplayName(name);
  if (!check.ok) {
    return Response.json({ error: check.error }, { status: 400 });
  }

  const entries = await readEntries();
  const key = name.toLowerCase();
  const existing = entries.find((entry) => entry.name.toLowerCase() === key);
  if (existing) {
    // Keep the personal best, never lower an existing result.
    if (score > existing.score) {
      existing.score = score;
      existing.updatedAt = new Date().toISOString();
    }
  } else {
    entries.push({ name, score, updatedAt: new Date().toISOString() });
  }
  sortEntries(entries);
  const rank = entries.findIndex((entry) => entry.name.toLowerCase() === key) + 1;
  await writeEntries(entries.slice(0, MAX_ENTRIES));

  return Response.json({ ok: true, rank: rank > 0 ? rank : null });
}

export async function DELETE(request: Request) {
  const password = request.headers.get("x-admin-password");
  if (password !== ADMIN_PASSWORD) {
    return Response.json({ error: "Неверный пароль" }, { status: 403 });
  }
  await writeEntries([]);
  return Response.json({ ok: true });
}
