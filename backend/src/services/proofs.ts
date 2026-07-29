import {encodeFunctionData, type Hex} from 'viem';
import {getChain} from '../chains.js';
import {gachaAbi} from '../lib/abi.js';
import {query} from '../db/index.js';
import {buildProof, findLeafForWeight, leafHashes, verifyProof, type PoolLeaf} from '../lib/merkle.js';
import {config} from '../config.js';

/**
 * Settlement proof generation (spec §8.2).
 *
 * The backend produces these purely as a convenience — the contract re-verifies every one of them, so
 * a wrong or malicious proof simply reverts. That is deliberate: it means this service can be buggy,
 * offline or hostile without any user losing their card, which is what makes shipping the equivalent
 * logic as a static offline tool (`tools/proof-generator`) an honest escape hatch rather than a
 * marketing line.
 */

export interface LeafProof {
  tokenId: bigint;
  cumBefore: bigint;
  weight: bigint;
  priceRef: bigint;
  leafIndex: bigint;
  proof: Hex[];
}

interface LeafRow {
  leaf_index: number;
  token_id: string;
  cum_before: string;
  weight: string;
  price_ref: string;
}

export async function loadPoolLeaves(chainId: number, packId: Hex, version: bigint): Promise<PoolLeaf[]> {
  const rows = await query<LeafRow>(
    `SELECT leaf_index, token_id, cum_before, weight, price_ref
       FROM pool_leaves WHERE chain_id = $1 AND pack_id = $2 AND version = $3
      ORDER BY leaf_index ASC`,
    [chainId, packId, version.toString()],
  );
  if (rows.length === 0) {
    throw new Error(`No pool leaves cached for ${packId} v${version} on chain ${chainId}`);
  }
  return rows.map((r) => ({
    tokenId: BigInt(r.token_id),
    cumBefore: BigInt(r.cum_before),
    weight: BigInt(r.weight),
    priceRef: BigInt(r.price_ref),
  }));
}

export async function buildLeafProof(args: {
  chainId: number;
  packId: Hex;
  version: bigint;
  winningWeight: bigint;
}): Promise<LeafProof> {
  const chain = getChain(args.chainId);
  const leaves = await loadPoolLeaves(args.chainId, args.packId, args.version);
  const hashes = leafHashes(args.packId, args.version, leaves);

  const {leaf, index} = findLeafForWeight(leaves, args.winningWeight);
  const proof = buildProof(hashes, index);

  // Verify against the root the CHAIN holds, not the one we computed. If our cached pool file has
  // drifted from what was committed, this is where it must fail — loudly, before we submit.
  const onChain = await chain.client.readContract({
    address: chain.deployment.gachaMachine,
    abi: gachaAbi,
    functionName: 'getPoolVersion',
    args: [args.packId, args.version],
  });
  if (!verifyProof(proof, onChain.root, hashes[index]!)) {
    throw new Error(
      `Generated proof does not verify against the on-chain root for ${args.packId} v${args.version}. ` +
        `The cached pool file does not match the committed version — do not submit.`,
    );
  }

  return {
    tokenId: leaf.tokenId,
    cumBefore: leaf.cumBefore,
    weight: leaf.weight,
    priceRef: leaf.priceRef,
    leafIndex: BigInt(index),
    proof,
  };
}

/**
 * Ready-to-broadcast calldata for a user who wants to settle without us.
 * Surfaced by `GET /draws/:chainId/:drawId/self-settle` and mirrored by the offline tool.
 */
export function encodeSettleCalldata(drawId: bigint, proof: LeafProof, viaTimeout: boolean): Hex {
  return encodeFunctionData({
    abi: gachaAbi,
    functionName: viaTimeout ? 'claimAfterTimeout' : 'settle',
    args: [drawId, proof],
  });
}

export function encodeClaimUnavailableCalldata(drawId: bigint, proof: LeafProof): Hex {
  return encodeFunctionData({abi: gachaAbi, functionName: 'claimUnavailable', args: [drawId, proof]});
}

export function encodeRefundCalldata(drawId: bigint): Hex {
  return encodeFunctionData({abi: gachaAbi, functionName: 'refundStuckRip', args: [drawId]});
}

/**
 * Everything a user needs to recover their draw with no help from us: the contract to call, the
 * calldata, the CID of the pool file the proof came from, and where to get the offline tool.
 */
export async function selfServeInstructions(args: {
  chainId: number;
  drawId: bigint;
}): Promise<{
  to: Hex;
  calldata: Hex;
  method: string;
  poolCid: string | null;
  proofTool: string;
  note: string;
}> {
  const chain = getChain(args.chainId);
  const draw = await chain.client.readContract({
    address: chain.deployment.gachaMachine,
    abi: gachaAbi,
    functionName: 'getDraw',
    args: [args.drawId],
  });

  if (draw.user === '0x0000000000000000000000000000000000000000') throw new Error('unknown draw');
  if (draw.settled) throw new Error('draw already resolved');

  const cidRow = await query<{pool_cid: string}>(
    `SELECT pool_cid FROM pool_versions WHERE chain_id = $1 AND pack_id = $2 AND version = $3`,
    [args.chainId, draw.packId, draw.poolVersion.toString()],
  );
  const poolCid = cidRow[0]?.pool_cid ?? null;

  if (!draw.revealed) {
    return {
      to: chain.deployment.gachaMachine,
      calldata: encodeRefundCalldata(args.drawId),
      method: 'refundStuckRip',
      poolCid,
      proofTool: config.PROOF_TOOL_URL,
      note:
        'Randomness has not arrived for this draw. Once the reveal timeout has passed, anyone can call ' +
        'refundStuckRip and the escrowed payment returns to you. This path is never pausable.',
    };
  }

  const proof = await buildLeafProof({
    chainId: args.chainId,
    packId: draw.packId,
    version: draw.poolVersion,
    winningWeight: draw.winningWeight,
  });

  return {
    to: chain.deployment.gachaMachine,
    calldata: encodeSettleCalldata(args.drawId, proof, true),
    method: 'claimAfterTimeout',
    poolCid,
    proofTool: config.PROOF_TOOL_URL,
    note:
      'Once the buyback window has passed, anyone can call claimAfterTimeout and the card goes to you. ' +
      'This path is never pausable, so it works even if we are paused or gone. You can regenerate this ' +
      'calldata yourself from the pool file at the CID above using the offline tool.',
  };
}
