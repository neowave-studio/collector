#!/usr/bin/env node
/**
 * Collector — offline settlement CLI.
 *
 * No dependencies, no network. If Collector's backend is down, paused, or gone entirely, this is how
 * you get your card out.
 *
 *   node cli.mjs selftest
 *   node cli.mjs verify   --pool pool.json [--root 0x…]
 *   node cli.mjs settle   --pool pool.json --draw 42 --weight 87 [--to 0x…] [--method claimAfterTimeout]
 *   node cli.mjs refund   --draw 42
 *
 * The output of `settle` is a raw `to`/`data` pair. Paste it into any wallet's "send transaction"
 * screen. You do not need our frontend, and you do not need our permission.
 */
import {readFileSync} from 'node:fs';
import {
  buildCalldata,
  buildProof,
  buildRefundCalldata,
  findCardForWeight,
  selfTest,
  verifyPoolFile,
} from './collector-verify.js';

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

try {
  switch (command) {
    case 'selftest':
      runSelfTest();
      break;
    case 'verify':
      runVerify();
      break;
    case 'settle':
      runSettle();
      break;
    case 'refund':
      console.log(JSON.stringify({method: 'refundStuckRip', data: buildRefundCalldata(required('draw'))}, null, 2));
      break;
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(`\nERROR: ${err.message}\n`);
  process.exit(1);
}

function runSelfTest() {
  const {ok, results} = selfTest();
  for (const r of results) {
    console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}`);
    if (!r.pass) console.log(`        expected ${r.expected}\n        actual   ${r.actual}`);
  }
  console.log(
    ok
      ? '\nSelf-test passed: this copy produces the same hashes as the deployed contracts.'
      : '\nSELF-TEST FAILED. This file has been modified or corrupted — do not rely on its output.',
  );
  process.exit(ok ? 0 : 1);
}

function loadPool() {
  const path = required('pool');
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (file.schema !== 'collector.pool.v1') {
    console.warn(`warning: unexpected schema "${file.schema}" — continuing anyway`);
  }
  return file;
}

function runVerify() {
  const file = loadPool();
  const onChainRoot = args.root;

  const result = verifyPoolFile(file, onChainRoot);

  console.log(`pack        ${file.packId}`);
  console.log(`version     ${file.version}`);
  console.log(`cards       ${file.cards.length}`);
  console.log(`totalWeight ${result.totalWeight}`);
  console.log(`root        ${result.computedRoot}`);
  if (onChainRoot) console.log(`on-chain    ${onChainRoot}`);
  console.log('');

  if (result.ok) {
    console.log('VERIFIED. These odds tile the weight range exactly once, and this file is the one');
    console.log('that was committed on-chain. Nobody can hand you a different card than the weight says.');
    if (!onChainRoot) {
      console.log('');
      console.log('Next: read poolCID and root from getPoolVersion() on-chain and re-run with --root to');
      console.log('confirm this file is the committed one rather than merely self-consistent.');
    }
  } else {
    console.log('NOT VERIFIED:');
    for (const problem of result.problems) console.log(`  - ${problem}`);
    process.exit(1);
  }
}

function runSettle() {
  const file = loadPool();
  const drawId = required('draw');
  const winningWeight = required('weight');

  const result = verifyPoolFile(file, args.root);
  if (!result.ok) {
    console.error('Refusing to build a transaction from a pool file that does not verify:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const card = findCardForWeight(file, winningWeight);
  const proof = buildProof(result.hashes, card.leafIndex);

  const data = buildCalldata({
    method: args.method ?? 'claimAfterTimeout',
    drawId,
    card: {
      tokenId: card.tokenId,
      cumBefore: card.cumBefore,
      weight: card.weight,
      priceRef: card.priceRef,
      leafIndex: card.leafIndex,
    },
    proof,
  });

  console.log(
    JSON.stringify(
      {
        card: {
          name: card.name,
          tokenId: card.tokenId,
          grade: card.grade,
          certNumber: card.certNumber,
          priceRef: card.priceRef,
        },
        transaction: {
          to: args.to ?? file.gachaMachine ?? '<GachaMachine address>',
          data,
          value: '0',
        },
        method: args.method ?? 'claimAfterTimeout',
        note:
          'Send this from ANY address — the card goes to the draw owner regardless of who submits it. ' +
          'claimAfterTimeout works once the buyback window has passed and is never pausable.',
      },
      null,
      2,
    ),
  );
}

function required(name) {
  const value = args[name];
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
}

function parseArgs(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function usage() {
  console.log(`
Collector offline settlement tool — no dependencies, no network, no trust required.

  node cli.mjs selftest
      Verify this copy produces the same hashes as the deployed contracts.

  node cli.mjs verify --pool pool.json [--root 0x...]
      Check that a published pool file's odds tile the weight range exactly once,
      and (with --root) that it is the file committed on-chain.

  node cli.mjs settle --pool pool.json --draw 42 --weight 87 [--to 0x...] [--method claimAfterTimeout]
      Work out which card the draw won and print the transaction that delivers it.

  node cli.mjs refund --draw 42
      Print the transaction that refunds a rip whose randomness never arrived.

Getting the inputs without us:
  root, poolCID   -> GachaMachine.getPoolVersion(packId, version)
  winning weight  -> GachaMachine.getDraw(drawId).winningWeight
  pool file       -> any IPFS gateway, using the CID above (hash it with keccak256 and compare
                     to poolCID on-chain to confirm you have the authentic file)
`);
}
