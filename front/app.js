// State
let emails = [];
let currentEmail = null;
let activeTab = 'html'; // 'html' or 'text'

// DOM Elements
const emailListEl = document.getElementById('emailList');
const emailListStatusEl = document.getElementById('emailListStatus');
const searchInputEl = document.getElementById('searchInput');
const refreshBtnEl = document.getElementById('refreshBtn');

const emptyStateEl = document.getElementById('emptyState');
const mailViewerEl = document.getElementById('mailViewer');
const mailSubjectEl = document.getElementById('mailSubject');
const mailFromEl = document.getElementById('mailFrom');
const senderAvatarEl = document.getElementById('senderAvatar');
const mailToEl = document.getElementById('mailTo');
const mailCcEl = document.getElementById('mailCc');
const mailCcWrapperEl = document.getElementById('mailCcWrapper');
const mailDateEl = document.getElementById('mailDate');
const viewRawBtnEl = document.getElementById('viewRawBtn');

const attachmentsSectionEl = document.getElementById('attachmentsSection');
const attachmentsListEl = document.getElementById('attachmentsList');

const tabHtmlEl = document.getElementById('tabHtml');
const tabTextEl = document.getElementById('tabText');
const htmlFrameEl = document.getElementById('htmlFrame');
const textBodyEl = document.getElementById('textBody');

const authModalEl = document.getElementById('authModal');
const retryAuthBtnEl = document.getElementById('retryAuthBtn');

// 初期化
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadEmailList();
});

function setupEventListeners() {
  refreshBtnEl.addEventListener('click', () => loadEmailList());
  searchInputEl.addEventListener('input', (e) => filterEmails(e.target.value));

  tabHtmlEl.addEventListener('click', () => switchTab('html'));
  tabTextEl.addEventListener('click', () => switchTab('text'));

  retryAuthBtnEl.addEventListener('click', () => {
    authModalEl.classList.add('hidden');
    loadEmailList();
  });

  viewRawBtnEl.addEventListener('click', () => {
    if (!currentEmail) return;
    alert(`S3 Key: ${currentEmail.key}\nMessage ID: ${currentEmail.messageId || 'N/A'}`);
  });
}

/**
 * メール一覧を取得
 */
async function loadEmailList() {
  emailListStatusEl.textContent = 'メールを読み込み中...';
  emailListStatusEl.classList.remove('hidden');
  emailListEl.innerHTML = '';

  try {
    const res = await fetch('/api/emails');
    if (res.status === 403) {
      showAuthModal();
      emailListStatusEl.textContent = '認証エラー (403 Forbidden)';
      return;
    }
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }

    const data = await res.json();
    emails = data.emails || [];

    if (emails.length === 0) {
      emailListStatusEl.textContent = '受信メールはありません';
      return;
    }

    emailListStatusEl.classList.add('hidden');
    renderEmailList(emails);
  } catch (err) {
    console.error('Failed to load email list:', err);
    emailListStatusEl.textContent = `メール一覧の取得に失敗しました: ${err.message}`;
  }
}

/**
 * メール一覧を描画
 */
function renderEmailList(list) {
  emailListEl.innerHTML = '';

  list.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'email-item';
    if (currentEmail && currentEmail.id === item.id) {
      li.classList.add('active');
    }

    const dateStr = item.date ? formatDate(new Date(item.date)) : '';
    const sizeStr = formatBytes(item.size);

    li.innerHTML = `
      <div class="item-top">
        <span class="item-sender" title="${escapeHtml(item.from)}">${escapeHtml(getSenderDisplayName(item.from))}</span>
        <span class="item-date">${dateStr}</span>
      </div>
      <div class="item-subject" title="${escapeHtml(item.subject)}">${escapeHtml(item.subject || '(件名なし)')}</div>
      <div class="item-bottom">
        <span></span>
        <span>${sizeStr}</span>
      </div>
    `;

    li.addEventListener('click', () => selectEmail(item));
    emailListEl.appendChild(li);
  });
}

/**
 * 検索フィルタ
 */
function filterEmails(keyword) {
  const q = keyword.trim().toLowerCase();
  if (!q) {
    renderEmailList(emails);
    return;
  }

  const filtered = emails.filter((item) => {
    const subj = (item.subject || '').toLowerCase();
    const from = (item.from || '').toLowerCase();
    const to = (item.to || '').toLowerCase();
    return subj.includes(q) || from.includes(q) || to.includes(q);
  });

  renderEmailList(filtered);
}

/**
 * メールを選択して詳細を表示
 */
