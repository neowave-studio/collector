/**
 * Re-funds every address previously given devnet test funds.
 *
 *   npm run devnet:refund
 *
 * `npm run devnet` starts a fresh anvil, which wipes every balance. Without this, an address funded
 * yesterday is silently back to zero today — and the only symptom is MetaMask greying out its confirm
 * button, because it cannot pay gas. That is a genuinely baffling failure, so the devnet runner calls
 * this automatically on startup.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(here, '../../.devnet-funded.json');

if (!existsSync(registryPath)) {
  console.log('no addresses have been funded yet — nothing to restore');
  process.exit(0);
}

const addresses = JSON.parse(readFileSync(registryPath, 'utf8')) as string[];
for (const address of addresses) {
  try {
    execFileSync('npx', ['tsx', join(here, 'devnet-fund.ts'), address], {stdio: 'inherit', shell: true});
  } catch {
    console.error(`  could not re-fund ${address}`);
  }
}
