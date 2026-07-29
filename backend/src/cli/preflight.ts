/**
 * Production preflight.
 *
 *   npm run preflight
 *
 * Answers one question: **would this configuration actually work, and is it safe?**
 *
 * It is deliberately paranoid about things that fail silently rather than loudly. A missing RPC key
 * announces itself on the first request; an unfunded reserve, an unset outflow cap, or a role granted
 * to the wrong address does not — it just quietly breaks a user's purchase or removes a control
 * someone is relying on.
 *
 * Exit codes: 0 = go, 1 = at least one blocker.
 */
import {config} from '../config.js';
import {allChains, initChains, type ChainContext} from '../chains.js';
import {gachaAbi, reserveVaultAbi, erc20Abi} from '../lib/abi.js';
import {initSigners} from '../services/signer.js';
import {pool, isEmbedded} from '../db/index.js';
import {keccak256, parseAbi, toBytes, type Address} from 'viem';
import Redis from 'ioredis';

type Level = 'pass' | 'warn' | 'fail';

interface Check {
  area: string;
  name: string;
  level: Level;
  detail: string;
  /** What to do about it, when it is not obvious. */
  fix?: string | undefined;
}

const checks: Check[] = [];
const record = (c: Check) => checks.push(c);

const accessAbi = parseAbi([
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function getRoleMemberCount(bytes32 role) view returns (uint256)',
  'function getRoleMember(bytes32 role, uint256 index) view returns (address)',
]);

const ROLE = {
  DEFAULT_ADMIN: '0x0000000000000000000000000000000000000000000000000000000000000000',
  SETTLEMENT: keccakRole('collector.role.SETTLEMENT'),
  GACHA: keccakRole('collector.role.GACHA'),
  TRUSTED_RELAYER: keccakRole('collector.role.TRUSTED_RELAYER'),
  TRUSTED_ORACLE: keccakRole('collector.role.TRUSTED_ORACLE'),
  TRUSTED_BUYBACK: keccakRole('collector.role.TRUSTED_BUYBACK'),
  POOL_AUTHOR: keccakRole('collector.role.POOL_AUTHOR'),
  PAYMENT_CONSUMER: keccakRole('collector.role.PAYMENT_CONSUMER'),
} as const;

/** keccak256 over the UTF-8 name — exactly what `Roles.sol` computes for each constant. */
function keccakRole(name: string): `0x${string}` {
  return keccak256(toBytes(name));
}

// =================================================================================================

