#!/usr/bin/env node
/**
 * Storage-layout CI gate (spec §6.4 / §10).
 *
 * A UUPS upgrade that shifts a storage slot does not fail loudly — it silently reinterprets existing
 * state, which for this suite means reinterpreting reserve liabilities and draw ownership. So:
 *
 *   - `--write` snapshots the current layout of every upgradeable contract into `storage/*.json`.
 *   - the default (CI) mode re-derives the layout and fails on ANY incompatible change:
 *       * an existing slot changing type, offset or slot index,
 *       * a variable disappearing,
 *       * a new variable inserted anywhere other than the end.
 *
 * Appending at the end is allowed (that is what the trailing `__gap` arrays are for) but is reported,
 * so a reviewer still sees it.
 *
 * Run `forge build` first — this reads `out/<Contract>.sol/<Contract>.json`.
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'out');
const BASELINE_DIR = join(root, 'storage');

/** Every contract behind a proxy. Non-upgradeable contracts (Timelock, factory) are out of scope. */
const UPGRADEABLE = [
  'AccessController',
  'CollectibleNFT',
  'Vault',
  'ReserveVault',
  'PaymentRouter',
  'GachaMachine',
  'Marketplace',
];

const write = process.argv.includes('--write');

function loadArtifact(name) {
  const path = join(OUT, `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(`Artifact not found: ${path}. Run "forge build" (with extra_output = ["storageLayout"]).`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Normalises to the fields that actually determine on-chain compatibility. */
function extractLayout(artifact, name) {
  const layout = artifact.storageLayout;
  if (!layout) throw new Error(`${name}: no storageLayout in artifact (set extra_output = ["storageLayout"]).`);
  return layout.storage.map((s) => ({
    label: s.label,
    slot: Number(s.slot),
    offset: s.offset,
    type: layout.types?.[s.type]?.label ?? s.type,
  }));
}

function compare(name, baseline, current) {
  const problems = [];
  const additions = [];

  for (let i = 0; i < baseline.length; i++) {
    const b = baseline[i];
    const c = current[i];
    if (!c) {
      problems.push(`slot ${b.slot} "${b.label}" was REMOVED`);
      continue;
    }
    if (b.label !== c.label || b.slot !== c.slot || b.offset !== c.offset || b.type !== c.type) {
      problems.push(
        `slot ${b.slot} changed:\n` +
          `      was  ${b.label} : ${b.type} @ slot ${b.slot}, offset ${b.offset}\n` +
          `      now  ${c.label} : ${c.type} @ slot ${c.slot}, offset ${c.offset}`,
      );
    }
  }

  for (let i = baseline.length; i < current.length; i++) {
    additions.push(`  + ${current[i].label} : ${current[i].type} @ slot ${current[i].slot}`);
  }

  return {problems, additions};
}

let failed = false;

if (!existsSync(BASELINE_DIR)) mkdirSync(BASELINE_DIR, {recursive: true});

for (const name of UPGRADEABLE) {
  const current = extractLayout(loadArtifact(name), name);
  const baselinePath = join(BASELINE_DIR, `${name}.json`);

  if (write) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`snapshot  ${name} (${current.length} slots)`);
    continue;
  }

  if (!existsSync(baselinePath)) {
    console.error(`MISSING BASELINE  ${name} — run "node script/check-storage-layout.mjs --write" and commit it.`);
    failed = true;
    continue;
  }

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const {problems, additions} = compare(name, baseline, current);

  if (problems.length) {
    failed = true;
    console.error(`\nINCOMPATIBLE  ${name}`);
    for (const p of problems) console.error(`    ${p}`);
  } else if (additions.length) {
    console.log(`\nAPPENDED      ${name} (compatible, but review that the gap was reduced to match)`);
    for (const a of additions) console.log(a);
  } else {
    console.log(`ok            ${name}`);
  }
}

if (write) {
  console.log('\nBaselines written. Commit storage/*.json — CI compares against them on every PR.');
  process.exit(0);
}

if (failed) {
  console.error('\nStorage layout gate FAILED. A UUPS upgrade with this layout would silently corrupt state.');
  console.error('If the change is intentional and the proxies have NOT been deployed yet, re-run with --write.');
  process.exit(1);
}

console.log('\nStorage layout gate passed.');
