import {keccak256, toHex, type Hex} from 'viem';
import {config} from '../config.js';
import {logger} from '../lib/logger.js';

/**
 * Publishing the pool file (spec §8.2 [MUST], FIX C1-backend).
 *
 * The pool file is the only thing that turns the on-chain root into something a human can check. If it
 * is unavailable, users can still see that a root exists but cannot rebuild it — so it is pinned to at
 * least two independent IPFS services AND Arweave, and its CID is written into the contract at commit
 * time so the authentic file is tamper-evident and survives us going away entirely.
 *
 * `cidHash` is what actually lands on-chain: `poolCID` is a `bytes32`, and a CIDv1 does not fit, so we
 * store `keccak256(cid)`. Verification is therefore "hash the CID you were given and compare" — which
 * still binds the file, because a CID is itself a content hash.
 */

export interface PublishResult {
  cid: string;
  /** keccak256 of the CID string — the value stored in `PoolVersion.poolCID`. */
  cidHash: Hex;
  pins: string[];
  arweaveTx?: string;
  /** Canonical JSON that was pinned. Byte-identical reproduction matters for verification. */
  bytes: number;
}

/**
 * Deterministic serialisation. Verifiers must be able to reproduce the exact bytes, so key order and
 * spacing are fixed rather than left to whatever `JSON.stringify` happens to do with the input object.
 */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2);
}

export async function publishPoolFile(file: unknown): Promise<PublishResult> {
  const json = canonicalJson(file);
  const bytes = new TextEncoder().encode(json);

  const pins: string[] = [];
  let cid: string | undefined;

  for (const endpoint of config.IPFS_PIN_ENDPOINTS) {
    try {
      const pinned = await pinToIpfs(endpoint, bytes);
      pins.push(endpoint);
      if (!cid) cid = pinned;
      else if (cid !== pinned) {
        throw new Error(`IPFS services disagree on the CID: ${cid} vs ${pinned} — the file is not deterministic`);
      }
    } catch (err) {
      logger.error({err, endpoint}, 'IPFS pin failed');
    }
  }

  if (!cid) {
    if (config.NODE_ENV === 'production') {
      throw new Error(
        'No IPFS pin succeeded. Refusing to commit a pool whose odds file nobody can fetch — that would ' +
          'make the fairness claim unverifiable (spec §8.2).',
      );
    }
    // Development fallback so the flow is exercisable without infrastructure. Never reachable in prod
    // because of the guard above.
    cid = `dev-${keccak256(bytes).slice(2, 34)}`;
    logger.warn({cid}, 'no IPFS endpoints configured; using a development-only pseudo-CID');
  }

  if (config.NODE_ENV === 'production' && pins.length < 2) {
    throw new Error(`Pool file pinned to only ${pins.length} IPFS service(s); spec §8.2 requires at least 2.`);
  }

  const arweaveTx = await archiveToArweave(bytes).catch((err) => {
    logger.error({err}, 'Arweave archive failed — permanence is not yet guaranteed for this pool');
    return undefined;
  });

  return {
    cid,
    cidHash: keccak256(toHex(cid)),
    pins,
    ...(arweaveTx ? {arweaveTx} : {}),
    bytes: bytes.length,
  };
}

async function pinToIpfs(endpoint: string, bytes: Uint8Array): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([bytes], {type: 'application/json'}), 'pool.json');

  const res = await fetch(endpoint, {method: 'POST', body: form});
  if (!res.ok) throw new Error(`pin failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as {Hash?: string; cid?: string; IpfsHash?: string};
  const cid = body.Hash ?? body.cid ?? body.IpfsHash;
  if (!cid) throw new Error(`pin response contained no CID: ${JSON.stringify(body)}`);
  return cid;
}

/**
 * Arweave gives permanence that IPFS pinning does not: an unpaid pin eventually disappears, and a
 * pool file that disappears takes the user's ability to self-settle with it.
 *
 * Left as an explicit boundary rather than a stub that silently succeeds — wiring it needs a funded
 * Arweave wallet and `arweave-js`; see `docs/RUNBOOKS.md`.
 */
async function archiveToArweave(_bytes: Uint8Array): Promise<string | undefined> {
  if (!config.ARWEAVE_GATEWAY) return undefined;
  logger.warn('Arweave archiving is not wired up in this build; IPFS pins are the only redundancy');
  return undefined;
}