async function checkEnvironment(): Promise<void> {
  const area = 'environment';

  record({
    area,
    name: 'NODE_ENV',
    level: config.NODE_ENV === 'production' ? 'pass' : 'warn',
    detail: config.NODE_ENV,
    fix: config.NODE_ENV === 'production' ? undefined : 'Set NODE_ENV=production to enable the strict guards.',
  });

  record({
    area,
    name: 'signer mode',
    level: config.SIGNER_MODE === 'kms' ? 'pass' : config.NODE_ENV === 'production' ? 'fail' : 'warn',
    detail: config.SIGNER_MODE,
    fix:
      config.SIGNER_MODE === 'kms'
        ? undefined
        : 'Production requires SIGNER_MODE=kms. In-process private keys survive a host compromise; KMS keys do not.',
  });

  record({
    area,
    name: 'session secret entropy',
    level: config.SESSION_SECRET.length >= 44 ? 'pass' : 'warn',
    detail: `${config.SESSION_SECRET.length} chars`,
    fix: 'Use `openssl rand -base64 32` (44 chars). A guessable secret forges session cookies.',
  });

  record({
    area,
    name: 'jurisdiction list',
    level:
      config.GACHA_BLOCKED_JURISDICTIONS.size > 0 ? 'pass' : config.COMPLIANCE_MODE === 'off' ? 'warn' : 'fail',
    detail: `${config.GACHA_BLOCKED_JURISDICTIONS.size} blocked`,
    fix: 'GACHA_BLOCKED_JURISDICTIONS must be set by counsel before paid draws are offered (spec §12).',
  });

  record({
    area,
    name: 'compliance mode',
    // `off` is never a pass, even on testnet — it should be impossible to forget it is set.
    level: config.COMPLIANCE_MODE === 'off' ? 'fail' : 'pass',
    detail: config.COMPLIANCE_MODE,
    fix:
      config.COMPLIANCE_MODE === 'off'
        ? 'GATE DISABLED. Testnet development only — the backend refuses to start like this against a mainnet.'
        : undefined,
  });

  record({
    area,
    name: 'KYC provider',
    level: config.COMPLIANCE_MODE === 'full' ? (config.KYC_PROVIDER_URL ? 'pass' : 'fail') : 'pass',
    detail:
      config.COMPLIANCE_MODE === 'full'
        ? config.KYC_PROVIDER_URL
          ? 'configured'
          : 'missing'
        : `not required in ${config.COMPLIANCE_MODE} mode`,
    fix: 'COMPLIANCE_MODE=full has no source of verified jurisdiction/age without it, and refuses every rip.',
  });

  record({
    area,
    name: 'IPFS pinning',
    level:
      config.IPFS_PIN_ENDPOINTS.length >= 2 ? 'pass' : config.COMPLIANCE_MODE === 'off' ? 'warn' : 'fail',
    detail: `${config.IPFS_PIN_ENDPOINTS.length} endpoint(s)`,
    fix: 'Spec §8.2 requires >= 2 independent pins. One pin means one outage removes users\' ability to self-verify.',
  });

  record({
    area,
    name: 'MoonPay webhook secret',
    level: config.MOONPAY_WEBHOOK_SECRET ? 'pass' : config.COMPLIANCE_MODE === 'off' ? 'warn' : 'fail',
    detail: config.MOONPAY_WEBHOOK_SECRET ? 'configured' : 'missing',
    fix: 'Without it anyone can POST a forged "completed" event at the webhook.',
  });

  record({
    area,
    name: 'alerting',
    level: config.ALERT_WEBHOOK_URL ? 'pass' : config.COMPLIANCE_MODE === 'off' ? 'warn' : 'fail',
    detail: config.ALERT_WEBHOOK_URL ? 'configured' : 'missing',
    fix: 'Reserve divergence and drain alerts would go to stdout only. Every runbook starts with an alert.',
  });

  record({
    area,
    name: 'reconciler auto-pause',
    level: config.RECONCILER_AUTOPAUSE ? 'pass' : 'warn',
    detail: String(config.RECONCILER_AUTOPAUSE),
    fix: 'With auto-pause off, a chain/DB divergence keeps serving buybacks until a human intervenes.',
  });

  record({
    area,
    name: 'proof tool URL',
    level: config.PROOF_TOOL_URL ? 'pass' : 'warn',
    detail: config.PROOF_TOOL_URL || 'unset',
    fix: 'Surfaced to users as their self-recovery path; leaving it blank hides the escape hatch.',
  });
}

async function checkInfrastructure(): Promise<void> {
  const area = 'infrastructure';

  try {
    const {rows} = await pool.query<{count: string}>(
      "SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_name = 'schema_migrations'",
    );
    if (rows[0]?.count === '0') {
      record({area, name: 'postgres', level: 'fail', detail: 'connected, not migrated', fix: 'Run `npm run migrate`.'});
    } else {
      const applied = await pool.query<{name: string}>('SELECT name FROM schema_migrations ORDER BY name');
      record({
        area,
        name: 'postgres',
        // The embedded database is a development convenience, never a production one.
        level: isEmbedded ? 'fail' : 'pass',
        detail: isEmbedded
          ? `EMBEDDED (PGlite), ${applied.rows.length} migration(s)`
          : `${applied.rows.length} migration(s) applied`,
        fix: isEmbedded ? 'Point DATABASE_URL at a real Postgres before production.' : undefined,
      });
    }
  } catch (err) {
    record({area, name: 'postgres', level: 'fail', detail: message(err), fix: 'Check DATABASE_URL and network access.'});
  }

  if (!config.REDIS_URL) {
    record({
      area,
      name: 'redis',
      level: 'fail',
      detail: 'not configured — in-memory limiter',
      fix: 'An in-memory limiter is per-instance, so it is no limit at all behind a load balancer.',
    });
    return;
  }

  const redis = new Redis(config.REDIS_URL, {maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true});
  try {
    await redis.connect();
    await redis.ping();
    record({area, name: 'redis', level: 'pass', detail: 'reachable'});
  } catch (err) {
    // Rate limits fail CLOSED, so an unreachable Redis is an outage, not a soft degradation.
    record({area, name: 'redis', level: 'fail', detail: message(err), fix: 'Rate limiting fails closed — the API will reject traffic.'});
  } finally {
    redis.disconnect();
  }
}

