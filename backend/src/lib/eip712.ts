import type {Address, Hex, TypedDataDomain} from 'viem';
import type {ChainContext} from '../chains.js';

/**
 * EIP-712 payload definitions, mirroring the typehashes in `GachaMachine` and `Marketplace`.
 *
 * The domain carries `chainId` and `verifyingContract`. Since the suite is deployed at identical
 * CREATE2 addresses on every chain, `chainId` is the ONLY thing preventing a signature produced for
 * Base from being replayed on Polygon (spec §3 FIX M4-backend). Never construct one of these domains
 * without a chain id taken from the chain the user is actually transacting on.
 */

export function gachaDomain(chain: ChainContext): TypedDataDomain {
  return {
    name: 'CollectorGacha',
    version: '1',
    chainId: chain.chainId,
    verifyingContract: chain.deployment.gachaMachine,
  };
}

export function marketplaceDomain(chain: ChainContext): TypedDataDomain {
  return {
    name: 'CollectorMarketplace',
    version: '1',
    chainId: chain.chainId,
    verifyingContract: chain.deployment.marketplace,
  };
}

export const purchaseAuthTypes = {
  PurchaseAuth: [
    {name: 'user', type: 'address'},
    {name: 'packId', type: 'bytes32'},
    {name: 'poolVersion', type: 'uint256'},
    {name: 'numRips', type: 'uint96'},
    {name: 'payToken', type: 'address'},
    {name: 'amountPerRip', type: 'uint256'},
    {name: 'nonce', type: 'uint256'},
    {name: 'deadline', type: 'uint48'},
  ],
} as const;

/** Oracle-signed: the price we are willing to pay. */
export const buybackAuthTypes = {
  BuybackAuth: [
    {name: 'drawId', type: 'uint256'},
    {name: 'payToken', type: 'address'},
    {name: 'payout', type: 'uint256'},
    {name: 'nonce', type: 'uint256'},
    {name: 'deadline', type: 'uint48'},
  ],
} as const;

/**
 * User-signed: acceptance of that price. Same fields, DIFFERENT typehash — so neither party's
 * signature can ever stand in for the other's.
 */
export const buybackUserTypes = {
  BuybackUser: [
    {name: 'drawId', type: 'uint256'},
    {name: 'payToken', type: 'address'},
    {name: 'payout', type: 'uint256'},
    {name: 'nonce', type: 'uint256'},
    {name: 'deadline', type: 'uint48'},
  ],
} as const;

export const listingTypes = {
  Listing: [
    {name: 'maker', type: 'address'},
    {name: 'tokenId', type: 'uint256'},
    {name: 'price', type: 'uint256'},
    {name: 'payToken', type: 'address'},
    {name: 'nonce', type: 'uint256'},
    {name: 'expiry', type: 'uint48'},
  ],
} as const;

export const offerTypes = {
  Offer: [
    {name: 'maker', type: 'address'},
    {name: 'tokenId', type: 'uint256'},
    {name: 'price', type: 'uint256'},
    {name: 'payToken', type: 'address'},
    {name: 'nonce', type: 'uint256'},
    {name: 'expiry', type: 'uint48'},
  ],
} as const;

export interface PurchaseAuthMessage {
  user: Address;
  packId: Hex;
  poolVersion: bigint;
  numRips: bigint;
  payToken: Address;
  amountPerRip: bigint;
  nonce: bigint;
  deadline: number;
}

export interface BuybackAuthMessage {
  drawId: bigint;
  payToken: Address;
  payout: bigint;
  nonce: bigint;
  deadline: number;
}
