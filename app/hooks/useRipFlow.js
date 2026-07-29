"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSignTypedData, useConfig } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi } from "viem";
import { api } from "../lib/api";

/**
 * The pack-opening flow, end to end.
 *
 *   quote → the user signs the exact terms → relay → wait for Chainlink VRF → reveal
 *
 * Two things are worth understanding about the shape of this:
 *
 *  - The signature step is not ceremony. What the user signs pins the pool version, the price and the
 *    pay token, so neither we nor a compromised relayer can charge more or move them onto different
 *    odds — the contract reverts if any of it changes.
 *
 *  - The wait is real randomness arriving, not an animation timer. `winningWeight` comes from
 *    Chainlink VRF, so nobody — including us — knows the outcome until it lands. The UI deliberately
 *    surfaces this instead of pretending the roll happens instantly.
 */

const PHASES = /** @type {const} */ ([
  "idle",
  "quoting",
  "awaiting_approval",
  "awaiting_signature",
  "submitting",
  "awaiting_randomness",
  "revealed",
  "error",
]);

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function useRipFlow({ chainId, packId }) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const wagmiConfig = useConfig();

  const [phase, setPhase] = useState("idle");
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [draw, setDraw] = useState(null);

  const pollRef = useRef(null);
  const cancelled = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    cancelled.current = true;
    stopPolling();
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setPhase("idle");
    setTerms(null);
    setError(null);
    setTxHash(null);
    setDraw(null);
  }, [stopPolling]);

  /** Fetches the terms so they can be shown BEFORE anything is signed or charged (spec §12). */
  const quote = useCallback(
    async (numRips = 1) => {
      setError(null);
      setPhase("quoting");
      try {
        const result = await api.ripQuote(chainId, packId, numRips);
        setTerms(result);
        setPhase("awaiting_signature");
        return result;
      } catch (err) {
        setError(err);
        setPhase("error");
        throw err;
      }
    },
    [chainId, packId]
  );

  const open = useCallback(
    async (numRips = 1) => {
      setError(null);
      try {
        const quoted = terms ?? (await quote(numRips));

        // The PaymentRouter pulls the payment, so it needs an ERC-20 allowance first. Permit2 would
        // fold this into the same signature, but it is not deployed on every chain — so the allowance
        // path has to work, and that means an approval transaction the first time.
        //
        // The amount charged is still bounded by the user's PurchaseAuth signature below, never by
        // this allowance: approving does not authorise a purchase on its own.
        const total = BigInt(quoted.terms.totalCost);
        const allowance = await readContract(wagmiConfig, {
          chainId,
          address: quoted.terms.payToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, quoted.terms.paymentRouter],
        });

        if (allowance < total) {
          setPhase("awaiting_approval");
          const approvalHash = await writeContract(wagmiConfig, {
            chainId,
            address: quoted.terms.payToken,
            abi: erc20Abi,
            functionName: "approve",
            args: [quoted.terms.paymentRouter, total],
          });
          await waitForTransactionReceipt(wagmiConfig, { chainId, hash: approvalHash });
        }

        setPhase("awaiting_signature");
        const signature = await signTypedDataAsync({
          domain: quoted.typedData.domain,
          types: quoted.typedData.types,
          primaryType: quoted.typedData.primaryType,
          message: quoted.typedData.message,
        });

        setPhase("submitting");
        const submitted = await api.rip({
          chainId,
          packId,
          numRips,
          auth: quoted.typedData.message,
          signature,
        });
        setTxHash(submitted.txHash);

        setPhase("awaiting_randomness");
        await waitForReveal();
      } catch (err) {
        setError(err);
        setPhase("error");
      }
    },
    [chainId, packId, quote, signTypedDataAsync, terms]
  );

  /**
   * Polls for the draw that this rip created.
   *
   * If this ever times out the user has NOT lost anything: the payment is escrowed on-chain and the
   * draw is either deliverable via `claimAfterTimeout` or refundable via `refundStuckRip`, both of
   * which anyone can call and neither of which we can pause. `/draws/:chainId/:drawId/self-settle`
   * hands them the exact transaction.
   */
  const waitForReveal = useCallback(() => {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const tick = async () => {
        if (cancelled.current) return;
        try {
          const mine = await api.myDraws();
          const latest = mine?.[0];
          if (latest && (latest.status === "revealed" || latest.status === "delivered")) {
            stopPolling();
            const detail = await api.draw(latest.chain_id ?? chainId, latest.draw_id);
            setDraw({ ...latest, ...detail });
            setPhase("revealed");
            resolve(detail);
            return;
          }
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            stopPolling();
            setError(
              new Error(
                "Randomness has not arrived yet. Your payment is safe and held on-chain — this draw " +
                  "is either claimable or refundable by anyone, including you, without us."
              )
            );
            setPhase("error");
            resolve(null);
          }
        } catch {
          // Transient backend errors must not end the wait: the draw exists on-chain regardless.
        }
      };

      void tick();
      pollRef.current = setInterval(tick, POLL_INTERVAL_MS);
    });
  }, [chainId, stopPolling]);

  /**
   * Takes delivery of the drawn card now.
   *
   * Choosing to keep used to mean only "close this dialog": the card stayed in the vault until the
   * buyback window elapsed and a worker delivered it, so for minutes afterwards it was in neither
   * place the user would look. Settling on request makes the choice do what it says.
   *
   * Failure here is not costly and deliberately does not surface as a blocking error — the draw is
   * already the user's, and `claimAfterTimeout` delivers it regardless once the window passes.
   */
  const keep = useCallback(
    async (drawId) => {
      try {
        return await api.settleDraw(chainId, String(drawId));
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [chainId]
  );

  /**
   * Sells the just-drawn card back at the price the oracle quotes.
   *
   * Three independent authorisations are required on-chain and this only supplies one of them: the
   * user's signature accepting the price. The oracle signs the price itself, a separate key submits
   * it, and the payout is capped by the card's committed reference value regardless of all three.
   */
  const sellBack = useCallback(
    async (drawId) => {
      setError(null);
      try {
        const quoted = await api.buybackQuote(chainId, String(drawId));

        const signature = await signTypedDataAsync({
          domain: quoted.typedData.domain,
          types: quoted.typedData.types,
          primaryType: quoted.typedData.primaryType,
          message: {
            drawId: BigInt(quoted.typedData.message.drawId),
            payToken: quoted.typedData.message.payToken,
            payout: BigInt(quoted.typedData.message.payout),
            nonce: BigInt(quoted.typedData.message.nonce),
            deadline: quoted.typedData.message.deadline,
          },
        });

        return await api.buyback(chainId, String(drawId), signature, quoted.payout);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [chainId, signTypedDataAsync]
  );

  return {
    phase,
    phases: PHASES,
    keep,
    sellBack,
    terms,
    error,
    txHash,
    draw,
    address,
    quote,
    open,
    reset,
    isBusy: ["quoting", "awaiting_signature", "submitting", "awaiting_randomness"].includes(phase),
  };
}
