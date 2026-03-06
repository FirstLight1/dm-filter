import express from 'express';
import crypto from 'crypto';
import {
  INSTAGRAM_APP_SECRET,
  WEBHOOK_VERIFY_TOKEN,
  isWhitelisted,
} from './config.js';
import { sendNotification } from './notify.js';
import { sendReply, getReelInfo, sendReaction, fetchThumbnailAsBase64 } from './instagram.js';
import { classifyMessage } from './classifier.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Hateful response options ----------

const HATEFUL_REPLIES = [
  'ok', 'noted', 'k',
  'veľmi cool braček', 'fascinujúce', 'neuveriteľné veci',
  'nemám záujem', 'zlá adresa', 'banger', 'cool',
  'sure buddy', 'jak povíš',
];

async function sendHatefulResponse(recipientId, messageId) {
  const pick = Math.floor(Math.random() * 13); // 0-12: 0 = reaction, 1-12 = text
  if (pick === 0) {
    await sendReaction(recipientId, messageId);
  } else {
    await sendReply(recipientId, HATEFUL_REPLIES[pick - 1]);
  }
}

// ---------- Webhook verification (GET) ----------

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('[webhook] Verification successful');
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] Verification failed — token mismatch');
  return res.sendStatus(403);
});

// ---------- Health check ----------

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ---------- HMAC-SHA256 signature verification ----------

// Use express.raw() to capture the raw body for signature verification
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-hub-signature-256'];

  if (!signature || !INSTAGRAM_APP_SECRET) {
    console.warn('[webhook] Missing signature or app secret');
    return res.sendStatus(403);
  }

  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', INSTAGRAM_APP_SECRET)
    .update(req.body) // req.body is a Buffer here
    .digest('hex');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSig);

  if (sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    console.warn('[webhook] Signature mismatch');
    return res.sendStatus(403);
  }

  // Respond 200 immediately — Meta requires fast response
  res.sendStatus(200);

  console.log('[webhook] POST received, signature valid, processing...');

  // Parse the body and process asynchronously
  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch {
    console.error('[webhook] Failed to parse body');
    return;
  }

  // Process asynchronously — don't block the 200 response
  handleWebhookEvent(body).catch(err => {
    console.error('[webhook] Async processing error:', err.message);
  });
});

// ---------- Event parsing & processing ----------

async function handleWebhookEvent(body) {
  // Temporary debug — remove after confirming real DM structure
  console.log('[webhook] FULL PAYLOAD:', JSON.stringify(body, null, 2));

  const entry = body.entry?.[0];
  if (!entry) {
    console.warn('[webhook] No entry in event');
    return;
  }

  console.log('[webhook] Entry keys:', Object.keys(entry));
  if (entry.changes) console.log('[webhook] changes[0]:', JSON.stringify(entry.changes[0], null, 2));
  if (entry.messaging) console.log('[webhook] messaging[0]:', JSON.stringify(entry.messaging[0], null, 2));

  let senderId, messageText, messageId, attachment;

  // Instagram Graph API delivers events via entry[].changes[]
  const change = entry.changes?.[0];
  if (change?.value) {
    const value = change.value;
    senderId = value.sender?.id;
    messageText = value.message?.text || '';
    messageId = value.message?.mid;
    const attachments = value.message?.attachments;
    attachment = attachments?.[0] || null;
  }

  // Fallback: Messenger-style entry[].messaging[] (legacy)
  if (!senderId) {
    const messaging = entry.messaging?.[0];
    if (messaging) {
      senderId = messaging.sender?.id;
      messageText = messaging.message?.text || '';
      messageId = messaging.message?.mid;
      const attachments = messaging.message?.attachments;
      attachment = attachments?.[0] || null;
    }
  }

  if (!senderId) {
    console.warn('[webhook] No sender ID in event');
    return;
  }

  await processMessage(senderId, messageText, attachment, messageId);
}

async function processMessage(senderId, messageText, attachment, messageId) {
  // 1. Check whitelist
  if (!isWhitelisted(senderId)) {
    await sendNotification({
      title: 'Unknown sender',
      body: `Someone not on your list messaged you (ID: ${senderId})`,
      priority: 'default',
    });
    return;
  }

  // 2. Extract reel info if applicable
  let caption = '';
  let thumbnailBase64 = null;
  let mediaType = null;
  let isReel = false;

  if (attachment) {
    isReel = true;
    const mediaId = attachment.payload?.id;
    if (mediaId) {
      const reelInfo = await getReelInfo(mediaId);
      caption = reelInfo.caption || '';
      if (reelInfo.thumbnail_url) {
        const thumb = await fetchThumbnailAsBase64(reelInfo.thumbnail_url);
        if (thumb) {
          thumbnailBase64 = thumb.base64;
          mediaType = thumb.mediaType;
        }
      }
    }
  }

  // 3. Classify
  const result = await classifyMessage({
    senderId,
    messageText,
    caption,
    thumbnailBase64,
    mediaType,
    isReel,
  });

  console.log(`[classify] ${result.category} (${result.confidence}) — ${result.reason}`);

  // 4. Take action
  if (result.category === 'HATEFUL') {
    await sendHatefulResponse(senderId, messageId);
  } else if (result.action === 'auto_reply') {
    await sendReply(senderId, result.reply_message);
  } else {
    await sendNotification({
      title: result.notify_title || `Message from ${senderId}`,
      body: result.notify_body || messageText || '(no text)',
      priority: result.category === 'HATEFUL' ? 'high' : 'default',
    });
  }
}

// ---------- Exports for testing ----------

export { app, handleWebhookEvent, processMessage, sendHatefulResponse, HATEFUL_REPLIES };

// ---------- Start server ----------

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server.js') ||
  process.argv[1].endsWith('server')
);

if (isDirectRun) {
  app.listen(PORT, () => {
    console.log(`[server] Instagram DM Filter running on port ${PORT}`);
  });
}
