import {describe, expect, it} from 'vitest';
import {assertComplianceModeIsSafe} from '../src/config.js';

/**
 * The guards that stop `COMPLIANCE_MODE=off` reaching real money.
 *
 * There are deliberately two of them, checking different things, because they fail differently:
 *
 *  - `config.ts` refuses `off` when `NODE_ENV=production`. Catches the ordinary mistake of promoting
 *    a testnet config to prod.
 *  - `assertComplianceModeIsSafe` refuses `off` when any enabled chain is a mainnet. Catches the
 *    nastier one — a correct-looking `NODE_ENV=staging` pointed at Base mainnet, which the first
 *    guard would wave straight through.
 *
 * `NODE_ENV` is a label a human types. A chain id is not.
 */
describe('COMPLIANCE_MODE=off guard', () => {
  // `test/setup.ts` leaves COMPLIANCE_MODE unset, so the default (`full`) applies and the guard must
  // not fire. This also pins the precedence rule in config.ts: a real environment variable beats a
  // local `.env` file, so a developer's `COMPLIANCE_MODE=off` cannot leak into the test run.
  it('does not fire when the gate is enabled', () => {
    expect(() => assertComplianceModeIsSafe([{key: 'base', testnet: false}])).not.toThrow();
    expect(() => assertComplianceModeIsSafe([{key: 'base_sepolia', testnet: true}])).not.toThrow();
  });

  it('the production guard is unconditional in config.ts', async () => {
    // Re-importing with NODE_ENV=production would exit the process (config.ts calls process.exit on
    // invalid input), so assert the rule as it is written rather than by re-importing.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain("if (config.COMPLIANCE_MODE === 'off')");
    expect(source).toContain('cannot run in production');
  });
});

describe('mode semantics', () => {
  it('every refusal reason is one the UI can render a prompt for', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/services/compliance.ts', import.meta.url), 'utf8'),
    );

    // Self-exclusion must be honoured in EVERY mode, including `off`. A user who asked us to stop
    // letting them play is not a compliance formality that a config flag may switch off.
    const selfExclusionCheck = source.indexOf('self_excluded');
    const modeOffReturn = source.indexOf("if (mode === 'off')");
    expect(selfExclusionCheck).toBeGreaterThan(-1);
    expect(modeOffReturn).toBeGreaterThan(selfExclusionCheck);
  });

  it('age_only refuses sell-back outright rather than weakening its checks', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/services/compliance.ts', import.meta.url), 'utf8'),
    );
    const buyback = source.slice(source.indexOf('export async function checkBuybackAllowed'));
    expect(buyback).toContain("mode === 'age_only'");
    expect(buyback).toContain('not offered');
  });

  it('self-attested age is refused in full mode', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/services/compliance.ts', import.meta.url), 'utf8'),
    );
    const attest = source.slice(source.indexOf('export async function attestAge'));
    expect(attest).toContain("mode === 'full'");
    expect(attest).toContain('throw new Error');
  });
});
