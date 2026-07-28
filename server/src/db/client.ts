/** Accès libSQL. SQL brut, pas d'ORM (PLAN.md — stack). */

import { createClient, type Client, type InArgs, type Row } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from '../env.js';

function buildClient(): Client {
  const url = env.DATABASE_URL;
  if (url.startsWith('file:')) {
    // Le fichier de base ne peut pas être créé si son dossier n'existe pas.
    mkdirSync(dirname(resolve(url.slice('file:'.length))), { recursive: true });
  }
  return createClient(
    env.DATABASE_AUTH_TOKEN ? { url, authToken: env.DATABASE_AUTH_TOKEN } : { url },
  );
}

export const db: Client = buildClient();

/** Active les contraintes de clés étrangères : SQLite les ignore par défaut. */
export async function initPragmas(): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
}

export async function all<T = Row>(sql: string, args: InArgs = []): Promise<T[]> {
  const result = await db.execute({ sql, args });
  return result.rows as unknown as T[];
}

export async function one<T = Row>(sql: string, args: InArgs = []): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InArgs = []): Promise<void> {
  await db.execute({ sql, args });
}

export async function count(sql: string, args: InArgs = []): Promise<number> {
  const row = await one<{ n: number }>(sql, args);
  return Number(row?.n ?? 0);
}

/** SQLite n'a pas de booléen : conversions explicites aux deux frontières. */
export const toBool = (v: unknown): boolean => v === 1 || v === true || v === '1';
export const fromBool = (v: boolean): number => (v ? 1 : 0);
