"use client";

import Link from "next/link";
import Reveal from "../components/Reveal";

/**
 * How it works.
 *
 * A plain-language walk-through of the one loop the whole product is built around: fund, open, let
 * Chainlink decide, then keep / ship / sell. Every claim on this page is something the Verify page
 * lets a user check on-chain, so the two are deliberately linked — this explains, that proves.
 */

const STEPS = [
  {
    n: "01",
    title: "Fund your wallet",
    body: "Connect a wallet and top up with cUSD. On testnet you claim it free from the faucet; on mainnet you buy USDC with a card or Apple Pay. The balance is yours — it only leaves your wallet when you sign a purchase.",
  },
  {
    n: "02",
    title: "Open a pack",
    body: "You sign the exact terms first: the pack, the committed odds version, the price and the pay token. That signature is what the contract enforces — neither we nor a compromised relayer can charge more or move you onto different odds. Your payment is then escrowed on-chain.",
  },
  {
    n: "03",
    title: "Chainlink VRF reveals your card",
    body: "The pack asks Chainlink for a verifiable random number. Nobody — not you, not us, not the node answering — knows the outcome until it lands on-chain. That number, mapped against the committed odds, decides your card.",
  },
  {
    n: "04",
    title: "Keep it, ship it, or sell it",
    body: "The card is yours the moment it is revealed. Keep it in the vault, redeem it for the physical graded card, list it to another collector, or sell it straight back to us at an on-chain-capped price.",
  },
];

const OPTIONS = [
  {
    tag: "Keep",
    color: "#2BD383",
    badge: "rarity-s",
    title: "Hold it in the vault",
    body: "The graded card sits in the vault as an NFT you own outright. Nothing expires; take one of the other paths whenever you like.",
  },
  {
    tag: "Redeem",
    color: "#6B8AFF",
    badge: "rarity-b",
    title: "Ship the physical card",
    body: "Burn the token to have the real, graded, slabbed card shipped to you. The on-chain certificate is bound to that exact card — one card, one token, forever.",
  },
  {
    tag: "Trade",
    color: "#FFD36B",
    badge: "rarity-a",
    title: "Sell to another collector",
    body: "List it on the marketplace. The price lives inside your signature and the buyer fills it wallet-to-wallet — no escrow, no relayer, and nobody can alter your price.",
  },
  {
    tag: "Sell back",
    color: "#8BE9FF",
    badge: "rarity-b",
    title: "Instant sell-back to us",
    body: "Take an instant offer of up to 85% of the card's committed reference value. That money is reserved on-chain the moment your draw is revealed — before you are ever offered a sell-back.",
  },
];

const FAIR = [
  {
    label: "Committed odds",
    title: "Fixed before you buy",
    body: "The contract builds each pack's Merkle root from a card list it has verified tiles every outcome exactly once — no gaps, no overlaps, no duplicates. A committed version is write-once, and a version switch is announced blocks in advance, so odds can never be edited around your purchase.",
  },
  {
    label: "Real randomness",
    title: "Decided by Chainlink VRF",
    body: "The winning card comes from a Chainlink VRF word, not a server-side roll. The randomness and its proof are published on-chain, so the outcome is independently verifiable and impossible for anyone to predict or steer.",
  },
];

