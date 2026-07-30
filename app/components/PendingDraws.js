"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { sendTransaction } from "wagmi/actions";
import { api } from "../lib/api";
import { useSession } from "../hooks/useSession";

/**
 * The self-serve escape hatch for one draw.
 *
 * `/self-settle` hands back the exact transaction (to + calldata) that delivers or refunds this draw
 * with no involvement from us — the same claimAfterTimeout / refundStuckRip path the Verify page
 * describes. The point is that it is real and usable, not just documented: copy the calldata into any
 * wallet, or send it straight from the connected one. Neither path can be paused by us.
 */
function SelfRecover({ draw }) {
  const wagmiConfig = useConfig();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sendMsg, setSendMsg] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["selfSettle", draw.chain_id, draw.draw_id],
    queryFn: () => api.selfSettle(draw.chain_id, String(draw.draw_id)),
    enabled: open,
    retry: false,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.calldata);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the calldata is on screen to copy by hand */
    }
  };

  const send = async () => {
    setSending(true);
    setSendMsg(null);
    try {
      const hash = await sendTransaction(wagmiConfig, {
        to: data.to,
        data: data.calldata,
        chainId: draw.chain_id,
      });
      setSendMsg({ ok: true, text: `Submitted from your wallet · ${hash.slice(0, 12)}…` });
    } catch (e) {
      setSendMsg({ ok: false, text: e?.shortMessage ?? e?.message ?? "Could not send from wallet." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="link-underline text-white/45 hover:text-white/80 text-[12px]"
      >
        {open ? "Hide self-recovery" : "Recover it yourself, without us →"}
      </button>
      {open && (
        <div className="mt-2 glass rounded-lg p-3">
          {isLoading && <p className="text-white/40 text-[12px]">Building the transaction…</p>}
          {error && <p className="text-[#ff8080] text-[12px]">{error.message}</p>}
          {data && (
            <>
              <p className="text-white/55 text-[12px] leading-[1.55] mb-2.5">{data.note}</p>
              <p className="font-mono-data text-[10px] tracking-[0.2em] uppercase text-white/35 mb-1.5">
                {data.method} · raw transaction
              </p>
              <div className="font-mono-data text-[11px] text-white/50 break-all glass-soft rounded-md p-2.5 mb-2.5">
                <div>
                  <span className="text-white/30">to</span> {data.to}
                </div>
                <div className="mt-1">
                  <span className="text-white/30">data</span> {data.calldata}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={copy}
                  className="glass-soft rounded-lg px-3 py-1.5 text-[12px] text-white/75 hover:text-white border border-[#FFFFFF1A]"
                >
                  {copied ? "Copied" : "Copy calldata"}
                </button>
                <button
                  onClick={send}
                  disabled={sending}
                  className="buy-now-button rounded-lg border px-3 py-1.5 border-[#FFFFFF1A] text-[12px] disabled:opacity-50"
                >
                  <span className="buy-now-button-text">
                    {sending ? "Confirm in wallet…" : "Send from my wallet"}
                  </span>
                </button>
              </div>
              {sendMsg && (
                <p className={`text-[12px] mt-2 ${sendMsg.ok ? "text-[#2BD383]" : "text-[#ff8080]"}`}>
                  {sendMsg.text}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Unclaimed / stuck draws.
 *
 * A draw can be revealed (the card is decided and yours) but not yet delivered to your wallet — after
 * a refresh the pack-open modal is gone, so this surfaces those draws with the one action that
 * finishes them. It also shows a draw whose randomness has not landed, where the escrowed payment is
 * refundable by anyone. Nothing here is required for safety: the card/refund is claimable on-chain
 * regardless; this is just the convenient path.
 */
export default function PendingDraws() {
  const { isConnected } = useAccount();
  const { isAuthenticated } = useSession();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const { data: draws } = useQuery({
    queryKey: ["myDraws"],
    queryFn: api.myDraws,
    enabled: isConnected && isAuthenticated,
    refetchInterval: 20_000,
  });

  const pending = (draws ?? []).filter(
    (d) => d.status === "revealed" || d.status === "requested",
  );
  if (pending.length === 0) return null;

  const claim = async (d) => {
    setNotice(null);
    setBusy(d.draw_id);
    try {
      await api.settleDraw(d.chain_id, String(d.draw_id));
      setNotice({ kind: "ok", text: "Delivery submitted — the card is on its way to your wallet." });
      void queryClient.invalidateQueries({ queryKey: ["myDraws"] });
      void queryClient.invalidateQueries({ queryKey: ["myCards"] });
    } catch (e) {
      setNotice({
        kind: "bad",
        text: e?.message ?? "Could not settle now — your card is still held safely on-chain.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-[1300px] mx-auto lg:px-8 md:px-6 px-4 -mt-4 mb-10">
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="iri-divider w-8" />
          <span className="font-mono-data text-[11px] tracking-[0.3em] uppercase iri-text">
            Unclaimed pulls
          </span>
        </div>
        <p className="text-white/55 text-[13px] leading-[1.5] mb-4">
          A draw you opened is revealed but not yet in your wallet. Claim it whenever you like — it is
          held on-chain and cannot be lost.
        </p>

        {notice && (
          <p
            className={`text-[12.5px] mb-3 ${
              notice.kind === "bad" ? "text-[#ff6b6b]" : "text-[#2BD383]"
            }`}
          >
            {notice.text}
          </p>
        )}

        <div className="space-y-2.5">
          {pending.map((d) => (
            <div key={`${d.chain_id}-${d.draw_id}`} className="glass-soft rounded-xl p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white/85 text-[13.5px] font-semibold">Draw #{d.draw_id}</p>
                  <p className="font-mono-data text-[11px] text-white/40 mt-0.5">
                    {d.status === "revealed"
                      ? "revealed · ready to claim"
                      : "awaiting randomness · refundable"}
                  </p>
                </div>
                {d.status === "revealed" ? (
                  <button
                    onClick={() => claim(d)}
                    disabled={busy === d.draw_id}
                    className="buy-now-button rounded-xl border px-4 py-2.5 border-[#FFFFFF1A] font-[600] text-[13px] disabled:opacity-50 shrink-0"
                  >
                    <span className="buy-now-button-text">
                      {busy === d.draw_id ? "Claiming…" : "Claim now"}
                    </span>
                  </button>
                ) : (
                  <span className="text-white/40 text-[12px] shrink-0">Pending…</span>
                )}
              </div>
              <SelfRecover draw={d} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
