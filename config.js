import 'dotenv/config';

export const INSTAGRAM_PAGE_ACCESS_TOKEN = process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
export const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
export const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const NTFY_TOPIC = process.env.NTFY_TOPIC;

const rawIds = process.env.WHITELISTED_SENDER_IDS || '';
const whitelistedIds = new Set(
  rawIds.split(',').map(id => id.trim()).filter(Boolean)
);

export function isWhitelisted(senderId) {
  return whitelistedIds.has(String(senderId));
}
