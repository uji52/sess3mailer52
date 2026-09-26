/*
概要: CloudFront のカスタムポリシーに基づく署名付きクッキー（Signed Cookies）を生成するスクリプト
使用法:
  node tools/generate_cloudfront_signed_cookies.js \
    --publicKeyId <YOUR_PUBLIC_KEY_ID> \
    --domain <YOUR_CLOUDFRONT_DOMAIN> \
    [--privateKey ./keys/private_key.pem] \
    [--ip 1.2.3.4/32] \
    [--expires 86400]

出力: ブラウザのコンソールで実行できるスクリプト、および Set-Cookie 形式を出力します。
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function usageAndExit() {
  console.log(`
使用方法:
  node tools/generate_cloudfront_signed_cookies.js \\
    --publicKeyId <PUBLIC_KEY_ID> \\
    --domain <DOMAIN_OR_CLOUDFRONT_HOST> \\
    [--privateKey ./keys/private_key.pem] \\
    [--ip <CLIENT_IP/32>] \\
    [--expires 86400]

例:
  node tools/generate_cloudfront_signed_cookies.js \\
    --publicKeyId K2JCJMDEHXQW5F \\
    --domain d123456abcdef.cloudfront.net \\
    --expires 86400
`);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  usageAndExit();
}

function getArg(name) {
  const ix = argv.indexOf(name);
  if (ix === -1 || ix + 1 >= argv.length) return null;
  return argv[ix + 1];
}

const defaultKeyPath = path.resolve(__dirname, '../keys/private_key.pem');
const privateKeyPath = getArg('--privateKey') || defaultKeyPath;
const publicKeyId = getArg('--publicKeyId');
const domain = getArg('--domain');
const ip = getArg('--ip');
const expiresSec = parseInt(getArg('--expires') || '86400', 10);

if (!publicKeyId || !domain) {
  console.error('エラー: --publicKeyId と --domain は必須引数です。\n');
  usageAndExit();
}

if (!fs.existsSync(privateKeyPath)) {
  console.error('エラー: 秘密鍵ファイルが見つかりません:', privateKeyPath);
  console.error('  先に `./tools/generate_keys.sh` を実行して鍵ペアを生成してください。');
  process.exit(1);
}

const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');

/**
 * CloudFront URLセーフBase64エンコード
 * (+ -> -, = -> _, / -> ~)
 */
function toCloudFrontBase64(strOrBuf) {
  const b64 = Buffer.isBuffer(strOrBuf)
    ? strOrBuf.toString('base64')
    : Buffer.from(strOrBuf, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');
}

function makePolicy(resource, expireEpoch, ipCidr) {
  const stmt = {
    Statement: [
      {
        Resource: resource,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expireEpoch }
        }
      }
    ]
  };
  if (ipCidr) {
    stmt.Statement[0].Condition.IpAddress = { 'AWS:SourceIp': ipCidr };
  }
  // 空白を除去したJSON文字列
  return JSON.stringify(stmt).replace(/\s+/g, '');
}

function signPolicy(policyStr, privateKey) {
  const signer = crypto.createSign('RSA-SHA1');
  signer.update(policyStr);
  return signer.sign(privateKey);
}

function main() {
  const now = Math.floor(Date.now() / 1000);
  const expire = now + (isNaN(expiresSec) ? 86400 : expiresSec);
  const resource = `https://${domain}/*`;

  const policy = makePolicy(resource, expire, ip);
  const policyB64 = toCloudFrontBase64(policy);
  const signature = toCloudFrontBase64(signPolicy(policy, privateKeyPem));

  console.log('===============================================================');
  console.log(' CloudFront Signed Cookies 生成完了');
  console.log('===============================================================');
  console.log(`対象ドメイン : https://${domain}/*`);
  console.log(`公開鍵ID     : ${publicKeyId}`);
  console.log(`有効期限     : ${new Date(expire * 1000).toLocaleString('ja-JP')} (Epoch: ${expire})`);
  if (ip) console.log(`制限IP       : ${ip}`);
  console.log('');

  console.log('【ブラウザでの登録手順】');
  console.log(`1. ブラウザで https://${domain}/ を開きます`);
  console.log('2. F12 キーを押してデベロッパーツール（開発者ツール）を開きます');
  console.log('3. 「Console (コンソール)」タブを選択し、以下の3行を貼り付けて Enter を押します:');
  console.log('---------------------------------------------------------------');
  console.log(`document.cookie = "CloudFront-Policy=${policyB64}; Domain=${domain}; Path=/; Secure; SameSite=None";`);
  console.log(`document.cookie = "CloudFront-Signature=${signature}; Domain=${domain}; Path=/; Secure; SameSite=None";`);
  console.log(`document.cookie = "CloudFront-Key-Pair-Id=${publicKeyId}; Domain=${domain}; Path=/; Secure; SameSite=None";`);
  console.log('---------------------------------------------------------------');
  console.log('4. ページをリロード (F5) すると、メール一覧が表示されます！\n');

  console.log('【Set-Cookie ヘッダー形式（サーバー応答用）】');
  console.log(`Set-Cookie: CloudFront-Policy=${policyB64}; Domain=${domain}; Path=/; Secure; SameSite=None`);
  console.log(`Set-Cookie: CloudFront-Signature=${signature}; Domain=${domain}; Path=/; Secure; SameSite=None`);
  console.log(`Set-Cookie: CloudFront-Key-Pair-Id=${publicKeyId}; Domain=${domain}; Path=/; Secure; SameSite=None`);
  console.log('');

  console.log('【curl によるテストコマンド】');
  console.log(`curl -v -H "Cookie: CloudFront-Policy=${policyB64}; CloudFront-Signature=${signature}; CloudFront-Key-Pair-Id=${publicKeyId}" "https://${domain}/api/emails"`);
  console.log('===============================================================');
}

main();
