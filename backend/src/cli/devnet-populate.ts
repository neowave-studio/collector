/**
 * Fills the devnet with real activity so the collection-facing pages have something to show.
 *
 *   npm run devnet:populate            # 4 collectors
 *   npm run devnet:populate -- 6       # 6
 *
 * The leaderboard podium, the pagination and the profile pages all read from chain state, so on a
 * fresh devnet they are correctly but uselessly empty — there is no way to see whether they render
 * until somebody owns something. This opens a pack per wallet and settles it, which is the smallest
 * real thing that produces a holder.
 *
 * Every wallet here is a stock anvil account. Nothing is faked: each one signs in, pays, gets a
 * verifiable random draw and settles it against the committed Merkle root exactly as a browser would.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gachaAbi} from '../lib/abi.js';
import {buildProof, findLeafForWeight, leafHashes, type PoolLeaf} from '../lib/merkle.js';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
const API = process.env.API_URL ?? 'http://127.0.0.1:8080';

/** Anvil accounts #7 upward, so this never collides with the wallets the E2E scripts drive. */
const COLLECTOR_PKS: Hex[] = [
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
  '0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897',
  '0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82',
  '0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1',
];

const chain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
} as const;

// Mirrors the pool committed by DeployLocal — the same partition the contract verified on-chain.
const WEIGHTS = [300n, 250n, 200n, 120n, 80n, 30n, 15n, 5n];
const PRICE_REFS = [
  20_000_000n, 24_000_000n, 28_000_000n, 35_000_000n, 48_000_000n, 90_000_000n, 180_000_000n, 600_000_000n,
];

function devnetLeaves(): PoolLeaf[] {
  const leaves: PoolLeaf[] = [];
  let cum = 0n;
  for (let i = 0; i < WEIGHTS.length; i++) {
    leaves.push({tokenId: BigInt(i + 1), cumBefore: cum, weight: WEIGHTS[i]!, priceRef: PRICE_REFS[i]!});
    cum += WEIGHTS[i]!;
  }
  return leaves;
}

const deployment = JSON.parse(
  readFileSync(join(here, '../../../contracts/deployments/anvil.json'), 'utf8'),
) as Record<string, Address>;

const publicClient = createPublicClient({chain, transport: http(RPC)});
const erc20 = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address,uint256)',
]);

