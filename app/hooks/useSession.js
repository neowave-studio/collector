"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage, useChainId } from "wagmi";
import { api } from "../lib/api";

/**
 * The statement shown in the wallet's signing prompt.
 *
 * EIP-4361 restricts this to RFC 3986 reserved/unreserved characters plus space, so it must stay
 * plain ASCII. A single em-dash, curly quote or ellipsis makes the whole message unparseable, and
 * sign-in then fails before any of the server's checks even run. `backend/test/siwe.test.ts` pins it.
 */
const SIWE_STATEMENT =
  "Sign in to Collector. This does not authorise any payment: every purchase is signed separately " +
  "and shows you its exact terms.";

/**
 * Sign-In With Ethereum.
 *
 * The message we sign is built here but the nonce comes from the server and is single-use, so a
 * captured signature cannot be replayed. The server independently re-validates domain, chainId,
 * nonce and the time bounds — this component is a convenience, not the security boundary.
 */
export function useSession() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.session());
    } catch {
      setSession({ authenticated: false });
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Re-check whenever the connected wallet changes, not only on mount.
   *
   * `refresh` has no dependencies, so with `[refresh]` this ran exactly once — before the wallet was
   * connected, when the answer is always "not authenticated". Connecting afterwards changed nothing,
   * and the UI kept showing the signed-out state until the page was reloaded by hand. Keying on the
   * address means connecting, disconnecting and switching accounts each re-ask the server.
   */
  useEffect(() => {
    void refresh();
  }, [refresh, address, isConnected]);

  // A session is bound to one wallet. If the user switches accounts in their wallet, the old session
  // no longer describes who is here, so drop it rather than showing another address's state.
  useEffect(() => {
    if (session?.authenticated && address && session.address !== address.toLowerCase()) {
      void api.logout().finally(refresh);
    }
  }, [address, session, refresh]);

  const signIn = useCallback(async () => {
    if (!isConnected || !address) throw new Error("Connect a wallet first");
    setError(null);
    try {
      const { nonce, domain } = await api.nonce();
      const issuedAt = new Date().toISOString();
      const message =
        `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n` +
        `${SIWE_STATEMENT}

` +
        `URI: ${window.location.origin}\nVersion: 1\nChain ID: ${chainId}\n` +
        `Nonce: ${nonce}\nIssued At: ${issuedAt}`;

      const signature = await signMessageAsync({ message });
      await api.verify(message, signature);
      await refresh();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [address, chainId, isConnected, refresh, signMessageAsync]);

  const signOut = useCallback(async () => {
    await api.logout();
    await refresh();
  }, [refresh]);

  return {
    session,
    loading,
    error,
    signIn,
    signOut,
    refresh,
    isAuthenticated: Boolean(session?.authenticated),
    compliance: session?.compliance ?? null,
  };
}
