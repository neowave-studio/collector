"use client";

import { useCallback, useState } from "react";
import { useAccount, useChainId, useConfig, useSignTypedData } from "wagmi";
import {
  readContract,
  simulateContract,
  writeContract,
  waitForTransactionReceipt,
} from "wagmi/actions";
import { BaseError, ContractFunctionRevertedError, erc20Abi, parseAbi } from "viem";
import { api, formatUnits } from "../lib/api";

/**
 * The Marketplace surface, including every custom error it can raise.
 *
 * The errors matter as much as the functions: without them in the ABI viem cannot decode a revert,
 * so a perfectly ordinary refusal ("that is your own listing") reaches the user as a raw selector —
 * or worse, as whatever the wallet invents after gas estimation fails.
 */
const marketplaceAbi = parseAbi([
  "struct Order { address maker; uint256 tokenId; uint256 price; address payToken; uint256 nonce; uint48 expiry; }",
  "struct PaymentPermit { uint256 nonce; uint256 deadline; bytes signature; }",
  "function buy(Order order, bytes makerSig, PaymentPermit payment)",
  "function cancel(Order order, bool isListing)",
  "error OrderExpired(uint48 expiry)",
  "error NonceAlreadyUsed(address maker, uint256 nonce)",
  "error NonceBelowMinimum(uint256 nonce, uint256 minimum)",
  "error InvalidSignature()",
  "error NotTokenOwner(uint256 tokenId, address caller)",
  "error MakerIsNotOwner(uint256 tokenId, address maker)",
  "error SelfTrade()",
  "error ZeroPrice()",
  "error PayoutExceedsPrice(uint256 fee, uint256 royalty, uint256 price)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

/**
 * Turns a revert into something a collector can act on.
 *
 * Each branch names the fact that stopped the trade and, where the user can do something about it,
 * what that is. Anything we have not anticipated falls through to the raw name rather than being
 * flattened into a generic apology — an unrecognised error is worth reporting accurately.
 */
function explainRevert(err) {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const args = reverted.data?.args ?? [];
      switch (name) {
        case "SelfTrade":
          return "This is your own listing — you can't buy your own card. Cancel it instead.";
        case "OrderExpired":
          return "This listing expired. Ask the seller to relist it.";
        case "NonceAlreadyUsed":
          return "Someone bought this card first.";
        case "NonceBelowMinimum":
          return "The seller cancelled this listing on-chain.";
        case "MakerIsNotOwner":
          return "The seller no longer owns this card, so the order can't be filled.";
        case "NotTokenOwner":
          return "You no longer own this card.";
        case "InvalidSignature":
          return "The seller's signature doesn't match this order.";
        case "ZeroPrice":
          return "This order has no price.";
        case "ERC20InsufficientBalance":
          return `Not enough balance — you hold $${formatUnits(args[1] ?? 0n, 6)} and this costs $${formatUnits(args[2] ?? 0n, 6)}.`;
        case "ERC20InsufficientAllowance":
          return "The payment approval didn't go through. Try again.";
        default:
          if (name) return name;
      }
    }
  }
  return err?.shortMessage ?? err?.message ?? "The transaction failed.";
}

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

        // Simulate before sending. This is what turns a revert into a sentence: the node runs the
        // call, viem decodes the custom error against the ABI above, and nothing reaches the wallet.
        // Skipping it meant a refusal like SelfTrade surfaced only when the wallet's gas estimation
        // failed — and the wallet then guessed a near-block-limit gas figure, so the user was shown
        // "transaction gas limit too high", which names neither the cause nor anything they can fix.
        const { request } = await simulateContract(wagmiConfig, {
          chainId: listing.chainId,
          account: address,
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

        const hash = await writeContract(wagmiConfig, request);
        await waitForTransactionReceipt(wagmiConfig, { chainId: listing.chainId, hash });
        return hash;
      } catch (err) {
        setError(explainRevert(err));
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [address, wagmiConfig]
  );

  /**
   * Cancels the caller's own listing, irrevocably.
   *
   * On-chain first, index second. The signature is the thing that actually authorises a sale, so
   * removing the row from our index alone would leave a live order that anyone holding a copy could
   * still fill — the delete endpoint says as much. Burning the nonce on-chain is what makes it true;
   * the index delete is then only tidying up discovery.
   */
  const cancel = useCallback(
    async (listing) => {
      setError(null);
      setBusy(`cancel:${listing.id}`);
      try {
        const { request } = await simulateContract(wagmiConfig, {
          chainId: listing.chainId,
          account: address,
          address: listing.marketplace,
          abi: marketplaceAbi,
          functionName: "cancel",
          args: [
            {
              maker: listing.order.maker,
              tokenId: BigInt(listing.order.tokenId),
              price: BigInt(listing.order.price),
              payToken: listing.order.payToken,
              nonce: BigInt(listing.order.nonce),
              expiry: listing.order.expiry,
            },
            true,
          ],
        });

        const hash = await writeContract(wagmiConfig, request);
        await waitForTransactionReceipt(wagmiConfig, { chainId: listing.chainId, hash });
        await api.cancelListing(listing.id);
        return hash;
      } catch (err) {
        setError(explainRevert(err));
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
        setError(explainRevert(err));
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [address, signTypedDataAsync, wagmiConfig]
  );

  return { buy, list, cancel, busy, error, chainId };
}