function makeApi() {
  let cookie = '';
  return async function call(path: string, init: RequestInit = {}): Promise<any> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {'content-type': 'application/json', ...(cookie ? {cookie} : {}), ...(init.headers ?? {})},
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`);
    return body;
  };
}

async function signIn(call: ReturnType<typeof makeApi>, account: ReturnType<typeof privateKeyToAccount>) {
  const {nonce, domain} = await call('/auth/nonce');
  const message =
    `${domain} wants you to sign in with your Ethereum account:\n${account.address}\n\n` +
    `Sign in to Collector.\n\nURI: http://localhost:3000\nVersion: 1\nChain ID: 31337\n` +
    `Nonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  await call('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({message, signature: await account.signMessage({message})}),
  });
}

async function fund(account: ReturnType<typeof privateKeyToAccount>) {
  const funder = createWalletClient({
    account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    chain,
    transport: http(RPC),
  });

  // Anvil pre-funds only its first ten accounts, so anything past those has USDC but no gas. The
  // failure surfaces as a revert on `approve`, which reads like a token problem rather than an
  // empty wallet.
  const gas = await publicClient.getBalance({address: account.address});
  if (gas < 10n ** 17n) {
    await publicClient.waitForTransactionReceipt({
      hash: await funder.sendTransaction({to: account.address, value: 10n ** 18n, chain: null}),
    });
  }

  const held = await publicClient.readContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (held >= 200_000_000n) return;
  await publicClient.waitForTransactionReceipt({
    hash: await funder.writeContract({
      address: deployment.usdc!,
      abi: erc20,
      functionName: 'mint',
      args: [account.address, 10_000_000_000n],
    }),
  });
}

/** Opens one pack and settles it, so the wallet ends up actually holding the card it drew. */
async function ripAndSettle(account: ReturnType<typeof privateKeyToAccount>): Promise<bigint> {
  const call = makeApi();
  await signIn(call, account);

  const wallet = createWalletClient({account, chain, transport: http(RPC)});
  await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: deployment.usdc!,
      abi: erc20,
      functionName: 'approve',
      args: [deployment.paymentRouter!, 2n ** 255n],
    }),
  });

  const pack = (await call('/packs'))[0];
  const quote = await call('/rip/quote', {
    method: 'POST',
    body: JSON.stringify({chainId: 31337, packId: pack.packId, numRips: 1}),
  });
  const m = quote.typedData.message;
  const signature = await account.signTypedData({
    domain: quote.typedData.domain,
    types: quote.typedData.types,
    primaryType: 'PurchaseAuth',
    message: {
      user: m.user as Address,
      packId: m.packId as Hex,
      poolVersion: BigInt(m.poolVersion),
      numRips: BigInt(m.numRips),
      payToken: m.payToken as Address,
      amountPerRip: BigInt(m.amountPerRip),
      nonce: BigInt(m.nonce),
      deadline: m.deadline,
    },
  });

  const rip = await call('/rip', {
    method: 'POST',
    body: JSON.stringify({chainId: 31337, packId: pack.packId, numRips: 1, auth: m, signature}),
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash: rip.txHash});
  const log = receipt.logs
    .map((l) => {
      try {
        return decodeEventLog({abi: gachaAbi, data: l.data, topics: l.topics});
      } catch {
        return null;
      }
    })
    .find((d: any) => d?.eventName === 'RipRequested') as any;
  const drawId = log.args.firstDrawId as bigint;

  let winningWeight = 0n;
  for (let i = 0; i < 30; i++) {
    const d = await publicClient.readContract({
      address: deployment.gachaMachine!,
      abi: gachaAbi,
      functionName: 'getDraw',
      args: [drawId],
    });
    if (d.revealed) {
      winningWeight = d.winningWeight;
      break;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (winningWeight === 0n) throw new Error('randomness never arrived — is the devnet VRF daemon running?');

  const leaves = devnetLeaves();
  const hashes = leafHashes(pack.packId as Hex, BigInt(pack.poolVersion), leaves);
  const {leaf, index} = findLeafForWeight(leaves, winningWeight);

  // The card may already have gone to an earlier draw; that path pays out instead of delivering, and
  // is exercised by the E2E rather than here. Report it rather than pretending the wallet holds one.
  const held = await publicClient.readContract({
    address: deployment.vault!,
    abi: parseAbi(['function isHeld(uint256) view returns (bool)']),
    functionName: 'isHeld',
    args: [leaf.tokenId],
  });
  if (!held) {
    console.log(`   ${account.address.slice(0, 10)}… drew card #${leaf.tokenId}, already gone — compensated`);
    return 0n;
  }

  await publicClient.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: deployment.gachaMachine!,
      abi: gachaAbi,
      functionName: 'settle',
      args: [
        drawId,
        {
          tokenId: leaf.tokenId,
          cumBefore: leaf.cumBefore,
          weight: leaf.weight,
          priceRef: leaf.priceRef,
          leafIndex: BigInt(index),
          proof: buildProof(hashes, index),
        },
      ],
    }),
  });

  console.log(
    `   ${account.address.slice(0, 10)}… holds card #${leaf.tokenId} (${formatUnits(leaf.priceRef, 6)} USDC reference)`,
  );
  return leaf.priceRef;
}

/**
 * The devnet pool holds eight cards. Draw them all and the contract's staleness breaker correctly
 * refuses further rips — but the devnet then looks broken to whoever opens it next, for a reason
 * that has nothing to do with what they were testing. Leave headroom.
 */
const POOL_SIZE = WEIGHTS.length;
const LEAVE_IN_VAULT = 3;

async function main(): Promise<void> {
  const requested = Number(process.argv[2] ?? 4);
  const ceiling = Math.min(COLLECTOR_PKS.length, POOL_SIZE - LEAVE_IN_VAULT);
  const count = Math.min(Math.max(requested, 1), ceiling);
  if (count !== requested) {
    console.log(`(capped at ${count} so the pool keeps ${LEAVE_IN_VAULT} cards and stays rippable)`);
  }

  console.log(`Populating the devnet with ${count} collectors\n`);
  for (const pk of COLLECTOR_PKS.slice(0, count)) {
    const account = privateKeyToAccount(pk);
    await fund(account);
    try {
      await ripAndSettle(account);
    } catch (err) {
      console.error(`   ${account.address.slice(0, 10)}… failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const board = (await fetch(`${API}/leaderboard?chainId=31337`).then((r) => r.json())) as {entries: unknown[]};
  console.log(`\nLeaderboard now has ${board.entries.length} collector(s).`);
  console.log('  http://localhost:3000/leaderboard');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
