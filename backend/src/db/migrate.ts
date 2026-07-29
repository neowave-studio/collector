import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pool} from './index.js';
import {logger} from '../lib/logger.js';
import {initChains} from '../chains.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Forward-only migration runner. Each file runs once, inside a transaction, recorded in
 * `schema_migrations`. No down-migrations: rolling a schema backwards on a database that is the
 * source of truth for shipping and KYC records is how data gets lost.
 */
async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const dir = join(here, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const {rows} = await pool.query('SELECT name FROM schema_migrations WHERE name = $1', [file]);
    if (rows.length > 0) {
      logger.debug({file}, 'migration already applied');
      continue;
    }

    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({file}, 'migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({err, file}, 'migration failed');
      throw err;
    } finally {
      client.release();
    }
  }

  await seedChains();
  logger.info('migrations complete');
}

/** Mirrors the chain registry into the `chains` table so the indexer has somewhere to start. */
async function seedChains(): Promise<void> {
  for (const chain of initChains()) {
    await pool.query(
      `INSERT INTO chains (chain_id, chain_key, name, gacha_enabled, vrf_coordinator, confirmations)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (chain_id) DO UPDATE
         SET chain_key = EXCLUDED.chain_key, name = EXCLUDED.name,
             gacha_enabled = EXCLUDED.gacha_enabled, confirmations = EXCLUDED.confirmations,
             updated_at = now()`,
      [
        chain.chainId,
        chain.key,
        chain.name,
        chain.gachaEnabled,
        chain.vrf?.coordinator ?? null,
        chain.confirmations,
      ],
    );
  }
}

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({err}, 'migration run failed');
    process.exit(1);
  });
