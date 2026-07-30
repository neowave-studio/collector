"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useChainId, usePublicClient, useWriteContract } from "wagmi";
import { formatUnits } from "../lib/api";

/**
 * Self-service test-token faucet.
 *
 * Calls `claim()` on the faucet token directly from the user's own wallet. There is no backend step
 * and no relayer: the contract's only rule is one claim per address per cooldown, which it enforces
 * itself. Routing this through our API would add a service that can fail, a key that can be drained,
 * and a queue to explain — for a button whose entire job is "mint yourself test money".
 *
 * Rendered only where `/chains` reports a faucet, so it cannot appear on a chain whose pay token is
 * real money. The contract refuses to deploy to a production chain id as well; this is the second of
 * the two guards, not the only one.
 */

const FAUCET_ABI = [
  {type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: []},
  {
    type: "function",
    name: "claimAvailableIn",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{type: "address"}],
    outputs: [{type: "uint256"}],
  },
];

function humanWait(seconds) {
  if (seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

export default function ClaimTokens({ faucet, className = "" }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const enabled = Boolean(faucet?.token && address && client);

  const { data, refetch } = useQuery({
    queryKey: ["faucet", chainId, faucet?.token, address],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [balance, waitFor] = await Promise.all([
        client.readContract({address: faucet.token, abi: FAUCET_ABI, functionName: "balanceOf", args: [address]}),
        client.readContract({
          address: faucet.token,
          abi: FAUCET_ABI,
          functionName: "claimAvailableIn",
          args: [address],
        }),
      ]);
      return {balance, waitFor: Number(waitFor)};
    },
  });

  if (!faucet?.token) return null;

  const wait = humanWait(data?.waitFor ?? 0);
  const amount = formatUnits(faucet.claimAmount, faucet.decimals, 0);

  const claim = async () => {
    setError(null);
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: faucet.token,
        abi: FAUCET_ABI,
        functionName: "claim",
      });
      await client.waitForTransactionReceipt({hash});
      await refetch();
    } catch (err) {
      setError(err?.shortMessage ?? err?.message ?? "The claim was declined.");
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
            Claim {amount} {faucet.symbol}
          </p>
        </div>
        {data?.balance !== undefined && (
          <div className="text-right">
            <p className="font-mono-data text-[10px] tracking-[0.2em] uppercase text-white/40 mb-1">
              You hold
            </p>
            <p className="text-white text-[15px] font-semibold tabular-nums">
              {formatUnits(data.balance, faucet.decimals)}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={claim}
        disabled={!isConnected || busy || Boolean(wait)}
        className="buy-now-button w-full rounded-xl border px-3 py-3 border-[#FFFFFF1A] font-[600] text-[14px] disabled:opacity-50"
      >
        <span className="buy-now-button-text">
          {!isConnected
            ? "Connect wallet"
            : busy
              ? "Confirm in wallet…"
              : wait
                ? `Claim again in ${wait}`
                : `Claim ${amount} ${faucet.symbol}`}
        </span>
      </button>

      {error && <p className="text-[#ff6b6b] text-[12px] mt-2.5 leading-[1.5]">{error}</p>}

      <p className="text-white/30 text-[11.5px] mt-3 leading-[1.55]">
        {faucet.symbol} is a test token with no value, mintable by anyone on this network. One claim per
        address every {faucet.cooldownHours} hours, enforced by the contract rather than by us.
      </p>
    </div>
  );
}
