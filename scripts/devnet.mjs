#!/usr/bin/env node
/**
 * One-command local devnet.
 *
 *   npm run devnet
 *
 * Brings up the whole system with **no infrastructure to install** — no Docker, no Postgres server,
 * no Redis:
 *
 *   anvil            local chain (instant mining)
 *   DeployLocal      contracts + roles + inventory + a committed, activated pool
 *   PGlite           embedded Postgres, in-process
 *   backend          API + workers in one process (the embedded DB is single-writer)
 *   next             frontend on :3000
 *
 * Ctrl-C stops everything it started.
 *
 * Two things are deliberately fake here and nowhere else: the Timelock delay is zero, and a mock VRF
 * coordinator stands in for Chainlink so outcomes are observable. Everything else — proxies, role
 * separation, escrow, the reserve, the Merkle-verified settlement — is the production wiring.
 */
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = join(root, 'contracts');
const backend = join(root, 'backend');
const RPC = 'http://127.0.0.1:8545';

const children = [];
let shuttingDown = false;

/**
 * Put Foundry's own bin directory first on PATH.
 *
 * `forge` is not a unique name — Laravel Forge ships a `forge` too, and on a machine that has both,
 * whichever sits earlier on PATH wins. The failure is baffling when it happens, because the error
 * comes from a completely unrelated tool ('expected arguments "namespace"'), so pin the directory
 * rather than trusting the bare name.
 */
