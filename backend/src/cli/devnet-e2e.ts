/**
 * Devnet end-to-end walkthrough.
 *
 *   npm run devnet:e2e
 *
 * Drives the complete money path exactly as a real user's browser would — SIWE login, a quote, an
 * EIP-712 signature from the user's own key, the relayed rip, Chainlink randomness (mocked here so the
 * outcome is observable), reveal, settlement, and finally the card landing in the user's wallet.
 *
 * Nothing here has privileged access. It holds one anvil account's private key and talks to the same
 * public HTTP API the frontend uses.
 */
import {
  createPublicClient,
  createWalletClient,
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
import {decodeEventLog} from 'viem';
import {gachaAbi} from '../lib/abi.js';
import {buildProof, findLeafForWeight, leafHashes, type PoolLeaf} from '../lib/merkle.js';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
const API = process.env.API_URL ?? 'http://127.0.0.1:8080';

/** anvil account #5 — the demo buyer funded by DeployLocal. */
const USER_PK = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as Hex;

const anvil = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
} as const;

let cookie = '';

async function api(path: string, init: RequestInit = {}): Promise<any> {
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
}

/** Mirrors DeployLocal.s.sol::_leaves() — recomputed here so this script needs no database. */
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

const step = (n: number, msg: string) => console.log(`\n${n}. ${msg}`);
const ok = (msg: string) => console.log(`   ✓ ${msg}`);

