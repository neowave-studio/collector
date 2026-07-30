"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId } from "wagmi";
import { api, formatUnits } from "../lib/api";
import { chainName } from "../lib/wagmi";
import { useMarketplace } from "../hooks/useMarketplace";
import { useSession } from "../hooks/useSession";
import Reveal from "../components/Reveal";
import Pagination from "../components/Pagination";
import Card from "../components/Card";
import { CardGridSkeleton } from "../components/Skeleton";

/**
 * The marketplace.
 *
 * Every card here is a real signed order fetched from the order-book index and filled directly by the
 * buyer's wallet — there is no escrow and no relayer in this path. Cards you own can be listed by
 * signing an order; the price lives inside that signature, so nobody (including us) can alter it.
 *
 * Both grids paginate. The order book is fetched a page-set at a time rather than in full, so the
 * page does not get slower as the market grows.
 */
const PER_PAGE = 9;

export default function MarketplacePage() {
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { isAuthenticated } = useSession();
  const queryClient = useQueryClient();
  const { buy, list, cancel, busy, error } = useMarketplace();

  const [tab, setTab] = useState("browse");
  const [priceInput, setPriceInput] = useState({});
  const [notice, setNotice] = useState(null);
  const [browsePage, setBrowsePage] = useState(1);
  const [minePage, setMinePage] = useState(1);

  const { data: listings, isLoading } = useQuery({
    queryKey: ["listings", chainId],
    queryFn: () => api.listings({ chainId, limit: 100 }),
    refetchInterval: 15_000,
  });

  const { data: myCards } = useQuery({
    queryKey: ["myCards"],
    queryFn: api.myCards,
    enabled: isAuthenticated,
  });

  // The contracts every trade actually runs through, exposed so a buyer can check the addresses their
  // wallet is about to sign against rather than trusting the UI.
  const { data: mktConfig } = useQuery({
    queryKey: ["marketplaceConfig"],
    queryFn: api.marketplaceConfig,
  });
  // Prefer the connected chain; fall back to the primary config entry so the addresses are still shown
  // before a wallet is connected (chainId can be undefined until then).
  const contracts = mktConfig?.find((c) => c.chainId === chainId) ?? mktConfig?.[0];

  // A page slice that survives the list shrinking underneath it — a fill or an expiry can remove a
  // row between refetches, and landing on a blank page after buying something reads as a failure.
  const paged = (items, page) => {
    const all = items ?? [];
    const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    const current = Math.min(page, totalPages);
    return {
      totalPages,
      current,
      total: all.length,
      visible: all.slice((current - 1) * PER_PAGE, current * PER_PAGE),
    };
  };

  const browse = paged(listings, browsePage);
  const mine = paged(myCards, minePage);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["listings"] });
    void queryClient.invalidateQueries({ queryKey: ["myCards"] });
  };

  const onBuy = async (listing) => {
    setNotice(null);
    try {
      const hash = await buy(listing);
      setNotice({ kind: "ok", text: `Bought ${listing.card.name}. ${hash.slice(0, 12)}…` });
      refresh();
    } catch {
      /* surfaced via `error` */
    }
  };

  const onCancel = async (listing) => {
    setNotice(null);
    try {
      await cancel(listing);
      setNotice({ kind: "ok", text: `${listing.card.name} delisted. The order can no longer be filled.` });
      refresh();
    } catch {
      /* surfaced via `error` */
    }
  };

  const onList = async (card) => {
    setNotice(null);
    const raw = priceInput[card.tokenId];
    if (!raw || Number(raw) <= 0) {
      setNotice({ kind: "bad", text: "Enter a price first." });
      return;
    }
    try {
      // USDC has 6 decimals. Round to integer units before signing so no float artefact reaches a
      // signature the contract will then enforce to the last unit.
      const units = BigInt(Math.round(Number(raw) * 1e6));
      await list({ card, priceUnits: units });
      setNotice({ kind: "ok", text: `${card.name} listed for $${raw}.` });
      setPriceInput((p) => ({ ...p, [card.tokenId]: "" }));
      refresh();
    } catch {
      /* surfaced via `error` */
    }
  };

  return (
    <main className="min-h-screen pt-[130px] pb-24 lg:px-8 md:px-6 px-4">
      <div className="max-w-[1300px] mx-auto">
        <Reveal y={20}>
          <div className="flex items-center gap-3 mb-3">
            <span className="iri-divider w-8" />
            <span className="font-mono-data text-[11px] tracking-[0.35em] uppercase iri-text">
              Peer to peer
            </span>
          </div>
          <h1 className="font-sf-pro-rounded text-white text-[30px] md:text-[38px] font-bold tracking-[-0.02em] mb-2">
            Marketplace
          </h1>
          <p className="text-white/50 text-[14px] leading-[1.6] max-w-[620px] mb-8">
            Cards trade directly between collectors. Your wallet fills the seller&apos;s signed order
            on-chain — we never hold the card or the money, and the price is inside the signature.
          </p>
        </Reveal>

        <div className="flex gap-2 mb-6">
          {[
            ["browse", `Browse${listings ? ` (${listings.length})` : ""}`],
            ["mine", `My cards${myCards ? ` (${myCards.length})` : ""}`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`btn-anim px-4 py-2 rounded-xl text-[13.5px] font-semibold transition-colors ${
                tab === key
                  ? "nav-active text-white border border-[#FFFFFF47]"
                  : "glass-soft text-white/50 hover:text-white/85 border border-transparent"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(notice || error) && (
          <div
            className={`glass rounded-xl px-4 py-3 mb-5 text-[13.5px] ${
              error || notice?.kind === "bad" ? "text-[#ff6b6b]" : "text-[#2BD383]"
            }`}
          >
            {error ?? notice?.text}
          </div>
        )}

        {tab === "browse" && (
          <>
            {isLoading && <CardGridSkeleton count={6} />}
            {!isLoading && (!listings || listings.length === 0) && (
              <div className="glass rounded-2xl p-8 text-center">
                <p className="text-white/60 text-[15px] mb-1">No cards listed yet.</p>
                <p className="text-white/35 text-[13.5px]">
                  Open a pack, then list what you pull from the <strong>My cards</strong> tab.
                </p>
              </div>
            )}

            {/*
              Staggered reveal, as on the original design. The delay is capped so a full page of
              results still finishes animating quickly — an uncapped `index * 60` would leave the last
              tile of a 9-card grid arriving half a second after the first, which reads as lag.
            */}
            {/*
              A seller cannot fill their own order — the Marketplace reverts with SelfTrade. Offering
              a Buy button on your own listing promises something the contract refuses, and the
              refusal arrives as a wallet gas error rather than an explanation, so the listing owner
              gets the action that does exist instead.
            */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {browse.visible.map((listing, i) => {
                const isMine =
                  address && listing.order.maker.toLowerCase() === address.toLowerCase();
                return (
                <Reveal key={listing.id} y={24} delay={Math.min(i * 60, 320)}>
                  <Card
                    href={`/card/${listing.order.tokenId}?chainId=${listing.chainId}`}
                    name={listing.card.name}
                    subtitle={listing.card.setName ?? "—"}
                    year={listing.card.year}
                    grade={listing.card.grade}
                    imageUrl={listing.card.imageUrl}
                    valueLabel="Asking price"
                    value={formatUnits(listing.order.price, 6)}
                    action={
                      isMine ? (
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-[#FFD36B] text-[13px] font-semibold">
                            Your listing
                          </span>
                          <button
                            onClick={() => onCancel(listing)}
                            disabled={busy === `cancel:${listing.id}`}
                            className="btn-anim rounded-xl border border-[#FFFFFF1A] px-4 py-2.5 text-white/70 hover:text-white text-[13.5px] font-semibold transition-colors disabled:opacity-50 shrink-0"
                          >
                            {busy === `cancel:${listing.id}` ? "Cancelling…" : "Cancel"}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => onBuy(listing)}
                          disabled={!isConnected || busy === `buy:${listing.id}`}
                          className="buy-now-button btn-anim w-full rounded-[16px] border px-3 py-3.5 border-[#FFFFFF1A] font-[600] text-[15px] disabled:opacity-50"
                        >
                          <span className="buy-now-button-text">
                            {busy === `buy:${listing.id}`
                              ? "Confirm in wallet…"
                              : !isConnected
                                ? "Connect wallet"
                                : "Buy now"}
                          </span>
                        </button>
                      )
                    }
                  />
                </Reveal>
                );
              })}
            </div>

            {browse.totalPages > 1 && (
              <div className="mt-6">
                <Pagination
                  currentPage={browse.current}
                  totalPages={browse.totalPages}
                  onPageChange={setBrowsePage}
                  totalItems={browse.total}
                  itemsPerPage={PER_PAGE}
                />
              </div>
            )}
          </>
        )}

        {tab === "mine" && (
          <>
            {!isAuthenticated && (
              <div className="glass rounded-2xl p-8 text-center">
                <p className="text-white/60 text-[15px]">Sign in to see the cards you own.</p>
              </div>
            )}

            {isAuthenticated && !myCards && <CardGridSkeleton count={3} />}

            {isAuthenticated && myCards?.length === 0 && (
              <div className="glass rounded-2xl p-8 text-center">
                <p className="text-white/60 text-[15px] mb-1">You don&apos;t own any cards yet.</p>
                <a href="/gacha" className="link-underline text-white/80 text-[13.5px]">
                  Open a pack →
                </a>
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {mine.visible.map((card, i) => (
                <Reveal key={card.tokenId} y={24} delay={Math.min(i * 60, 320)}>
                  <Card
                    href={`/card/${card.tokenId}?chainId=${card.chainId}`}
                    name={card.name}
                    subtitle={`#${card.tokenId} · ${card.setName ?? "—"}`}
                    year={card.year}
                    grade={card.grade}
                    imageUrl={card.imageUrl}
                    action={
                      card.listing ? (
                        <p className="text-[#2BD383] text-[13.5px] font-semibold py-3">
                          Listed for ${formatUnits(card.listing.price, 6)}
                        </p>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            value={priceInput[card.tokenId] ?? ""}
                            onChange={(e) =>
                              setPriceInput((p) => ({ ...p, [card.tokenId]: e.target.value }))
                            }
                            placeholder="Price in USDC"
                            inputMode="decimal"
                            className="flex-1 min-w-0 bg-[#0a0a0a] border border-[#FFFFFF1A] rounded-xl px-3 py-2.5 text-white text-[13.5px] transition-colors focus:outline-none focus:border-[#2BD383]/50"
                          />
                          <button
                            onClick={() => onList(card)}
                            disabled={busy === `list:${card.tokenId}`}
                            className="buy-now-button btn-anim rounded-xl border px-4 py-2.5 border-[#FFFFFF1A] font-[600] text-[13.5px] disabled:opacity-50 shrink-0"
                          >
                            <span className="buy-now-button-text">
                              {busy === `list:${card.tokenId}` ? "Signing…" : "List"}
                            </span>
                          </button>
                        </div>
                      )
                    }
                  />
                </Reveal>
              ))}
            </div>

            {mine.totalPages > 1 && (
              <div className="mt-6">
                <Pagination
                  currentPage={mine.current}
                  totalPages={mine.totalPages}
                  onPageChange={setMinePage}
                  totalItems={mine.total}
                  itemsPerPage={PER_PAGE}
                />
              </div>
            )}
          </>
        )}
        {contracts && (
          <Reveal y={20}>
            <div className="glass-soft rounded-xl p-4 mt-10">
              <p className="font-mono-data text-[10px] tracking-[0.24em] uppercase text-white/40 mb-2.5">
                On-chain contracts · {chainName(chainId)} · {Number(contracts.feeBps) / 100}% fee
              </p>
              <div className="font-mono-data text-[11px] text-white/45 space-y-1 break-all">
                <div>
                  <span className="text-white/30">marketplace</span> {contracts.marketplace}
                </div>
                <div>
                  <span className="text-white/30">payment router</span> {contracts.paymentRouter}
                </div>
                <div>
                  <span className="text-white/30">collectible NFT</span> {contracts.collectibleNFT}
                </div>
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </main>
  );
}