function useFoundryToolchain() {
  const bin = join(homedir(), '.foundry', 'bin');
  if (existsSync(bin)) process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;

  const probe = spawnSync('forge', ['--version'], {shell: true, encoding: 'utf8'});
  const out = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
  if (probe.status !== 0 || !/forge\s+Version|forge\s+\d/i.test(out)) {
    console.error(
      [
        '',
        'Foundry was not found, or `forge` resolves to a different tool.',
        existsSync(bin)
          ? `  Looked in ${bin} and it did not answer as Foundry.`
          : `  ${bin} does not exist — install Foundry: https://getfoundry.sh`,
        `  \`forge --version\` said: ${out.trim().split('\n')[0] || '(nothing)'}`,
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

function run(cmd, args, cwd, name) {
  const child = spawn(cmd, args, {cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe']});
  children.push({child, name});
  const prefix = `[${name}]`;
  child.stdout.on('data', (d) => process.stdout.write(prefixLines(prefix, d)));
  child.stderr.on('data', (d) => process.stderr.write(prefixLines(prefix, d)));
  return child;
}

function prefixLines(prefix, buf) {
  return String(buf)
    .split('\n')
    .filter(Boolean)
    .map((l) => `${prefix} ${l}\n`)
    .join('');
}

function exec(cmd, args, cwd, label) {
  process.stdout.write(`\n> ${label}\n`);
  const result = spawnSync(cmd, args, {cwd, shell: true, stdio: 'inherit'});
  if (result.status !== 0) {
    console.error(`\n${label} failed. Stopping.`);
    shutdown(1);
  }
}

async function waitFor(fn, what, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      if (await fn()) return;
    } catch {
      /* not up yet */
    }
    await sleep(700);
  }
  console.error(`\nTimed out waiting for ${what}.`);
  shutdown(1);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nStopping devnet…');
  for (const {child, name} of children) {
    try {
      // `shell: true` means the child is a shell; kill the tree on Windows.
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
      else child.kill('SIGTERM');
    } catch {
      console.error(`  could not stop ${name}`);
    }
  }

  // Killing the wrapper shell does not reliably take anvil with it — if the shell has already exited
  // the tree kill has nothing to walk, and anvil survives holding 8545. The next run then refuses to
  // start. Sweep by name as a backstop; the devnet owns the only anvil worth running here.
  try {
    if (process.platform === 'win32') {
      // `taskkill` is not always resolvable from the environment npm hands us, so fall back to
      // PowerShell, which is. Either one is fine; silently doing neither is not.
      const killed = spawnSync('taskkill', ['/IM', 'anvil.exe', '/F'], {stdio: 'ignore'});
      if (killed.status !== 0) {
        spawnSync(
          'powershell',
          ['-NoProfile', '-Command', 'Get-Process anvil -ErrorAction SilentlyContinue | Stop-Process -Force'],
          {stdio: 'ignore'},
        );
      }
    } else {
      spawnSync('pkill', ['-f', 'anvil --host 127.0.0.1 --port 8545'], {stdio: 'ignore'});
    }
  } catch {
    console.error('  could not sweep anvil; if 8545 stays busy, stop it manually');
  }

  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  console.log('Collector devnet\n' + '='.repeat(60));
  useFoundryToolchain();

  // 1. chain -------------------------------------------------------------------------------------
  // `--block-time` matters more than it looks. By default anvil mines only when a transaction
  // arrives, so the newest block is whatever the last action produced — and the indexer deliberately
  // reads only up to `head - confirmations`, so that block never becomes safe to read. The visible
  // symptom is a rip that reveals on-chain and then sits at "waiting for randomness" forever, because
  // the reveal is in the one block the indexer will not touch until something else happens. A steady
  // heartbeat keeps the head moving so the last real action is always followed by a block.
  // A previous run that did not shut down cleanly leaves anvil holding 8545. The new one then fails
  // to bind and everything after it silently talks to the *old* chain, which is far more confusing
  // than stopping here.
  const portTaken = await fetch(RPC, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1}),
  })
    .then((r) => r.ok)
    .catch(() => false);
  if (portTaken) {
    console.error(
      [
        '',
        'Something is already listening on 127.0.0.1:8545 — probably an anvil from an earlier run.',
        'Stop it first, then re-run:',
        process.platform === 'win32'
          ? '  taskkill /IM anvil.exe /F'
          : '  pkill anvil',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  run('anvil', ['--host', '127.0.0.1', '--port', '8545', '--block-time', '1'], root, 'anvil');
  await waitFor(async () => {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1}),
    });
    return res.ok;
  }, 'anvil');

  // 2. contracts ---------------------------------------------------------------------------------
  exec(
    'forge',
    ['script', 'script/DeployLocal.s.sol:DeployLocal', '--rpc-url', RPC, '--broadcast', '--skip-simulation', '--slow'],
    contracts,
    'deploying contracts',
  );

  // The pool's activation block is set far ahead so it survives the broadcast; mine past it.
  await fetch(RPC, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', method: 'anvil_mine', params: ['0x258'], id: 1}),
  });

  // 3. registry ----------------------------------------------------------------------------------
  exec('node', ['scripts/sync-devnet-registry.mjs'], root, 'syncing chain registry');

  // The frontend needs NEXT_PUBLIC_ANVIL_RPC_URL to include the devnet in its chain list at all —
  // without it a wallet on chain 31337 simply looks unsupported. Write it rather than expecting the
  // reader to have noticed a line in a README.
  const envLocal = join(root, '.env.local');
  if (!existsSync(envLocal)) {
    writeFileSync(
      envLocal,
      [
        '# Written by `npm run devnet`. Safe to delete.',
        'NEXT_PUBLIC_API_URL=http://localhost:8080',
        'NEXT_PUBLIC_DEFAULT_CHAIN_ID=31337',
        'NEXT_PUBLIC_ANVIL_RPC_URL=http://127.0.0.1:8545',
        '# Reown (WalletConnect) project id. Public by design — it ships in the client bundle.',
        `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ''}`,
        '# Without a project id, injected wallets still work but WalletConnect/mobile do not.',
        '',
      ].join('\n'),
    );
    console.log('> wrote .env.local for the frontend');
  }

  // 4. database ----------------------------------------------------------------------------------
  const dataDir = join(backend, '.data');
  if (existsSync(dataDir)) rmSync(dataDir, {recursive: true, force: true});
  exec('npm', ['run', 'migrate'], backend, 'migrating embedded database');
  exec('npm', ['run', 'devnet:seed'], backend, 'seeding pool data');

  // 5. services ----------------------------------------------------------------------------------
  // The backend detects the embedded database and runs the workers in-process automatically.
  run('npm', ['run', 'dev:all'], backend, 'api');
  await waitFor(async () => (await fetch('http://127.0.0.1:8080/health')).ok, 'the API');

  // Stands in for Chainlink so the UI does not hang on "waiting for randomness".
  run('npm', ['run', 'devnet:vrf'], backend, 'vrf');

  // A fresh anvil wipes every balance. Restore anyone previously funded, so a tester's wallet does
  // not silently drop to zero between runs — the symptom is MetaMask greying out its confirm button.
  exec('npm', ['run', 'devnet:refund'], backend, 'restoring funded test wallets');

  // `next dev` and `next build` share `.next`, and on Windows leftover production manifests cause
  // EPERM renames that surface as a 500 in the browser. Start the dev server from a clean slate.
  const nextDir = join(root, '.next');
  if (existsSync(nextDir)) rmSync(nextDir, {recursive: true, force: true});

  run('npm', ['run', 'dev'], root, 'web');
  // The first compile pulls in the whole wallet stack, so allow longer than the other services.
  await waitFor(async () => (await fetch('http://localhost:3000')).ok, 'the frontend', 120);

  console.log(`
${'='.repeat(60)}
Devnet is up.

  Frontend    http://localhost:3000/gacha
  API         http://127.0.0.1:8080
  Verifier    http://localhost:3000/tools/proof-generator/index.html
  Chain       ${RPC}  (chain id 31337)

In MetaMask:
  1. Add the network:  RPC ${RPC}   chain id 31337   symbol ETH
  2. Fund YOUR OWN address with test USDC and gas:
         cd backend && npm run devnet:fund -- 0xYourAddress
  3. Add the USDC token to MetaMask (the fund command prints its address)

A pack costs 50 USDC. The first purchase asks for two wallet confirmations: an ERC-20 approval, then
the signature over the exact terms. Randomness is answered automatically by the devnet VRF daemon.

Or run the whole flow headlessly, no browser:
  cd backend && npm run devnet:e2e

Ctrl-C stops everything.
${'='.repeat(60)}
`);
}

main().catch((err) => {
  console.error(err);
  shutdown(1);
});
