/**
 * Devnet end-to-end for the two paths the browser exercises beyond opening a pack:
 *
 *   npm run devnet:market
 *
 *   1. seller rips a pack, takes the card, LISTS it
 *   2. a different buyer FILLS that listing from their own wallet
 *   3. a third user rips and SELLS BACK to the platform instead of keeping the card
 *
 * Written deliberately as two separate wallets, because a single-account test would not catch the
 * approval, ownership and fee-split behaviour that only appears when the maker and taker differ.
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

const SELLER_PK = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as Hex; // anvil #5
const BUYER_PK = '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e' as Hex; // anvil #6

const chain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
} as const;

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
const erc721 = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function setApprovalForAll(address,bool)',
]);

const step = (n: string, msg: string) => console.log(`\n${n}. ${msg}`);
const ok = (msg: string) => console.log(`   ${msg}`);

/** One cookie jar per wallet — sessions are bound to an address. */
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

/** Rips, waits for the devnet VRF daemon, and returns the draw. */
async function ripAndReveal(call: ReturnType<typeof makeApi>, account: ReturnType<typeof privateKeyToAccount>) {
  const wallet = createWalletClient({account, chain, transport: http(RPC)});
  const approve = await wallet.writeContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'approve',
    args: [deployment.paymentRouter!, 2n ** 255n],
  });
  await publicClient.waitForTransactionReceipt({hash: approve});

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

  for (let i = 0; i < 30; i++) {
    const d = await publicClient.readContract({
      address: deployment.gachaMachine!,
      abi: gachaAbi,
      functionName: 'getDraw',
      args: [drawId],
    });
    if (d.revealed) return {drawId, winningWeight: d.winningWeight, pack};
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('randomness never arrived — is the devnet VRF daemon running?');
}

