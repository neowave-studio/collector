import {BaseError, ContractFunctionRevertedError} from 'viem';

/**
 * Turns a contract revert into something a caller can act on.
 *
 * A simulated call that reverts is not a server fault — it is the chain declining, usually for a
 * reason the user can do something about (the pack is restocking, the reserve is short, the
 * signature expired). Rethrowing viem's raw error flattened all of those into `500 internal_error`,
 * which tells a user nothing and sends an operator looking for a bug that is not there.
 *
 * The message is deliberately written for the person who hit it, not for a log reader: it says what
 * happened and whether waiting will help. Selectors we do not recognise stay generic rather than
 * being guessed at.
 */
export class ChainRevertError extends Error {
  readonly statusCode: number;
  readonly reason: string;

  constructor(reason: string, message: string, statusCode: number) {
    super(message);
    this.name = 'ChainRevertError';
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

/**
 * Named errors we expect to meet in normal operation, with the status that fits each.
 *
 * 503 means "correct request, come back shortly" — inventory and reserve conditions that ops or the
 * next pool version will clear. 409 is a state conflict the user resolves by retrying with fresh
 * data. 400 is a request that will never succeed as written.
 */
const KNOWN: Record<string, {status: number; message: string}> = {
  PoolStale: {
    status: 503,
    message:
      'This pack is being restocked and cannot be opened right now. Nothing was charged. Try again shortly.',
  },
  EmptyPool: {status: 503, message: 'This pack has no cards left. Nothing was charged.'},
  CardNotAvailable: {status: 503, message: 'That card is no longer available. Nothing was charged.'},
  InsufficientReserve: {
    status: 503,
    message: 'The buyback reserve is too low to back this purchase right now. Nothing was charged.',
  },
  OutflowCapExceeded: {
    status: 503,
    message: 'The buyback limit for this period has been reached. Nothing was charged.',
  },
  OutflowCapNotConfigured: {
    status: 503,
    message: 'Buyback is not configured for this token yet. Nothing was charged.',
  },
  EnforcedPause: {
    status: 503,
    message: 'Purchases are paused while we check something. Nothing was charged.',
  },
  PoolVersionRetired: {
    status: 409,
    message: 'The odds changed while you were deciding. Reload and try again — nothing was charged.',
  },
  PoolVersionMismatch: {
    status: 409,
    message: 'The odds changed while you were deciding. Reload and try again — nothing was charged.',
  },
  InvalidNonce: {status: 409, message: 'This request was already used. Reload and try again.'},
  SignatureExpired: {status: 400, message: 'Your approval expired before it reached the chain. Try again.'},
  InvalidSignature: {status: 400, message: 'That signature did not match. Try again.'},
  TermsMismatch: {status: 400, message: 'The terms you signed no longer match. Reload and try again.'},
  BuybackLocked: {status: 409, message: 'Sell-back is temporarily locked on this account.'},
  BuybackWindowClosed: {status: 409, message: 'The sell-back window for this draw has closed.'},
  BuybackWindowOpen: {status: 409, message: 'The sell-back window is still open for this draw.'},
  DrawAlreadySettled: {status: 409, message: 'This draw has already been settled.'},
  DrawNotRevealed: {status: 409, message: 'This draw has not revealed yet. Give it a moment.'},
};

/**
 * Wraps a viem error as a ChainRevertError when it is a revert we can name.
 *
 * Anything that is not a contract revert — an RPC outage, a malformed call — is genuinely ours and
 * is returned untouched so it still surfaces as a 500.
 */
export function asChainError(err: unknown): unknown {
  if (!(err instanceof BaseError)) return err;

  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return err;

  const name = reverted.data?.errorName;
  if (name && KNOWN[name]) {
    const {status, message} = KNOWN[name]!;
    return new ChainRevertError(name, message, status);
  }

  // A revert we cannot name is still the chain declining rather than a server fault, but we have
  // nothing useful to tell the user about it, so keep the detail in the logs and stay vague here.
  return new ChainRevertError(
    name ?? reverted.signature ?? 'unknown_revert',
    'The network declined this request. Nothing was charged.',
    409,
  );
}
