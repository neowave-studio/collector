/**
 * Delivers randomness on the devnet.
 *
 *   npm run devnet:reveal -- <vrfRequestId> [randomWord]
 *
 * On a real chain Chainlink does this and nobody can choose the outcome. The devnet uses a mock
 * coordinator so a tester can pick the word and land on a specific card — which is exactly why the
 * mock is confined to `DeployLocal.s.sol` and can never be configured on a real deployment.
 */
import {createWalletClient, createPublicClient, http, parseAbi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';

const requestId = process.argv[2];
if (!requestId) {
  console.error('usage: npm run devnet:reveal -- <vrfRequestId> [randomWord]');
  process.exit(1);
}
const word = BigInt(process.argv[3] ?? Math.floor(Math.random() * 1_000_000));

const deployment = JSON.parse(
  readFileSync(join(here, '../../../contracts/deployments/anvil.json'), 'utf8'),
) as Record<string, `0x${string}`>;

const chain = {
  id: 31337,
  name: 'Anvil',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
} as const;

const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const wallet = createWalletClient({account, chain, transport: http(RPC)});
const publicClient = createPublicClient({chain, transport: http(RPC)});

const hash = await wallet.writeContract({
  address: deployment.vrfCoordinator!,
  abi: parseAbi(['function fulfillOne(uint256,uint256)']),
  functionName: 'fulfillOne',
  args: [BigInt(requestId), word],
});
await publicClient.waitForTransactionReceipt({hash});
console.log(`randomness delivered for request ${requestId} (word ${word})`);
console.log(`tx ${hash}`);