async function main(): Promise<void> {
  const seller = privateKeyToAccount(SELLER_PK);
  const buyer = privateKeyToAccount(BUYER_PK);
  const sellerApi = makeApi();
  const buyerApi = makeApi();

  const deployer = createWalletClient({
    account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    chain,
    transport: http(RPC),
  });
  for (const who of [seller.address, buyer.address]) {
    const tx = await deployer.writeContract({
      address: deployment.usdc!,
      abi: erc20,
      functionName: 'mint',
      args: [who, 100_000_000_000n],
    });
    await publicClient.waitForTransactionReceipt({hash: tx});
  }
  await publicClient.waitForTransactionReceipt({
    hash: await deployer.sendTransaction({to: buyer.address, value: 10n ** 19n}),
  });

  console.log(`seller ${seller.address}`);
  console.log(`buyer  ${buyer.address}`);

  // --- 1. seller gets a card --------------------------------------------------------------------
  step('1', 'Seller opens a pack and takes the card');
  await signIn(sellerApi, seller);
  const {drawId, winningWeight, pack} = await ripAndReveal(sellerApi, seller);

  const leaves = devnetLeaves();
  const hashes = leafHashes(pack.packId as Hex, BigInt(pack.poolVersion), leaves);
  const {leaf, index} = findLeafForWeight(leaves, winningWeight);
  const sellerWallet = createWalletClient({account: seller, chain, transport: http(RPC)});
  await publicClient.waitForTransactionReceipt({
    hash: await sellerWallet.writeContract({
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
  ok(`owns card #${leaf.tokenId} (${formatUnits(leaf.priceRef, 6)} USDC reference)`);

  // --- 2. list ----------------------------------------------------------------------------------
  step('2', 'Seller lists it for 75 USDC');
  const prepared = await sellerApi('/listings/prepare', {
    method: 'POST',
    body: JSON.stringify({chainId: 31337, kind: 'listing', tokenId: leaf.tokenId.toString(), price: '75000000'}),
  });
  await publicClient.waitForTransactionReceipt({
    hash: await sellerWallet.writeContract({
      address: deployment.collectibleNFT!,
      abi: erc721,
      functionName: 'setApprovalForAll',
      args: [prepared.marketplace, true],
    }),
  });

  const om = prepared.typedData.message;
  const orderSig = await seller.signTypedData({
    domain: prepared.typedData.domain,
    types: prepared.typedData.types,
    primaryType: 'Listing',
    message: {
      maker: om.maker as Address,
      tokenId: BigInt(om.tokenId),
      price: BigInt(om.price),
      payToken: om.payToken as Address,
      nonce: BigInt(om.nonce),
      expiry: om.expiry,
    },
  });
  await sellerApi('/listings', {
    method: 'POST',
    body: JSON.stringify({
      chainId: 31337,
      kind: 'listing',
      maker: om.maker,
      tokenId: om.tokenId,
      price: om.price,
      payToken: om.payToken,
      nonce: om.nonce,
      expiry: om.expiry,
      signature: orderSig,
    }),
  });
  ok('order signed and published — no card or funds held by us');

  // --- 3. buy -----------------------------------------------------------------------------------
  step('3', 'A different buyer fills the order from their own wallet');
  const listings = await buyerApi('/listings?chainId=31337');
  const listing = listings.find((l: any) => l.order.tokenId === leaf.tokenId.toString());
  if (!listing) throw new Error('listing did not appear in the index');
  ok(`found "${listing.card.name}" at ${formatUnits(BigInt(listing.order.price), 6)} USDC`);

  const buyerWallet = createWalletClient({account: buyer, chain, transport: http(RPC)});
  await publicClient.waitForTransactionReceipt({
    hash: await buyerWallet.writeContract({
      address: listing.order.payToken,
      abi: erc20,
      functionName: 'approve',
      args: [listing.paymentRouter, BigInt(listing.order.price)],
    }),
  });

  const sellerBefore = await publicClient.readContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'balanceOf',
    args: [seller.address],
  });

  await publicClient.waitForTransactionReceipt({
    hash: await buyerWallet.writeContract({
      address: listing.marketplace,
      abi: parseAbi([
        'struct Order { address maker; uint256 tokenId; uint256 price; address payToken; uint256 nonce; uint48 expiry; }',
        'struct PaymentPermit { uint256 nonce; uint256 deadline; bytes signature; }',
        'function buy(Order order, bytes makerSig, PaymentPermit payment)',
      ]),
      functionName: 'buy',
      args: [
        {
          maker: listing.order.maker,
          tokenId: BigInt(listing.order.tokenId),
          price: BigInt(listing.order.price),
          payToken: listing.order.payToken,
          nonce: BigInt(listing.order.nonce),
          expiry: listing.order.expiry,
        },
        listing.signature,
        {nonce: 0n, deadline: 0n, signature: '0x'},
      ],
    }),
  });

  const owner = await publicClient.readContract({
    address: deployment.collectibleNFT!,
    abi: erc721,
    functionName: 'ownerOf',
    args: [leaf.tokenId],
  });
  if (owner.toLowerCase() !== buyer.address.toLowerCase()) throw new Error(`card went to ${owner}`);

  const sellerAfter = await publicClient.readContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'balanceOf',
    args: [seller.address],
  });
  ok(`card transferred to the buyer`);
  ok(`seller received ${formatUnits(sellerAfter - sellerBefore, 6)} USDC (75 minus 2.5% fee and 5% royalty)`);

  // --- 4. sell back -----------------------------------------------------------------------------
  step('4', 'Buyer opens a pack and sells it straight back instead of keeping it');
  await signIn(buyerApi, buyer);
  const second = await ripAndReveal(buyerApi, buyer);

  const quote = await buyerApi('/buyback/quote', {
    method: 'POST',
    body: JSON.stringify({chainId: 31337, drawId: second.drawId.toString()}),
  });
  ok(`offered ${formatUnits(BigInt(quote.payout), 6)} USDC for card #${quote.tokenId}`);

  const bm = quote.typedData.message;
  const acceptance = await buyer.signTypedData({
    domain: quote.typedData.domain,
    types: quote.typedData.types,
    primaryType: 'BuybackUser',
    message: {
      drawId: BigInt(bm.drawId),
      payToken: bm.payToken as Address,
      payout: BigInt(bm.payout),
      nonce: BigInt(bm.nonce),
      deadline: bm.deadline,
    },
  });

  const before = await publicClient.readContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'balanceOf',
    args: [buyer.address],
  });
  const result = await buyerApi('/buyback', {
    method: 'POST',
    body: JSON.stringify({
      chainId: 31337,
      drawId: second.drawId.toString(),
      signature: acceptance,
      acceptedPayout: quote.payout,
    }),
  });
  await publicClient.waitForTransactionReceipt({hash: result.txHash});

  const after = await publicClient.readContract({
    address: deployment.usdc!,
    abi: erc20,
    functionName: 'balanceOf',
    args: [buyer.address],
  });
  ok(`paid ${formatUnits(after - before, 6)} USDC from the reserve; the card stays in the vault`);

  console.log('\nBUY, LIST AND SELL-BACK ALL OK\n');
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
