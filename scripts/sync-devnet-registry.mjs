#!/usr/bin/env node
/**
 * Copies the freshly-deployed devnet addresses into the chain registry.
 *
 * `DeployLocal.s.sol` writes `deployments/anvil.json`, but the mock USDC and mock VRF coordinator are
 * deployed fresh each run, so `chains.json` has to follow them. Run after every devnet deploy.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(root, 'contracts/script/chains.json');
const deployment = JSON.parse(readFileSync(join(root, 'contracts/deployments/anvil.json'), 'utf8'));
const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

const entry = registry.chains.find((c) => c.key === 'anvil');
if (!entry) {
  console.error('No "anvil" entry in chains.json. Add one before running the devnet.');
  process.exit(1);
}

entry.payTokens = {USDC: deployment.usdc};
entry.vrf.coordinator = deployment.vrfCoordinator;

writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`registry synced: USDC ${deployment.usdc}, GachaMachine ${deployment.gachaMachine}`);