async function selectEmail(emailSummary) {
  // アクティブハイライト更新
  document.querySelectorAll('.email-item').forEach((el) => el.classList.remove('active'));
  const clicked = Array.from(emailListEl.children).find((_, idx) => emails[idx]?.id === emailSummary.id);
  if (clicked) clicked.classList.add('active');

  emptyStateEl.classList.add('hidden');
  mailViewerEl.classList.remove('hidden');

  // 仮のヘッダー表示
  mailSubjectEl.textContent = emailSummary.subject || '(件名なし)';
  mailFromEl.textContent = emailSummary.from;
  mailToEl.textContent = emailSummary.to;
  mailDateEl.textContent = emailSummary.date ? new Date(emailSummary.date).toLocaleString('ja-JP') : '';
  senderAvatarEl.textContent = (emailSummary.from || '?').charAt(0);

  // 本文エリアをローディング状態に
  htmlFrameEl.srcdoc = '<p style="color: #64748b; font-family: sans-serif; padding: 20px;">本文を読み込み中...</p>';
  textBodyEl.textContent = '本文を読み込み中...';

  try {
    const res = await fetch(`/api/emails/${emailSummary.id}`);
    if (res.status === 403) {
      showAuthModal();
      return;
    }
    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status}`);
    }

    const detail = await res.json();
    currentEmail = detail;

    // 詳細表示の反映
    mailSubjectEl.textContent = detail.subject || '(件名なし)';
    mailFromEl.textContent = detail.from;
    mailToEl.textContent = detail.to;
    senderAvatarEl.textContent = (detail.from || '?').charAt(0);
    mailDateEl.textContent = detail.date ? new Date(detail.date).toLocaleString('ja-JP') : '';

    if (detail.cc) {
      mailCcEl.textContent = detail.cc;
      mailCcWrapperEl.classList.remove('hidden');
    } else {
      mailCcWrapperEl.classList.add('hidden');
    }

    // 添付ファイル
    if (detail.attachments && detail.attachments.length > 0) {
      attachmentsSectionEl.classList.remove('hidden');
      attachmentsListEl.innerHTML = '';
      detail.attachments.forEach((att) => {
        const a = document.createElement('a');
        a.className = 'attachment-badge';
        a.href = `/api/emails/${detail.id}/attachments/${att.index}`;
        a.target = '_blank';
        a.download = att.filename;
        a.innerHTML = `📎 ${escapeHtml(att.filename)} (${formatBytes(att.size)})`;
        attachmentsListEl.appendChild(a);
      });
    } else {
      attachmentsSectionEl.classList.add('hidden');
    }

    // 本文レンダリング
    textBodyEl.textContent = detail.text || '(プレーンテキスト本文はありません)';

    let htmlContent = detail.html;
    if (!htmlContent) {
      if (detail.textAsHtml) {
        htmlContent = detail.textAsHtml;
      } else {
        htmlContent = `<pre style="font-family: monospace; white-space: pre-wrap; word-break: break-word;">${escapeHtml(detail.text || '')}</pre>`;
      }
    }

    // iframe内にHTMLをセット
    htmlFrameEl.srcdoc = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <base target="_blank">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #1e293b;
              line-height: 1.6;
              padding: 24px;
              margin: 0;
            }
            img { max-width: 100%; height: auto; }
            a { color: #0284c7; }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
      </html>
    `;

    // タブのデフォルト選択（HTMLがあればHTML、無ければテキスト）
    if (detail.html) {
      switchTab('html');
    } else {
      switchTab('text');
    }
  } catch (err) {
    console.error('Failed to load email details:', err);
    htmlFrameEl.srcdoc = `<p style="color: red; padding: 20px;">エラー: メールの取得に失敗しました (${err.message})</p>`;
  }
}

/**
 * タブ切り替え
 */
function switchTab(tab) {
  activeTab = tab;
  if (tab === 'html') {
    tabHtmlEl.classList.add('active');
    tabTextEl.classList.remove('active');
    htmlFrameEl.classList.remove('hidden');
    textBodyEl.classList.add('hidden');
  } else {
    tabTextEl.classList.add('active');
    tabHtmlEl.classList.remove('active');
    textBodyEl.classList.remove('hidden');
    htmlFrameEl.classList.add('hidden');
  }
}

function showAuthModal() {
  authModalEl.classList.remove('hidden');
}

// ユーティリティ
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSenderDisplayName(fromStr) {
  if (!fromStr) return '(差出人不明)';
  const match = fromStr.match(/^"?([^"<]+)"?\s*<.*>$/);
  if (match && match[1]) return match[1].trim();
  return fromStr.split('<')[0].trim() || fromStr;
}

function formatDate(d) {
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
