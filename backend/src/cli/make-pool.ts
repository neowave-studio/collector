/**
 * Builds a realistic pool and checks whether it can actually be sold.
 *
 *   npm run pool:make -- --value 1000000 --price 350
 *
 * A pool is not just a list of cards. Three constraints bind it together, and violating any one of
 * them either bricks the commit or quietly makes the product lose money:
 *
 *   1. HOUSE MARGIN (enforced on-chain by PoolLib.houseMarginHolds)
 *        buybackBps · Σ(wᵢ·priceRefᵢ)  ≤  pricePerRip · (BPS − houseMarginBps) · W
 *      In plain terms: the expected sell-back payout has to sit below the pack price net of margin.
 *      A pool that fails this can be rip→buyback arbitraged until the reserve is empty, so
 *      `commitPool` refuses to store its root at all.
 *
 *   2. RESERVE PER RIP — the one that surprises people.
 *        maxReservePerRip = maxPriceRef · unavailableBps / BPS
 *      `rip` books the WORST CASE before it sells anything, because at rip time nobody knows what
 *      will be drawn. One $350,000 grail in the pool therefore means every single pack sold reserves
 *      $350,000, regardless of what it actually pulls. Concurrency is bounded by
 *      reserve / maxReservePerRip, not by inventory.
 *
 *   3. STALENESS — releasedCount / cardCount must stay under poolStaleThresholdBps, or the contract
 *      stops selling until a new version is published. With few cards that fires almost immediately.
 *
 * This prints all three so a pool is judged before it is committed rather than after.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {keccak256, toBytes} from 'viem';
import {computeRoot, leafHashes, type PoolLeaf} from '../lib/merkle.js';

const here = dirname(fileURLToPath(import.meta.url));
const BPS = 10_000n;

interface Tier {
  name: string;
  count: number;
  /** Reference value per card, in whole currency units. */
  priceRef: number;
  /** Draw weight per card. Higher = more likely. */
  weight: number;
  set: string;
  grade: string;
}

/**
 * A graded-card pool shaped like a real one: a long tail of cheap commons carrying most of the draw
 * weight, and a handful of grails carrying most of the value. The proportions matter — the expected
 * value is dominated by the commons (which is what keeps the pack affordable) while the *headline*
 * is the grail (which is what makes it worth opening).
 */
const TIERS: Tier[] = [
  // Top reference value is deliberately capped at $20,000 rather than carrying a $350,000 grail.
  // maxPriceRef sets the reserve booked on EVERY rip, so a $350k card meant $350k reserved per pack
  // and about two packs in flight per $1M of reserve. At $20k the same reserve supports fifty. The
  // headline is still 57x the pack price, and users keep 100% compensation if their card is gone —
  // which was the alternative sacrifice, and the wrong one to make.
  {name: 'Charizard Base Set', count: 40, priceRef: 20_000, weight: 2, set: 'Base Set 1999', grade: 'PSA 10'},
  {name: 'Base Set Holo', count: 116, priceRef: 8_000, weight: 8, set: 'Base Set 1999', grade: 'PSA 9'},
  {name: 'Jungle / Fossil Holo', count: 400, priceRef: 2_400, weight: 40, set: 'Jungle 1999', grade: 'PSA 10'},
  {name: 'Neo / Gym Holo', count: 900, priceRef: 900, weight: 220, set: 'Neo Genesis 2000', grade: 'PSA 9'},
  {name: 'Modern Holo', count: 2_500, priceRef: 200, weight: 1_400, set: 'Evolving Skies 2021', grade: 'PSA 10'},
];

