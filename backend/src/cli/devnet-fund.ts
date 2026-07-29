/**
 * Funds any address with devnet test USDC and gas.
 *
 *   npm run devnet:fund -- 0xYourMetaMaskAddress
 *
 * `DeployLocal` only funds one demo account. Anyone testing from their own wallet needs their own
 * balance, and asking them to import a private key just to click a button is a poor first experience.
 */
import {createWalletClient, createPublicClient, http, parseAbi, isAddress, formatUnits, type Address} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';

const target = process.argv[2];
if (!target || !isAddress(target)) {
  console.error('usage: npm run devnet:fund -- 0xYourAddress');
  process.exit(1);
}

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

const usdc = parseAbi(['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)']);

const mintTx = await wallet.writeContract({
  address: deployment.usdc!,
  abi: usdc,
  functionName: 'mint',
  args: [target as Address, 100_000_000_000n], // 100,000 USDC
});
await publicClient.waitForTransactionReceipt({hash: mintTx});

const gasTx = await wallet.sendTransaction({to: target as Address, value: 10n ** 19n}); // 10 ETH
await publicClient.waitForTransactionReceipt({hash: gasTx});

const balance = await publicClient.readContract({
  address: deployment.usdc!,
  abi: usdc,
  functionName: 'balanceOf',
  args: [target as Address],
});

// Record the address. Every `npm run devnet` starts a brand-new chain and wipes all balances, so
// without this a tester silently ends up at 0 ETH and MetaMask greys out the confirm button with no
// explanation. The devnet runner re-funds everything in this file on startup.
const registryPath = join(here, '../../.devnet-funded.json');
const funded: string[] = existsSync(registryPath)
  ? (JSON.parse(readFileSync(registryPath, 'utf8')) as string[])
  : [];
if (!funded.some((a) => a.toLowerCase() === target.toLowerCase())) {
  funded.push(target);
  writeFileSync(registryPath, `${JSON.stringify(funded, null, 2)}
`);
}

console.log(`funded ${target}`);
console.log(`  ${formatUnits(balance, 6)} USDC`);
console.log(`  10 ETH for gas`);
console.log(`  USDC token address (add to MetaMask): ${deployment.usdc}`);
