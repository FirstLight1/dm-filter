import fetch from 'node-fetch';
import { NTFY_TOPIC } from './config.js';

/**
 * Send a push notification via ntfy.sh.
 * @param {object} opts
 * @param {string} opts.title  - Short notification title
 * @param {string} opts.body   - Notification body text
 * @param {string} [opts.priority='default'] - min | low | default | high | urgent
 */
export async function sendNotification({ title, body, priority = 'default' }) {
  try {
    const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Content-Type': 'text/plain',
      },
      body: body,
    });

    if (!res.ok) {
      console.error(`[notify] ntfy.sh responded ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error('[notify] Failed to send notification:', err.message);
  }
}
