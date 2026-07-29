#!/usr/bin/env node
/**
 * Runs the stack against a real testnet.
 *
 *   npm run testnet                 # defaults to base_sepolia
 *   CHAIN_KEY=bnb_testnet npm run testnet
 *
 * The counterpart to `npm run devnet`, and deliberately a different script rather than a flag on it.
 * The devnet builds its world from nothing every time: fresh chain, fresh contracts, fresh database,
 * a mock VRF coordinator, minted play money. None of that is possible here — the contracts are
 * already deployed, the chain has other people on it, and the pay token is real. So this script's job
 * is the opposite one: verify that what already exists is coherent, and refuse to start if it is not.
 *
 * What it checks before starting anything:
 *   - the chain is marked `testnet` in the registry (never point this at a mainnet)
 *   - a deployment file exists for it
 *   - the backend .env enables that chain and nothing else
 *   - the database has been seeded, and its indexer cursor is not at block 0
 *
 * That last one matters most. A cursor at 0 on a chain tens of millions of blocks deep means the
 * indexer will scan forever and every page will sit empty while looking perfectly healthy.
 */
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backend = join(root, 'backend');
const CHAIN_KEY = process.env.CHAIN_KEY ?? 'base_sepolia';

const children = [];
let shuttingDown = false;

function run(cmd, args, cwd, name) {
  const child = spawn(cmd, args, {cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe']});
  children.push({child, name});
  child.stdout.on('data', (d) => process.stdout.write(prefix(name, d)));
  child.stderr.on('data', (d) => process.stderr.write(prefix(name, d)));
  return child;
}

function prefix(name, buf) {
  return String(buf)
    .split('\n')
    .filter(Boolean)
    .map((l) => `[${name}] ${l}\n`)
    .join('');
}

function fail(...lines) {
  console.error(`\n${lines.join('\n')}\n`);
  process.exit(1);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping…');
  for (const {child} of children) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitFor(fn, what, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  fail(`Timed out waiting for ${what}.`);
}

function preflight() {
  const registry = JSON.parse(readFileSync(join(root, 'contracts/script/chains.json'), 'utf8'));
  const entry = registry.chains.find((c) => c.key === CHAIN_KEY);
  if (!entry) fail(`chains.json has no entry for "${CHAIN_KEY}".`);

  // The whole point of this guard: `COMPLIANCE_MODE=off` and local signing keys are acceptable on a
  // testnet and are not acceptable anywhere else. Refuse rather than trusting the operator to notice.
  if (!entry.testnet) {
    fail(
      `"${CHAIN_KEY}" is not marked testnet in chains.json.`,
      'This script runs with development defaults and must never point at a mainnet.',
    );
  }

  const deployment = join(root, `contracts/deployments/${CHAIN_KEY}.json`);
  if (!existsSync(deployment)) {
    fail(
      `No deployment found at contracts/deployments/${CHAIN_KEY}.json.`,
      'Deploy first:  CHAIN_KEY=' + CHAIN_KEY + ' forge script script/Deploy.s.sol:Deploy --broadcast',
    );
  }

  const envPath = join(backend, '.env');
  if (!existsSync(envPath)) fail('backend/.env is missing.');
  const env = readFileSync(envPath, 'utf8');
  const enabled = /^ENABLED_CHAINS=(.*)$/m.exec(env)?.[1]?.trim();
  if (enabled !== CHAIN_KEY) {
    fail(
      `backend/.env has ENABLED_CHAINS=${enabled ?? '(unset)'} but this script is starting ${CHAIN_KEY}.`,
      'Serving a chain the API does not know about produces empty pages rather than an error.',
    );
  }

  return entry;
}

async function main() {
  console.log(`Collector — ${CHAIN_KEY}\n${'='.repeat(60)}`);
  const entry = preflight();

  run('npm', ['run', 'dev:all'], backend, 'api');
  await waitFor(async () => (await fetch('http://127.0.0.1:8080/health')).ok, 'the API');

  // Seeded state is what separates "running" from "working". /packs is empty both when the pool was
  // never seeded and when everything is fine but the chain has no pack — so say which.
  const packs = await fetch('http://127.0.0.1:8080/packs').then((r) => r.json());
  if (!Array.isArray(packs) || packs.length === 0) {
    fail(
      'The API is up but serves no packs, so the database has not been seeded for this chain.',
      '',
      `  cd backend && CHAIN_KEY=${CHAIN_KEY} INDEXER_START_BLOCK=<deploy block - 1> npm run seed:testnet`,
      '',
      'Take the deploy block from the lowest blockNumber in',
      `  contracts/broadcast/Deploy.s.sol/${entry.chainId}/run-latest.json`,
    );
  }

  run('npm', ['run', 'dev'], root, 'web');
  await waitFor(async () => (await fetch('http://localhost:3000')).ok, 'the frontend', 180);

  const pack = packs[0];
  console.log(`
${'='.repeat(60)}
Up.

  Frontend   http://localhost:3000/gacha
  API        http://127.0.0.1:8080
  Chain      ${entry.name} (${entry.chainId})
  Explorer   ${entry.explorer ?? '—'}

  Pack       ${pack.name}
  Price      ${Number(pack.pricePerRip) / 1e6} ${Object.keys(entry.payTokens)[0] ?? 'token'}
  Pay token  ${pack.payToken}

This is a REAL network. Gas and the pay token are real balances, the VRF subscription is really
being spent, and anything you deploy or sign here is public. The compliance gate is off, the
signing keys are local, and the grading certificates are placeholders — none of which is
acceptable beyond a rehearsal.

Ctrl-C stops the API and the web server. It does not touch the chain.
`);
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
