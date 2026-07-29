"use client";

import { useCallback, useState } from "react";
import { useAccount, useChainId, useConfig, useSignTypedData } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi, parseAbi } from "viem";
import { api } from "../lib/api";

const marketplaceAbi = parseAbi([
  "struct Order { address maker; uint256 tokenId; uint256 price; address payToken; uint256 nonce; uint48 expiry; }",
  "struct PaymentPermit { uint256 nonce; uint256 deadline; bytes signature; }",
  "function buy(Order order, bytes makerSig, PaymentPermit payment)",
  "function cancel(Order order, bool isListing)",
]);

const erc721Abi = parseAbi([
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

/**
 * Marketplace actions.
 *
 * The buyer fills an order **from their own wallet** — there is no relayer and no escrow service in
 * this path. Our backend only indexed the signed order; the contract re-verifies the maker's
 * signature, the expiry and the nonce, and splits fee and royalty atomically.
 *
 * That is why a marketplace trade needs no jurisdiction gate: it is an ordinary sale of a known item
 * at a known price, not a paid random outcome.
 */
export function useMarketplace() {
  const { address } = useAccount();
  const chainId = useChainId();
  const wagmiConfig = useConfig();
  const { signTypedDataAsync } = useSignTypedData();

  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  /** Buys a listed card: approve the pay token if needed, then fill on-chain. */
  const buy = useCallback(
    async (listing) => {
      setError(null);
      setBusy(`buy:${listing.id}`);
      try {
        const price = BigInt(listing.order.price);

        const allowance = await readContract(wagmiConfig, {
          chainId: listing.chainId,
          address: listing.order.payToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, listing.paymentRouter],
        });

        if (allowance < price) {
          const approveHash = await writeContract(wagmiConfig, {
            chainId: listing.chainId,
            address: listing.order.payToken,
            abi: erc20Abi,
            functionName: "approve",
            args: [listing.paymentRouter, price],
          });
          await waitForTransactionReceipt(wagmiConfig, { chainId: listing.chainId, hash: approveHash });
        }

        const hash = await writeContract(wagmiConfig, {
          chainId: listing.chainId,
          address: listing.marketplace,
          abi: marketplaceAbi,
          functionName: "buy",
          args: [
            {
              maker: listing.order.maker,
              tokenId: BigInt(listing.order.tokenId),
              price,
              payToken: listing.order.payToken,
              nonce: BigInt(listing.order.nonce),
              expiry: listing.order.expiry,
            },
            listing.signature,
            { nonce: 0n, deadline: 0n, signature: "0x" },
          ],
        });
        await waitForTransactionReceipt(wagmiConfig, { chainId: listing.chainId, hash });
        return hash;
      } catch (err) {
        setError(err.shortMessage ?? err.message);
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [address, wagmiConfig]
  );

  /** Lists a card: approve the Marketplace to move it, sign the order, publish it. */
  const list = useCallback(
    async ({ card, priceUnits }) => {
      setError(null);
      setBusy(`list:${card.tokenId}`);
      try {
        const prepared = await api.prepareListing({
          chainId: card.chainId,
          kind: "listing",
          tokenId: String(card.tokenId),
          price: priceUnits.toString(),
        });

        // The contract moves the card from the seller on fill, so it needs operator approval. Doing
        // it now means the buyer's fill cannot fail on something only the seller could have fixed.
        const approved = await readContract(wagmiConfig, {
          chainId: card.chainId,
          address: card.collectibleNFT,
          abi: erc721Abi,
          functionName: "isApprovedForAll",
          args: [address, prepared.marketplace],
        });
        if (!approved) {
          const hash = await writeContract(wagmiConfig, {
            chainId: card.chainId,
            address: card.collectibleNFT,
            abi: erc721Abi,
            functionName: "setApprovalForAll",
            args: [prepared.marketplace, true],
          });
          await waitForTransactionReceipt(wagmiConfig, { chainId: card.chainId, hash });
        }

        const msg = prepared.typedData.message;
        const signature = await signTypedDataAsync({
          domain: prepared.typedData.domain,
          types: prepared.typedData.types,
          primaryType: prepared.typedData.primaryType,
          message: {
            maker: msg.maker,
            tokenId: BigInt(msg.tokenId),
            price: BigInt(msg.price),
            payToken: msg.payToken,
            nonce: BigInt(msg.nonce),
            expiry: msg.expiry,
          },
        });

        return await api.publishListing({
          chainId: card.chainId,
          kind: "listing",
          maker: msg.maker,
          tokenId: msg.tokenId,
          price: msg.price,
          payToken: msg.payToken,
          nonce: msg.nonce,
          expiry: msg.expiry,
          signature,
        });
      } catch (err) {
        setError(err.shortMessage ?? err.message);
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [address, signTypedDataAsync, wagmiConfig]
  );

  return { buy, list, busy, error, chainId };
}
