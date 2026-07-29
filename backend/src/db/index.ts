import pg from 'pg';
import {config} from '../config.js';
import {logger} from '../lib/logger.js';

// Postgres NUMERIC(78,0) is how we store uint256. `pg` hands those back as strings by default, which
// is exactly what we want — parsing them as JS numbers would silently lose precision on any value
// above 2^53, i.e. on every wei-denominated amount. Assert the parser stays untouched.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

/**
 * Minimal surface the rest of the backend uses. Both drivers below implement it.
 */
export interface Database {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{rows: T[]}>;
  connect(): Promise<Client>;
  end(): Promise<void>;
}

export interface Client {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{rows: T[]}>;
  release(): void;
}

/**
 * Embedded Postgres for local development.
 *
 * `DATABASE_URL=pglite://<dir>` runs a real Postgres compiled to WebAssembly, in-process, storing to
 * a local directory. It exists so `npm run dev` works with no Docker, no server and no setup — the
 * point being that a contributor can run the whole system end to end in one command.
 *
 * It is NOT for production, and `config.ts` rejects it there. Two reasons beyond performance: it is a
 * single connection, so the Postgres advisory locks that keep the indexer and reconciler singleton
 * degrade to no-ops (harmless with one worker, wrong with several); and a WASM database on a
 * container's local disk is not where money state belongs.
 */
async function createPglite(dir: string): Promise<Database> {
  const {PGlite} = await import('@electric-sql/pglite');
  const {mkdirSync} = await import('node:fs');
  // PGlite's node filesystem layer does a non-recursive mkdir, so a nested path fails on a fresh
  // checkout. Create the parents ourselves.
  mkdirSync(dir, {recursive: true});
  const db = await PGlite.create(dir);
  logger.warn({dir}, 'using EMBEDDED Postgres (PGlite) — development only');

  const run = async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []) => {
    // PGlite has no multi-statement `query`, but migrations arrive as whole files.
    if (params.length === 0 && /;\s*\S/.test(text.replace(/--[^\n]*/g, ''))) {
      await db.exec(text);
      return {rows: [] as T[]};
    }
    const result = await db.query<T>(text, params as never[]);
    return {rows: result.rows};
  };

  return {
    query: run,
    async connect() {
      // Single connection, so a "client" is the same handle. Transactions still work because callers
      // issue BEGIN/COMMIT explicitly and nothing else is interleaving on it.
      return {query: run, release: () => {}};
    },
    async end() {
      await db.close();
    },
  };
}

function createPgPool(connectionString: string): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => logger.error({err}, 'unexpected postgres client error'));

  return {
    query: (text, params = []) => pool.query(text, params),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (text, params = []) => client.query(text, params),
        release: () => client.release(),
      };
    },
    end: () => pool.end(),
  };
}

export const isEmbedded = config.DATABASE_URL.startsWith('pglite://');

let dbPromise: Promise<Database> | undefined;

function db(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = isEmbedded
      ? createPglite(config.DATABASE_URL.replace('pglite://', ''))
      : Promise.resolve(createPgPool(config.DATABASE_URL));
  }
  return dbPromise;
}

/** Kept as `pool` so call sites read the same as they did with node-postgres. */
export const pool = {
  query: async <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) =>
    (await db()).query<T>(text, params),
  connect: async () => (await db()).connect(),
  end: async () => {
    if (dbPromise) await (await dbPromise).end();
  },
};

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await (await db()).query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function transaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await (await db()).connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Postgres advisory lock, used so exactly one instance of a singleton worker (indexer, reconciler)
 * runs at a time across a horizontally scaled deployment. Chosen over a Redis lock deliberately: the
 * things it guards write to Postgres, so tying the lock's lifetime to the same connection means a
 * crashed worker releases it automatically and cannot half-commit.
 */
export async function withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
  // The embedded database is single-process by construction, so there is nothing to coordinate with.
  if (isEmbedded) return fn();

  const client = await (await db()).connect();
  try {
    const lockId = hashToInt(key);
    const {rows} = await client.query<{locked: boolean}>('SELECT pg_try_advisory_lock($1) AS locked', [lockId]);
    if (!rows[0]?.locked) return undefined;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
  } finally {
    client.release();
  }
}

function hashToInt(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return hash;
}
