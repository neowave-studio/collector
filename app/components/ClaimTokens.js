"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { formatUnits } from "../lib/api";

/**
 * Self-service test-token faucet.
 *
 * Calls the token's `mint()` directly from the user's own wallet. There is no backend step and no
 * relayer: routing this through our API would add a service that can fail and a key that can be
 * drained, for a button whose whole job is "give yourself play money".
 *
 * `mint()` rather than `claim()` on purpose. The token also has a `claim()` with a 24-hour per-address
 * cooldown, which reads like a limit and is not one — `mint()` is public on the same contract, so
 * anyone can take any amount regardless. Showing a countdown next to an unrestricted mint would be
 * theatre, and the copy below says what is actually true instead.
 *
 * Rendered only where `/chains` reports a faucet, so it cannot appear on a chain whose pay token is
 * real money. The contract's constructor refuses production chain ids as the second of the two guards.
 */

const FAUCET_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{type: "address"}, {type: "uint256"}],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256"}],
  },
];

export default function ClaimTokens({ faucet, pack, className = "" }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const enabled = Boolean(faucet?.token && address && client);

  const { data: balance, refetch } = useQuery({
    queryKey: ["faucet", chainId, faucet?.token, address],
    enabled,
    refetchInterval: 30_000,
    queryFn: () =>
      client.readContract({
        address: faucet.token,
        abi: FAUCET_ABI,
        functionName: "balanceOf",
        args: [address],
      }),
  });

  if (!faucet?.token) return null;

  const amount = formatUnits(faucet.claimAmount, faucet.decimals, 0);

  // Stated in packs, because that is the unit the number actually matters in.
  const packs =
    pack?.pricePerRip && BigInt(pack.pricePerRip) > 0n
      ? Number(BigInt(faucet.claimAmount) / BigInt(pack.pricePerRip))
      : null;

  const getTokens = async () => {
    setError(null);
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: faucet.token,
        abi: FAUCET_ABI,
        functionName: "mint",
        args: [address, BigInt(faucet.claimAmount)],
      });
      await client.waitForTransactionReceipt({hash});
      await refetch();
    } catch (err) {
      setError(err?.shortMessage ?? err?.message ?? "The wallet declined it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`glass rounded-2xl p-5 ${className}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <p className="font-mono-data text-[10.5px] tracking-[0.2em] uppercase text-white/40 mb-1">
            Test funds
          </p>
          <p className="text-white/85 text-[14px] font-semibold">
            Get {amount} {faucet.symbol}
            {packs ? <span className="text-white/40 font-normal"> · about {packs} packs</span> : null}
          </p>
        </div>
        {balance !== undefined && (
          <div className="text-right">
            <p className="font-mono-data text-[10px] tracking-[0.2em] uppercase text-white/40 mb-1">
              You hold
            </p>
            <p className="text-white text-[15px] font-semibold tabular-nums">
              {formatUnits(balance, faucet.decimals)}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={getTokens}
        disabled={!isConnected || busy}
        className="buy-now-button w-full rounded-xl border px-3 py-3 border-[#FFFFFF1A] font-[600] text-[14px] disabled:opacity-50"
      >
        <span className="buy-now-button-text">
          {!isConnected
            ? "Connect wallet"
            : busy
              ? "Confirm in wallet…"
              : `Get ${amount} ${faucet.symbol}`}
        </span>
      </button>

      {error && <p className="text-[#ff6b6b] text-[12px] mt-2.5 leading-[1.5]">{error}</p>}

      <p className="text-white/30 text-[11.5px] mt-3 leading-[1.55]">
        {faucet.symbol} is a test token with no value. Minting is open to anyone on this network and
        unlimited, so take it as many times as you need — and read nothing into the reserve&apos;s size,
        which is funded from the same tap.
      </p>
    </div>
  );
}