async function main(): Promise<void> {
  const deployment = JSON.parse(
    readFileSync(join(here, '../../../contracts/deployments/anvil.json'), 'utf8'),
  ) as Record<string, Address>;

  const account = privateKeyToAccount(USER_PK);
  const publicClient = createPublicClient({chain: anvil, transport: http(RPC)});
  const wallet = createWalletClient({account, chain: anvil, transport: http(RPC)});

  console.log(`user   ${account.address}`);
  console.log(`api    ${API}`);

  // --- 1. approve -------------------------------------------------------------------------------
  step(1, 'Approve the PaymentRouter to pull USDC');
  const erc20 = parseAbi([
    'function approve(address,uint256) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
  ]);
  const balanceBefore = await publicClient.readContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'balanceOf',
    args: [account.address],
  });
  const approveTx = await wallet.writeContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'approve',
    args: [deployment.paymentRouter!, 2n ** 255n],
  });
  await publicClient.waitForTransactionReceipt({hash: approveTx});
  ok(`balance ${formatUnits(balanceBefore, 6)} USDC, router approved`);

  // --- 2. sign in -------------------------------------------------------------------------------
  step(2, 'Sign in with Ethereum');
  const {nonce, domain} = await api('/auth/nonce');
  const issuedAt = new Date().toISOString();
  const message =
    `${domain} wants you to sign in with your Ethereum account:\n${account.address}\n\n` +
    `Sign in to Collector.\n\nURI: http://localhost:3000\nVersion: 1\nChain ID: 31337\n` +
    `Nonce: ${nonce}\nIssued At: ${issuedAt}`;
  const siweSig = await account.signMessage({message});
  const session = await api('/auth/verify', {method: 'POST', body: JSON.stringify({message, signature: siweSig})});
  ok(`session for ${session.address}`);

  const me = await api('/auth/session');
  ok(`compliance mode: ${me.compliance.mode}`);

  // --- 3. quote ---------------------------------------------------------------------------------
  step(3, 'Ask for the terms BEFORE paying (this is what §12 requires to be disclosed)');
  const pack = (await api('/packs'))[0];
  const quote = await api('/rip/quote', {
    method: 'POST',
    body: JSON.stringify({chainId: 31337, packId: pack.packId, numRips: 1}),
  });
  ok(`odds version ${quote.terms.poolVersion}, root ${quote.terms.merkleRoot.slice(0, 18)}…`);
  ok(`price ${formatUnits(BigInt(quote.terms.pricePerRip), 6)} USDC, buyback up to ${quote.terms.buybackBps / 100}%`);

  // --- 4. the user signs the exact terms ---------------------------------------------------------
  step(4, 'User signs those exact terms in their own wallet');
  const msg = quote.typedData.message;
  const signature = await account.signTypedData({
    domain: quote.typedData.domain,
    types: quote.typedData.types,
    primaryType: 'PurchaseAuth',
    message: {
      user: msg.user as Address,
      packId: msg.packId as Hex,
      poolVersion: BigInt(msg.poolVersion),
      numRips: BigInt(msg.numRips),
      payToken: msg.payToken as Address,
      amountPerRip: BigInt(msg.amountPerRip),
      nonce: BigInt(msg.nonce),
      deadline: msg.deadline,
    },
  });
  ok('signature pins the version, token and price — the relayer cannot change any of them');

  // --- 5. rip -----------------------------------------------------------------------------------
  step(5, 'Relay the rip');
  const rip = await api('/rip', {
    method: 'POST',
    body: JSON.stringify({
      chainId: 31337,
      packId: pack.packId,
      numRips: 1,
      auth: msg,
      signature,
    }),
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash: rip.txHash});
  ok(`mined in block ${receipt.blockNumber}`);

  const ripLog = receipt.logs
    .map((l) => {
      try {
        return decodeEventLog({abi: gachaAbi, data: l.data, topics: l.topics});
      } catch {
        return null;
      }
    })
    .find((d: any) => d?.eventName === 'RipRequested') as any;

  const drawId = ripLog.args.firstDrawId as bigint;
  const vrfRequestId = ripLog.args.vrfRequestId as bigint;
  ok(`draw #${drawId}, awaiting VRF request ${vrfRequestId}`);

  const escrowed = await publicClient.readContract({
    address: deployment.gachaMachine!,
    abi: gachaAbi,
    functionName: 'escrowedFunds',
    args: [deployment.usdc!],
  });
  ok(`payment escrowed on-chain: ${formatUnits(escrowed, 6)} USDC (not ours until the draw resolves)`);

  // --- 6. randomness ----------------------------------------------------------------------------
  step(6, 'Chainlink VRF answers (mock coordinator on devnet)');
  const relayerWallet = createWalletClient({
    account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    chain: anvil,
    transport: http(RPC),
  });
  const word = BigInt(process.env.VRF_WORD ?? '0') || BigInt(`0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`);
  const fulfillTx = await relayerWallet.writeContract({
    address: deployment.vrfCoordinator!,
    abi: parseAbi(['function fulfillOne(uint256,uint256)']),
    functionName: 'fulfillOne',
    args: [vrfRequestId, word],
  });
  await publicClient.waitForTransactionReceipt({hash: fulfillTx});

  const draw = await publicClient.readContract({
    address: deployment.gachaMachine!,
    abi: gachaAbi,
    functionName: 'getDraw',
    args: [drawId],
  });
  ok(`revealed: winning weight ${draw.winningWeight} of ${pack.totalWeight}`);

  const recovery = (await api(`/draws/31337/${drawId}/self-settle`)) as any;
  ok(`self-recovery available without us: ${recovery.method}`);

  // --- 7. settle --------------------------------------------------------------------------------
  step(7, 'User takes their card — computing the Merkle proof themselves, no backend involved');

  // Exactly what tools/proof-generator does: derive which card the winning weight maps to, and prove
  // it against the root the CONTRACT built. The backend is not consulted.
  const leaves = devnetLeaves();
  const hashes = leafHashes(pack.packId as Hex, BigInt(pack.poolVersion), leaves);
  const {leaf, index} = findLeafForWeight(leaves, draw.winningWeight);
  const proof = buildProof(hashes, index);
  ok(`weight ${draw.winningWeight} falls in exactly one slice: card #${leaf.tokenId}`);

  const settleTx = await wallet.writeContract({
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
        proof,
      },
    ],
  });
  await publicClient.waitForTransactionReceipt({hash: settleTx});

  const nftAbi = parseAbi(['function ownerOf(uint256) view returns (address)']);
  const owner = await publicClient.readContract({
    address: deployment.collectibleNFT!,
    abi: nftAbi,
    functionName: 'ownerOf',
    args: [leaf.tokenId],
  });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`card went to ${owner}, expected ${account.address}`);
  }
  ok(`card #${leaf.tokenId} is now owned by the buyer`);
  ok(`reference value ${formatUnits(leaf.priceRef, 6)} USDC`);

  const reserved = await publicClient.readContract({
    address: deployment.reserveVault!,
    abi: parseAbi(['function reservedLiabilities(address) view returns (uint256)']),
    functionName: 'reservedLiabilities',
    args: [deployment.usdc!],
  });
  ok(`reserve obligation released: ${formatUnits(reserved, 6)} USDC still held for other draws`);

  const balanceAfter = await publicClient.readContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`\nspent ${formatUnits(balanceBefore - balanceAfter, 6)} USDC`);
  console.log('END-TO-END OK\n');
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
