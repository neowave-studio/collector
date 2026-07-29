/**
 * Devnet randomness daemon.
 *
 *   npm run devnet:vrf
 *
 * On a real chain Chainlink watches for `RipRequested` and answers it, and NOBODY — including us — can
 * choose or predict the word. The devnet has no Chainlink, so this stands in: it watches for the same
 * event and fulfils the mock coordinator after a short delay, so the UI behaves the way it will in
 * production instead of hanging on "waiting for randomness" forever.
 *
 * The word is drawn from the OS CSPRNG here. That is emphatically not a substitute for VRF — it is
 * unverifiable and this process could trivially cheat — which is exactly why the mock coordinator only
 * exists in `DeployLocal.s.sol` and can never be configured on a real deployment.
 */
import {createPublicClient, createWalletClient, http, parseAbi, type Address} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gachaAbi} from '../lib/abi.js';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
/** A visible pause so the reveal animation has something to show, like real VRF latency. */
const LATENCY_MS = Number(process.env.DEVNET_VRF_LATENCY_MS ?? 4000);

const deployment = JSON.parse(
  readFileSync(join(here, '../../../contracts/deployments/anvil.json'), 'utf8'),
) as Record<string, Address>;

const chain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
} as const;

const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet = createWalletClient({account, chain, transport: http(RPC)});
const publicClient = createPublicClient({chain, transport: http(RPC)});

const fulfilled = new Set<string>();
let cursor = 0n;

async function tick(): Promise<void> {
  const head = await publicClient.getBlockNumber();
  if (cursor === 0n) cursor = head > 500n ? head - 500n : 0n;
  if (cursor > head) return;

  const logs = await publicClient.getLogs({
    address: deployment.gachaMachine!,
    fromBlock: cursor,
    toBlock: head,
  });
  cursor = head + 1n;

  for (const log of logs) {
    let decoded;
    try {
      const {decodeEventLog} = await import('viem');
      decoded = decodeEventLog({abi: gachaAbi, data: log.data, topics: log.topics});
    } catch {
      continue;
    }
    if (decoded.eventName !== 'RipRequested') continue;

    const args = decoded.args as unknown as {vrfRequestId: bigint; firstDrawId: bigint; numRips: bigint};
    const key = args.vrfRequestId.toString();
    if (fulfilled.has(key)) continue;

    // Skip anything already revealed — this daemon may start after some draws exist.
    const draw = await publicClient.readContract({
      address: deployment.gachaMachine!,
      abi: gachaAbi,
      functionName: 'getDraw',
      args: [args.firstDrawId],
    });
    if (draw.revealed || draw.settled) {
      fulfilled.add(key);
      continue;
    }

    fulfilled.add(key);
    console.log(`randomness requested (${key}) — answering in ${LATENCY_MS}ms`);

    setTimeout(() => {
      void (async () => {
        try {
          const count = Number(args.numRips);
          const words = Array.from({length: count}, () => BigInt(`0x${randomBytes(32).toString('hex')}`));
          const hash = await wallet.writeContract({
            address: deployment.vrfCoordinator!,
            abi: parseAbi(['function fulfill(uint256,uint256[])']),
            functionName: 'fulfill',
            args: [args.vrfRequestId, words],
          });
          await publicClient.waitForTransactionReceipt({hash});
          console.log(`   delivered for request ${key} (${count} word${count === 1 ? '' : 's'})`);
        } catch (err) {
          console.error(`   failed for request ${key}:`, err instanceof Error ? err.message.split('\n')[0] : err);
          fulfilled.delete(key);
        }
      })();
    }, LATENCY_MS);
  }
}

console.log(`devnet VRF daemon watching ${deployment.gachaMachine} (latency ${LATENCY_MS}ms)`);
setInterval(() => void tick().catch(() => {}), 1500);
