import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  _Object,
} from '@aws-sdk/client-s3';
import { simpleParser, ParsedMail } from 'mailparser';
import { Readable } from 'stream';

const s3Client = new S3Client({});
const BUCKET_NAME = process.env.SES_BUCKET_NAME || '';
const PREFIX = process.env.SES_PREFIX || '';

// ヘルパー: Stream を Buffer に変換
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ヘルパー: RFC 822の先頭ヘッダーから主要メタデータを抽出
async function parseEmailHeader(buffer: Buffer): Promise<{
  subject: string;
  from: string;
  to: string;
  date: string | null;
}> {
  try {
    const parsed = await simpleParser(buffer);
    return {
      subject: parsed.subject || '(件名なし)',
      from: parsed.from?.text || '(差出人不明)',
      to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : parsed.to.text) : '',
      date: parsed.date ? parsed.date.toISOString() : null,
    };
  } catch (err) {
    return {
      subject: '(パース失敗)',
      from: '',
      to: '',
      date: null,
    };
  }
}

export interface APIGatewayEvent {
  rawPath: string;
  requestContext?: {
    http?: {
      method: string;
      path: string;
    };
  };
  queryStringParameters?: Record<string, string>;
  pathParameters?: Record<string, string>;
}

export const handler = async (event: APIGatewayEvent) => {
  const method = event.requestContext?.http?.method || 'GET';
  const rawPath = event.rawPath || '';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie',
  };

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // 1. ルーティング: /api/emails/{id}/attachments/{index}
    const attachmentMatch = rawPath.match(/^\/api\/emails\/([^\/]+)\/attachments\/(\d+)$/);
    if (attachmentMatch && method === 'GET') {
      const emailId = decodeURIComponent(attachmentMatch[1]);
      const attachmentIndex = parseInt(attachmentMatch[2], 10);
      return await handleGetAttachment(emailId, attachmentIndex);
    }

    // 2. ルーティング: /api/emails/{id}
    const emailDetailMatch = rawPath.match(/^\/api\/emails\/([^\/]+)$/);
    if (emailDetailMatch && method === 'GET') {
      const emailId = decodeURIComponent(emailDetailMatch[1]);
      return await handleGetEmailDetail(emailId, headers);
    }

    // 3. ルーティング: /api/emails
    if ((rawPath === '/api/emails' || rawPath === '/api/emails/') && method === 'GET') {
      const limit = parseInt(event.queryStringParameters?.limit || '50', 10);
      const continuationToken = event.queryStringParameters?.continuationToken;
      return await handleListEmails(limit, continuationToken, headers);
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ message: `Not Found: ${rawPath}` }),
    };
  } catch (error: any) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: 'Internal Server Error', error: error.message }),
    };
  }
};

/**
 * メール一覧取得
 */
async function handleListEmails(
  limit: number,
  continuationToken: string | undefined,
  headers: Record<string, string>
) {
  const actualLimit = Math.min(Math.max(limit, 1), 100);

  const listCommand = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: PREFIX || undefined,
    MaxKeys: actualLimit,
    ContinuationToken: continuationToken,
  });

  const listResponse = await s3Client.send(listCommand);
  const contents = listResponse.Contents || [];

  // フォルダマーカー等を除外
  const mailObjects = contents.filter(
    (obj) => obj.Key && !obj.Key.endsWith('/') && (obj.Size || 0) > 0
  );

  // 更新日時の降順でソート（最新順）
  mailObjects.sort((a, b) => {
    const timeA = a.LastModified ? a.LastModified.getTime() : 0;
    const timeB = b.LastModified ? b.LastModified.getTime() : 0;
    return timeB - timeA;
  });

  // 各メールオブジェクトのヘッダー情報を取得（Range Get: 先頭16KB）
  const emailSummaries = await Promise.all(
    mailObjects.map(async (obj) => {
      const key = obj.Key!;
      const id = encodeURIComponent(key);

      let headerInfo = {
        subject: '(件名なし)',
        from: '(差出人不明)',
        to: '',
        date: obj.LastModified ? obj.LastModified.toISOString() : null,
      };

      try {
        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Range: 'bytes=0-16383', // 先頭16KB
        });
        const getResponse = await s3Client.send(getCommand);
        if (getResponse.Body) {
          const buf = await streamToBuffer(getResponse.Body as Readable);
          const parsed = await parseEmailHeader(buf);
          headerInfo = {
            subject: parsed.subject || '(件名なし)',
            from: parsed.from || '(差出人不明)',
            to: parsed.to || '',
            date: parsed.date || (obj.LastModified ? obj.LastModified.toISOString() : null),
          };
        }
      } catch (err) {
        console.warn(`Failed to parse header for key ${key}:`, err);
      }

      return {
        id,
        key,
        subject: headerInfo.subject,
        from: headerInfo.from,
        to: headerInfo.to,
        date: headerInfo.date,
        size: obj.Size || 0,
      };
    })
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      emails: emailSummaries,
      nextContinuationToken: listResponse.NextContinuationToken || null,
    }),
  };
}

/**
 * メール詳細取得
 */
async function handleGetEmailDetail(key: string, headers: Record<string, string>) {
  const getCommand = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  let getResponse;
  try {
    getResponse = await s3Client.send(getCommand);
  } catch (err: any) {
    if (err.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ message: 'Mail not found' }),
      };
    }
    throw err;
  }

  if (!getResponse.Body) {
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ message: 'Mail body empty' }),
    };
  }

  const rawBuffer = await streamToBuffer(getResponse.Body as Readable);
  const parsed = await simpleParser(rawBuffer);

  const attachments = (parsed.attachments || []).map((att, idx) => ({
    index: idx,
    filename: att.filename || `attachment-${idx + 1}`,
    contentType: att.contentType,
    size: att.size,
  }));

  const responsePayload = {
    id: encodeURIComponent(key),
    key,
    subject: parsed.subject || '(件名なし)',
    from: parsed.from?.text || '(差出人不明)',
    to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(', ') : parsed.to.text) : '',
    cc: parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc.map(t => t.text).join(', ') : parsed.cc.text) : '',
    date: parsed.date ? parsed.date.toISOString() : (getResponse.LastModified ? getResponse.LastModified.toISOString() : null),
    messageId: parsed.messageId || null,
    text: parsed.text || '',
    html: parsed.html || false,
    textAsHtml: parsed.textAsHtml || null,
    attachments,
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(responsePayload),
  };
}

/**
 * 添付ファイルダウンロード
 */
async function handleGetAttachment(key: string, attachmentIndex: number) {
  const getCommand = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const getResponse = await s3Client.send(getCommand);
  if (!getResponse.Body) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Mail not found' }),
    };
  }

  const rawBuffer = await streamToBuffer(getResponse.Body as Readable);
  const parsed = await simpleParser(rawBuffer);

  const targetAttachment = parsed.attachments?.[attachmentIndex];
  if (!targetAttachment) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Attachment not found' }),
    };
  }

  const filename = encodeURIComponent(targetAttachment.filename || `attachment-${attachmentIndex + 1}`);

  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': targetAttachment.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, max-age=86400',
    },
    body: targetAttachment.content.toString('base64'),
  };
}
