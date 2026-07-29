import {describe, expect, it} from 'vitest';
import {SiweMessage} from 'siwe';

/**
 * Pins the sign-in message the frontend actually sends.
 *
 * EIP-4361 restricts the `statement` line to RFC 3986 reserved/unreserved characters plus space.
 * A single em-dash makes `new SiweMessage()` throw, and sign-in then fails before ANY of the server's
 * checks run — which is precisely the bug this test exists to prevent recurring. It is easy to
 * reintroduce, because an em-dash is invisible in review and looks like better typography.
 */

/** Must stay byte-identical to `SIWE_STATEMENT` in `app/hooks/useSession.js`. */
const STATEMENT =
  'Sign in to Collector. This does not authorise any payment: every purchase is signed separately ' +
  'and shows you its exact terms.';

function buildMessage(statement: string): string {
  return (
    `localhost:3000 wants you to sign in with your Ethereum account:\n` +
    `0xC1725953BE260ECd5c5CA21eb5524D4986aFD06F\n\n` +
    `${statement}\n\n` +
    `URI: http://localhost:3000\nVersion: 1\nChain ID: 31337\n` +
    `Nonce: 33adc5dd65e85f2f8cbee280f94df7a1\nIssued At: 2026-07-29T00:36:32.289Z`
  );
}

describe('SIWE message', () => {
  it('the statement the frontend sends is plain ASCII', () => {
    // eslint-disable-next-line no-control-regex
    expect(STATEMENT).toMatch(/^[\x20-\x7E]+$/);
  });

  it('parses as valid EIP-4361', () => {
    const parsed = new SiweMessage(buildMessage(STATEMENT));
    expect(parsed.address).toBe('0xC1725953BE260ECd5c5CA21eb5524D4986aFD06F');
    expect(parsed.chainId).toBe(31337);
    expect(parsed.nonce).toBe('33adc5dd65e85f2f8cbee280f94df7a1');
    expect(parsed.statement).toBe(STATEMENT);
  });

  it('rejects the em-dash that caused the original failure', () => {
    // The exact statement that produced "invalid message: max line number was 6" and a 500.
    const withEmDash =
      'Sign in to Collector. This does not authorise any payment \u2014 every purchase is signed ' +
      'separately and shows you its exact terms.';
    expect(() => new SiweMessage(buildMessage(withEmDash))).toThrow();
  });

  it('rejects other typographic characters that look harmless', () => {
    for (const char of ['\u2018', '\u2019', '\u201C', '\u201D', '\u2026', '\u00A0']) {
      expect(() => new SiweMessage(buildMessage(`Sign in${char}to Collector.`))).toThrow();
    }
  });
});
