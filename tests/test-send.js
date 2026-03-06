import crypto from 'crypto';
const APP_SECRET = 'YOUR_APP_SECRET_FROM_ENV'; // must match .env
const payload = JSON.stringify({
  entry: [{
    messaging: [{
      sender: { id: '17841400000000000' }, // must be in your whitelist
      message: {
        mid: 'test-msg-001',
        text: 'check out this Pikachu card'
      }
    }]
  }]
});
const signature = 'sha256=' + crypto
  .createHmac('sha256', APP_SECRET)
  .update(payload)
  .digest('hex');
const res = await fetch('http://localhost:3000/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hub-signature-256': signature,
  },
  body: payload,
});
console.log('Status:', res.status);