async function checkSigners(): Promise<Record<string, Address> | null> {
  const area = 'signing keys';
  try {
    const addresses = await initSigners();
    for (const [role, address] of Object.entries(addresses)) {
      record({area, name: role, level: 'pass', detail: address});
    }
    return addresses as Record<string, Address>;
  } catch (err) {
    record({
      area,
      name: 'resolve keys',
      level: 'fail',
      detail: message(err),
      fix: 'Check the KMS key ids, AWS_REGION, and that the task role has kms:Sign + kms:GetPublicKey.',
    });
    return null;
  }
}

async function checkChain(chain: ChainContext, signers: Record<string, Address> | null): Promise<void> {
  const area = chain.key;

  try {
    const id = await chain.client.getChainId();
    if (id !== chain.chainId) {
      record({area, name: 'rpc', level: 'fail', detail: `RPC reports chain ${id}, registry says ${chain.chainId}`});
      return;
    }
    const head = await chain.client.getBlockNumber();
    record({area, name: 'rpc', level: 'pass', detail: `chain ${id} @ block ${head}`});
  } catch (err) {
    record({area, name: 'rpc', level: 'fail', detail: message(err), fix: `Check the RPC URL for ${chain.key}.`});
    return;
  }

  // Every contract in the deployment file must actually have code at that address.
  const d = chain.deployment;
  const contracts: [string, Address][] = [
    ['accessController', d.accessController],
    ['collectibleNFT', d.collectibleNFT],
    ['vault', d.vault],
    ['paymentRouter', d.paymentRouter],
    ['marketplace', d.marketplace],
    ...(chain.gachaEnabled
      ? ([
          ['gachaMachine', d.gachaMachine],
          ['reserveVault', d.reserveVault],
        ] as [string, Address][])
      : []),
  ];

  for (const [name, address] of contracts) {
    const code = await chain.client.getCode({address});
    record({
      area,
      name: `contract ${name}`,
      level: code && code !== '0x' ? 'pass' : 'fail',
      detail: address,
      fix: code && code !== '0x' ? undefined : 'No bytecode at this address — wrong deployment file or wrong chain.',
    });
  }

  // --- role wiring -----------------------------------------------------------------------------
  const roleHolders = async (role: `0x${string}`) => {
    const count = await chain.client.readContract({
      address: d.accessController,
      abi: accessAbi,
      functionName: 'getRoleMemberCount',
      args: [role],
    });
    const holders: Address[] = [];
    for (let i = 0n; i < count; i++) {
      holders.push(
        await chain.client.readContract({
          address: d.accessController,
          abi: accessAbi,
          functionName: 'getRoleMember',
          args: [role, i],
        }),
      );
    }
    return holders;
  };

  try {
    const admins = await roleHolders(ROLE.DEFAULT_ADMIN);
    const onlyTimelock = admins.length === 1 && admins[0]?.toLowerCase() === d.timelock.toLowerCase();
    record({
      area,
      name: 'DEFAULT_ADMIN is the Timelock alone',
      level: onlyTimelock ? 'pass' : 'fail',
      detail: admins.join(', ') || 'none',
      fix: 'An EOA holding DEFAULT_ADMIN removes the 48h delay from every value-extracting action.',
    });

    if (chain.gachaEnabled) {
      for (const [label, role] of [
        ['SETTLEMENT_ROLE', ROLE.SETTLEMENT],
        ['GACHA_ROLE', ROLE.GACHA],
      ] as const) {
        const holders = await roleHolders(role);
        const correct = holders.length === 1 && holders[0]?.toLowerCase() === d.gachaMachine.toLowerCase();
        record({
          area,
          name: `${label} held only by GachaMachine`,
          level: correct ? 'pass' : 'fail',
          detail: holders.join(', ') || 'none',
          fix: 'This is the invariant that makes the Vault and ReserveVault exits single-authority.',
        });
      }

      // Operational keys must match the addresses this process can actually sign with.
      if (signers) {
        const expected: [string, `0x${string}`, Address | undefined][] = [
          ['relayer', ROLE.TRUSTED_RELAYER, signers.relayer],
          ['oracle', ROLE.TRUSTED_ORACLE, signers.oracle],
          ['buyback', ROLE.TRUSTED_BUYBACK, signers.buyback],
          ['poolAuthor', ROLE.POOL_AUTHOR, signers.poolAuthor],
        ];
        for (const [label, role, address] of expected) {
          if (!address) continue;
          const held = await chain.client.readContract({
            address: d.accessController,
            abi: accessAbi,
            functionName: 'hasRole',
            args: [role, address],
          });
          record({
            area,
            name: `${label} key holds its role`,
            level: held ? 'pass' : 'fail',
            detail: address,
            fix: held ? undefined : `Grant the role to ${address} (OPERATIONS can do this without a timelock).`,
          });
        }
      }

      for (const consumer of [d.gachaMachine, d.marketplace]) {
        const held = await chain.client.readContract({
          address: d.accessController,
          abi: accessAbi,
          functionName: 'hasRole',
          args: [ROLE.PAYMENT_CONSUMER, consumer],
        });
        record({
          area,
          name: `PAYMENT_CONSUMER granted to ${consumer === d.marketplace ? 'Marketplace' : 'GachaMachine'}`,
          level: held ? 'pass' : 'fail',
          detail: consumer,
        });
      }
    }
  } catch (err) {
    record({area, name: 'role wiring', level: 'fail', detail: message(err)});
  }

  if (!chain.gachaEnabled) {
    record({
      area,
      name: 'gacha',
      level: 'warn',
      detail: 'marketplace-only',
      fix: chain.marketplaceOnlyReason ?? 'No Chainlink VRF v2.5 on this chain.',
    });
    return;
  }

  // --- money readiness -------------------------------------------------------------------------
  try {
    const paused = await chain.client.readContract({
      address: d.gachaMachine,
      abi: gachaAbi,
      functionName: 'paused',
    });
    record({area, name: 'GachaMachine unpaused', level: paused ? 'warn' : 'pass', detail: paused ? 'PAUSED' : 'live'});
  } catch (err) {
    record({area, name: 'GachaMachine reachable', level: 'fail', detail: message(err)});
  }

  for (const [symbol, token] of Object.entries(chain.payTokens)) {
    try {
      const allowed = await chain.client.readContract({
        address: d.paymentRouter,
        abi: parseAbi(['function isAllowedPayToken(address) view returns (bool)']),
        functionName: 'isAllowedPayToken',
        args: [token],
      });
      record({
        area,
        name: `${symbol} allowlisted`,
        level: allowed ? 'pass' : 'fail',
        detail: token,
        fix: allowed ? undefined : 'setAllowedPayToken via TOKEN_ADMIN + Timelock (48h) — start this early.',
      });

      const cap = await chain.client.readContract({
        address: d.reserveVault,
        abi: reserveVaultAbi,
        functionName: 'maxBuybackOutflowPerEpoch',
        args: [token],
      });
      record({
        area,
        name: `${symbol} outflow cap`,
        level: cap > 0n ? 'pass' : 'fail',
        detail: cap.toString(),
        // Fail-closed: zero means sell-back is entirely blocked. That is safe, but it is an outage.
        fix: cap > 0n ? undefined : 'Zero blocks ALL sell-back. Set it deliberately via TREASURER + Timelock.',
      });

      const [balance, reserved] = await chain.client.readContract({
        address: d.reserveVault,
        abi: reserveVaultAbi,
        functionName: 'proofOfReserves',
        args: [token],
      });
      const decimals = await chain.client.readContract({address: token, abi: erc20Abi, functionName: 'decimals'});
      const human = (v: bigint) => (Number(v) / 10 ** Number(decimals)).toLocaleString('en-US');

      record({
        area,
        name: `${symbol} reserve solvent`,
        level: balance >= reserved ? 'pass' : 'fail',
        detail: `held ${human(balance)} / owed ${human(reserved)}`,
      });
      record({
        area,
        name: `${symbol} reserve funded`,
        level: balance > 0n ? 'pass' : 'fail',
        detail: human(balance),
        // Every rip books its pool's worst case up front, so an empty reserve means rip() reverts.
        fix: balance > 0n ? undefined : 'rip() reverts while the reserve cannot back a pack. Fund it before launch.',
      });
    } catch (err) {
      record({area, name: `${symbol} checks`, level: 'fail', detail: message(err)});
    }
  }

  // --- pools -------------------------------------------------------------------------------------
  try {
    const {rows} = await pool.query<{pack_id: string; active_pool_version: string | null}>(
      'SELECT pack_id, active_pool_version FROM packs WHERE chain_id = $1',
      [chain.chainId],
    );
    if (rows.length === 0) {
      record({area, name: 'packs', level: 'warn', detail: 'none authored', fix: 'Run the pool author before launch.'});
    }
    for (const row of rows) {
      if (!row.active_pool_version) {
        record({area, name: `pack ${row.pack_id.slice(0, 10)}`, level: 'warn', detail: 'no active version'});
        continue;
      }
      const onChain = await chain.client.readContract({
        address: d.gachaMachine,
        abi: gachaAbi,
        functionName: 'activePoolVersion',
        args: [row.pack_id as `0x${string}`],
      });
      const dbVersion = BigInt(row.active_pool_version);
      record({
        area,
        name: `pack ${row.pack_id.slice(0, 10)} active version`,
        level: onChain === dbVersion ? 'pass' : onChain === 0n ? 'fail' : 'warn',
        detail: `chain v${onChain}, db v${dbVersion}`,
        fix: onChain === 0n ? 'No version is active on-chain — schedule one with setActivePoolVersion.' : undefined,
      });
    }
  } catch (err) {
    record({area, name: 'packs', level: 'warn', detail: message(err)});
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0]!.slice(0, 140) : String(err);
}