function parseArgs(): {
  targetValue: number;
  pricePerRip: number;
  out: string;
  firstTokenId: number;
  scale: number;
  version: number;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: number) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
  };
  const outIdx = args.indexOf('--out');
  return {
    targetValue: get('--value', 1_000_000),
    pricePerRip: get('--price', 350),
    out: outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : 'pools/elite-1m.json',
    // Token ids are global to the CollectibleNFT, not per pool: minting a new pool over ids an
    // earlier version already used reverts with TokenAlreadyExists. Start above existing inventory
    // and leave a visible gap, so which pool a card came from is readable from its id.
    firstTokenId: get('--first-token-id', 1),
    // Divides every tier count, keeping the SHAPE of the distribution intact. Scaling the mix rather
    // than trimming one tier is what preserves the odds and the expected value — a smaller pool that
    // draws differently is not a smaller version of the same product.
    scale: get('--scale', 1),
    // The leaf hash binds packId AND version (so a proof can never be replayed across either), so a
    // file generated for one version has a different root from the same leaves committed under
    // another. This MUST match the --version passed to pool:commit.
    version: get('--version', 1),
  };
}

function main(): void {
  const {targetValue, pricePerRip, out, firstTokenId, scale, version: versionArg} = parseArgs();
  // At least one card per tier, so scaling down can never silently delete the grail.
  const tiers = TIERS.map((t) => ({...t, count: Math.max(1, Math.round(t.count / scale))}));

  const BUYBACK_BPS = 8500n;
  const HOUSE_MARGIN_BPS = 1000n;
  const UNAVAILABLE_BPS = 10_000n;
  const DECIMALS = 1_000_000n; // 6dp, matching USDC

  const leaves: PoolLeaf[] = [];
  const cards: {tokenId: string; name: string; set: string; grade: string; priceRef: string}[] = [];

  let cum = 0n;
  let tokenId = BigInt(firstTokenId);
  for (const tier of tiers) {
    for (let i = 0; i < tier.count; i++) {
      const priceRef = BigInt(Math.round(tier.priceRef * Number(DECIMALS)));
      const weight = BigInt(tier.weight);
      leaves.push({tokenId, cumBefore: cum, weight, priceRef});
      cards.push({
        tokenId: tokenId.toString(),
        name: `${tier.name} #${i + 1}`,
        set: tier.set,
        grade: tier.grade,
        priceRef: priceRef.toString(),
      });
      cum += weight;
      tokenId += 1n;
    }
  }

  const totalWeight = cum;
  const totalValue = leaves.reduce((acc, l) => acc + l.priceRef, 0n);
  const weightedSum = leaves.reduce((acc, l) => acc + l.weight * l.priceRef, 0n);
  const maxPriceRef = leaves.reduce((acc, l) => (l.priceRef > acc ? l.priceRef : acc), 0n);
  const expectedValue = weightedSum / totalWeight;

  const price = BigInt(Math.round(pricePerRip * Number(DECIMALS)));

  // The exact on-chain inequality, in integers, so this agrees with the contract rather than
  // approximating it in floating point.
  const expectedPayout = BUYBACK_BPS * weightedSum;
  const allowed = price * (BPS - HOUSE_MARGIN_BPS) * totalWeight;
  const marginHolds = expectedPayout <= allowed;

  // Lowest price that still satisfies the invariant, rounded up.
  const minPrice = (BUYBACK_BPS * weightedSum + (BPS - HOUSE_MARGIN_BPS) * totalWeight - 1n) /
    ((BPS - HOUSE_MARGIN_BPS) * totalWeight);

  const maxReservePerRip = (maxPriceRef * UNAVAILABLE_BPS) / BPS;

  const fmt = (v: bigint) => `$${(Number(v) / Number(DECIMALS)).toLocaleString('en-US', {maximumFractionDigits: 2})}`;

  console.log('');
  console.log(`Pool: ${leaves.length} cards, token ids ${firstTokenId}..${Number(firstTokenId) + leaves.length - 1}`);
  console.log(`  total reference value   ${fmt(totalValue)}   (target ${fmt(BigInt(targetValue) * DECIMALS)})`);
  console.log(`  total draw weight       ${totalWeight.toLocaleString('en-US')}`);
  console.log(`  expected value per rip  ${fmt(expectedValue)}`);
  console.log('');
  console.log('Tiers');
  let seen = 0;
  for (const tier of tiers) {
    const w = BigInt(tier.weight * tier.count);
    const pct = (Number(w) / Number(totalWeight)) * 100;
    const oneIn = Number(totalWeight) / Number(w);
    console.log(
      `  ${tier.name.padEnd(22)} ${String(tier.count).padStart(4)} x ${fmt(BigInt(Math.round(tier.priceRef * 1e6))).padStart(11)}` +
        `   ${pct.toFixed(3).padStart(7)}%   1 in ${oneIn < 10 ? oneIn.toFixed(1) : Math.round(oneIn).toLocaleString('en-US')}`,
    );
    seen += tier.count;
  }
  console.log('');
  console.log(`Pack price ${fmt(price)}`);
  console.log(`  house margin invariant  ${marginHolds ? 'HOLDS' : 'VIOLATED — commitPool would revert'}`);
  console.log(`  minimum viable price    ${fmt(minPrice)}`);
  console.log(`  effective house margin  ${(100 - (Number(BUYBACK_BPS) / 100) * (Number(expectedValue) / Number(price))).toFixed(1)}%`);
  console.log('');
  console.log('Reserve requirement — the binding constraint');
  console.log(`  booked per rip          ${fmt(maxReservePerRip)}   (maxPriceRef x unavailableBps)`);
  console.log(`  ...rip() books the WORST CASE before it knows what was drawn, because two draws can`);
  console.log(`     land on the same slice and the second must be compensated (claimUnavailable).`);
  console.log('');
  console.log('  Throughput is reserve / maxReservePerRip, NOT inventory:');
  for (const reserve of [100_000n, 500_000n, 1_000_000n, 5_000_000n]) {
    const concurrent = (reserve * DECIMALS) / maxReservePerRip;
    console.log(`    reserve ${fmt(reserve * DECIMALS).padStart(12)}  ->  ${concurrent} concurrent unsettled rip(s)`);
  }
  console.log('');
  console.log('  The grail sets this number. Lowering the top reference value, or unavailableBps,');
  console.log('  buys throughput directly — but unavailableBps is also what a user is paid when their');
  console.log('  card turns out to be gone, so cutting it moves risk onto them and must be disclosed.');
  console.log('');

  if (!marginHolds) {
    console.error(`House margin fails at ${fmt(price)}. Raise the price to at least ${fmt(minPrice)}.`);
    process.exit(1);
  }

  const packId = keccak256(toBytes('collector.pack.elite.v1'));
  const version = BigInt(versionArg);
  const hashes = leafHashes(packId, version, leaves);
  const root = computeRoot(hashes);

  const outPath = join(here, '../../..', out);
  mkdirSync(dirname(outPath), {recursive: true});
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        packId,
        version: version.toString(),
        merkleRoot: root,
        pricePerRip: price.toString(),
        buybackBps: Number(BUYBACK_BPS),
        unavailableBps: Number(UNAVAILABLE_BPS),
        houseMarginBps: Number(HOUSE_MARGIN_BPS),
        reserveBps: 4000,
        totalWeight: totalWeight.toString(),
        totalValue: totalValue.toString(),
        maxReservePerRip: maxReservePerRip.toString(),
        cardCount: leaves.length,
        leaves: leaves.map((l, i) => ({
          tokenId: l.tokenId.toString(),
          cumBefore: l.cumBefore.toString(),
          weight: l.weight.toString(),
          priceRef: l.priceRef.toString(),
          leafHash: hashes[i],
        })),
        cards,
      },
      null,
      2,
    ),
  );

  console.log(`merkle root ${root}   (pack v${version})`);
  console.log(`written to  ${out}`);
  console.log('');
  console.log(`Commit it with:  npm run pool:commit -- --file ${out} --chain <key>`);
}

main();
