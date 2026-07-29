import pino from 'pino';
import {config} from '../config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  // Anything that could carry a key or a session must never reach the log sink.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'privateKey',
      '*.privateKey',
      'signature',
      'userSig',
      'oracleSig',
      'SESSION_SECRET',
      'MOONPAY_SECRET_KEY',
      'MOONPAY_WEBHOOK_SECRET',
    ],
    censor: '[redacted]',
  },
  base: {service: 'collector-backend'},
});

/**
 * Operational alerts (spec §8.7). Everything routed through here is something a human must look at:
 * a reserve divergence, a buyback drain, a webhook signature failure spike, a VRF-stuck draw.
 */
export async function alert(event: string, detail: Record<string, unknown>): Promise<void> {
  logger.error({alert: event, ...detail}, `ALERT ${event}`);
  if (!config.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(config.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({event, detail, at: new Date().toISOString(), env: config.NODE_ENV}),
    });
  } catch (err) {
    // An alerting failure must never take down the path that raised the alert.
    logger.error({err}, 'failed to deliver alert webhook');
  }
}