// =================================================================================================

async function main(): Promise<void> {
  console.log('\nCollector production preflight\n' + '='.repeat(78));

  await checkEnvironment();
  await checkInfrastructure();
  const signers = await checkSigners();

  try {
    initChains();
    for (const chain of allChains()) {
      await checkChain(chain, signers);
    }
  } catch (err) {
    record({area: 'chains', name: 'registry', level: 'fail', detail: message(err)});
  }

  let currentArea = '';
  for (const check of checks) {
    if (check.area !== currentArea) {
      currentArea = check.area;
      console.log(`\n${currentArea}`);
      console.log('-'.repeat(78));
    }
    const mark = check.level === 'pass' ? ' ok ' : check.level === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  [${mark}] ${check.name.padEnd(42)} ${check.detail}`);
    if (check.fix && check.level !== 'pass') console.log(`         -> ${check.fix}`);
  }

  const failures = checks.filter((c) => c.level === 'fail');
  const warnings = checks.filter((c) => c.level === 'warn');

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${checks.length - failures.length - warnings.length} passed · ${warnings.length} warnings · ${failures.length} blockers`);

  if (failures.length > 0) {
    console.log('\nBLOCKERS — do not take real money until these are resolved:');
    for (const f of failures) console.log(`  · [${f.area}] ${f.name}: ${f.detail}`);
  } else {
    console.log('\nNo blockers. Note that this checks CONFIGURATION, not code correctness —');
    console.log('external audits and legal sign-off are separate gates (docs/DEVIATIONS.md §4).');
  }
  console.log('');

  await pool.end();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('preflight crashed:', err);
  process.exit(1);
});
