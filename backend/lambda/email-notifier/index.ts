import * as crypto from 'crypto';

interface SesSnsMessage {
  notificationType?: string;
  mail?: {
    timestamp: string;
    source: string;
    messageId: string;
    destination: string[];
    commonHeaders?: {
      from?: string[];
      to?: string[];
      subject?: string;
      date?: string;
    };
  };
}

interface ServiceAccountCredentials {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Google Service Account から OAuth2 Access Token を取得 (FCM v1 用)
 */
async function getGoogleAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const base64UrlEncode = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer
    .sign(creds.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${unsignedToken}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to obtain Google access token: ${res.status} ${errorText}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * FCM HTTP v1 API で topic "emails" にプッシュ通知を送信
 */
async function sendFcmNotification(
  creds: ServiceAccountCredentials,
  accessToken: string,
  subject: string,
  from: string,
  messageId: string
): Promise<void> {
  const url = `https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`;

  const payload = {
    message: {
      topic: 'emails',
      notification: {
        title: subject || '新着メール',
        body: from ? `差出人: ${from}` : '新しいメールを受信しました',
      },
      data: {
        messageId: messageId || '',
        subject: subject || '',
        sender: from || '',
      },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'sess3mailer_emails',
          sound: 'default',
          default_sound: true,
          default_vibrate_timings: true,
        },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`FCM send failed: ${res.status} ${errorText}`);
  }

  const result = await res.json();
  console.log('FCM Notification sent successfully:', result);
}

/**
 * Lambda ハンドラー
 * SNS イベント (SES 受信ルールのアクション) をトリガーとして起動
 */
export async function handler(event: any): Promise<void> {
  console.log('Received event:', JSON.stringify(event));

  const credsJsonStr = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!credsJsonStr) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured in environment variables');
  }

  const creds: ServiceAccountCredentials = JSON.parse(credsJsonStr);
  const accessToken = await getGoogleAccessToken(creds);

  const records = event.Records || [];
  for (const record of records) {
    let subject = '新着メール';
    let from = '';
    let messageId = '';

    if (record.Sns && record.Sns.Message) {
      try {
        const snsMsg: SesSnsMessage = JSON.parse(record.Sns.Message);
        if (snsMsg.mail) {
          messageId = snsMsg.mail.messageId || '';
          from = snsMsg.mail.commonHeaders?.from?.[0] || snsMsg.mail.source || '';
          subject = snsMsg.mail.commonHeaders?.subject || '（件名なし）';
        }
      } catch (err) {
        console.warn('Failed to parse SNS Message as JSON, using raw message:', err);
        subject = record.Sns.Subject || '新着メール';
        from = record.Sns.Message?.substring(0, 50) || '';
      }
    }

    console.log(`Sending FCM push notification for email. Subject: "${subject}", From: "${from}"`);
    await sendFcmNotification(creds, accessToken, subject, from, messageId);
  }
}