export default function HowItWorksPage() {
  return (
    <main className="min-h-screen pt-[130px] pb-24 lg:px-8 md:px-6 px-4">
      <div className="max-w-[980px] mx-auto">
        {/* --- hero ---------------------------------------------------------------------------- */}
        <Reveal y={20}>
          <div className="flex items-center gap-3 mb-3">
            <span className="iri-divider w-8" />
            <span className="font-mono-data text-[11px] tracking-[0.35em] uppercase iri-text">
              How it works
            </span>
          </div>
          <h1 className="font-sf-pro-rounded text-white text-[32px] md:text-[44px] font-bold tracking-[-0.02em] leading-[1.08] max-w-[720px]">
            Open a pack. Own the card. Or sell it back.
          </h1>
          <p className="text-white/55 text-[15px] leading-[1.65] mt-4 max-w-[640px]">
            Collector is a provably-fair pack opener for graded trading cards. The odds are fixed
            on-chain before you buy, a Chainlink random number decides your pull, and whatever you get
            is yours to keep, ship, trade, or sell straight back. Here is the whole loop.
          </p>
          <div className="flex flex-wrap gap-3 mt-7">
            <Link
              href="/gacha"
              className="px-6 py-3 font-[700] text-[15px] text-white nav-active rounded-[12px] border border-[#FFFFFF47]"
            >
              Open a pack
            </Link>
            <Link
              href="/verify"
              className="glass-soft rounded-[12px] px-6 py-3 text-[15px] font-semibold text-white/85 hover:text-white border border-[#FFFFFF1A] transition-colors"
            >
              Verify it yourself
            </Link>
          </div>
        </Reveal>

        {/* --- the loop ------------------------------------------------------------------------ */}
        <section className="mt-16">
          <Reveal y={20}>
            <div className="flex items-center gap-3 mb-6">
              <span className="iri-divider w-8" />
              <span className="font-mono-data text-[11px] tracking-[0.3em] uppercase text-white/45">
                The loop
              </span>
            </div>
          </Reveal>

          <div className="space-y-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} y={24} delay={Math.min(i * 80, 320)}>
                <div className="glass rounded-2xl p-6 flex gap-5 md:gap-7 items-start">
                  <span className="font-mono-data iri-text text-[22px] md:text-[26px] font-bold shrink-0 leading-none pt-0.5">
                    {s.n}
                  </span>
                  <div>
                    <h3 className="text-white font-semibold text-[17px] md:text-[18px] mb-1.5">
                      {s.title}
                    </h3>
                    <p className="text-white/55 text-[13.5px] md:text-[14px] leading-[1.6]">
                      {s.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* --- provably fair ------------------------------------------------------------------- */}
        <section className="mt-16">
          <Reveal y={20}>
            <div className="flex items-center gap-3 mb-2">
              <span className="iri-divider w-8" />
              <span className="font-mono-data text-[11px] tracking-[0.3em] uppercase text-white/45">
                Provably fair
              </span>
            </div>
            <h2 className="font-sf-pro-rounded text-white text-[24px] md:text-[30px] font-bold tracking-[-0.02em] mb-6">
              Two things you never have to take on faith
            </h2>
          </Reveal>

          <div className="grid md:grid-cols-2 gap-4">
            {FAIR.map((f, i) => (
              <Reveal key={f.label} y={24} delay={i * 90}>
                <div className="glass rounded-2xl p-6 h-full">
                  <span className="font-mono-data text-[10.5px] tracking-[0.24em] uppercase iri-text">
                    {f.label}
                  </span>
                  <h3 className="text-white font-semibold text-[17px] mt-2 mb-2">{f.title}</h3>
                  <p className="text-white/55 text-[13.5px] leading-[1.6]">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* --- what you can do with a card ----------------------------------------------------- */}
        <section className="mt-16">
          <Reveal y={20}>
            <div className="flex items-center gap-3 mb-2">
              <span className="iri-divider w-8" />
              <span className="font-mono-data text-[11px] tracking-[0.3em] uppercase text-white/45">
                Your card
              </span>
            </div>
            <h2 className="font-sf-pro-rounded text-white text-[24px] md:text-[30px] font-bold tracking-[-0.02em] mb-6">
              Four things you can do with every pull
            </h2>
          </Reveal>

          <div className="grid sm:grid-cols-2 gap-4">
            {OPTIONS.map((o, i) => (
              <Reveal key={o.tag} y={24} delay={Math.min(i * 70, 280)}>
                <div className="glass rounded-2xl p-6 h-full">
                  <span
                    className={`${o.badge} inline-flex items-center px-2.5 py-0.5 rounded-lg text-[12px] font-bold`}
                    style={{ color: o.color }}
                  >
                    {o.tag}
                  </span>
                  <h3 className="text-white font-semibold text-[16.5px] mt-3 mb-1.5">{o.title}</h3>
                  <p className="text-white/55 text-[13.5px] leading-[1.6]">{o.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* --- protection ---------------------------------------------------------------------- */}
        <section className="mt-16">
          <Reveal y={24}>
            <div className="glass rounded-2xl p-6 md:p-8">
              <div className="flex items-center gap-3 mb-2">
                <span className="iri-divider w-8" />
                <span className="font-mono-data text-[11px] tracking-[0.3em] uppercase text-white/45">
                  Backed &amp; escapable
                </span>
              </div>
              <h2 className="font-sf-pro-rounded text-white text-[22px] md:text-[26px] font-bold tracking-[-0.02em] mb-3">
                Your card and your money don&apos;t depend on us being here
              </h2>
              <p className="text-white/55 text-[13.5px] leading-[1.6] mb-5 max-w-[680px]">
                Every sell-back offer is booked as an on-chain liability the moment a draw is revealed,
                and we can only withdraw what sits above those obligations after a public 48-hour
                delay. If we vanished, these paths would still work — they are permissionless and we
                cannot pause them:
              </p>
              <ul className="space-y-2.5">
                {[
                  ["claimAfterTimeout", "once the sell-back window passes, anyone can deliver a revealed draw — always to whoever owns it, never to whoever sends the transaction."],
                  ["refundStuckRip", "if the random number never arrives, the escrowed payment goes back to the buyer."],
                  ["claimUnavailable", "if your card was already won by an earlier draw, you are paid its committed reference value from the reserve."],
                ].map(([fn, desc]) => (
                  <li key={fn} className="glass-soft rounded-xl p-3.5 flex gap-3 items-start">
                    <span className="font-mono-data text-[12px] text-[#2BD383] shrink-0 pt-0.5">
                      {fn}
                    </span>
                    <span className="text-white/55 text-[13px] leading-[1.55]">{desc}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/verify"
                className="link-underline text-white/70 hover:text-white text-[13.5px] inline-block mt-5"
              >
                See the live proof of reserves and the offline verifier →
              </Link>
            </div>
          </Reveal>
        </section>

        {/* --- cta ----------------------------------------------------------------------------- */}
        <Reveal y={24}>
          <div className="mt-12 text-center">
            <h2 className="font-sf-pro-rounded text-white text-[22px] md:text-[26px] font-bold tracking-[-0.02em] mb-4">
              Ready to open one?
            </h2>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link
                href="/gacha"
                className="px-7 py-3 font-[700] text-[15px] text-white nav-active rounded-[12px] border border-[#FFFFFF47]"
              >
                Open a pack
              </Link>
              <Link
                href="/marketplace"
                className="glass-soft rounded-[12px] px-7 py-3 text-[15px] font-semibold text-white/85 hover:text-white border border-[#FFFFFF1A] transition-colors"
              >
                Browse the marketplace
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </main>
  );
}
