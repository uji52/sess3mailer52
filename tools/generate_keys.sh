#!/usr/bin/env bash
set -euo pipefail

# スクリプトのディレクトリからプロジェクトルートを特定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
KEYS_DIR="${PROJECT_ROOT}/keys"

mkdir -p "${KEYS_DIR}"

PRIVATE_KEY="${KEYS_DIR}/private_key.pem"
PUBLIC_KEY="${KEYS_DIR}/public_key.pem"

if [ -f "${PRIVATE_KEY}" ] && [ -f "${PUBLIC_KEY}" ]; then
  echo "⚠️ 鍵ファイルが既に存在します: ${KEYS_DIR}"
  read -p "上書きして新しく再生成しますか？ (y/N): " -r answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    echo "鍵の生成を中止しました。"
    exit 0
  fi
fi

echo "🔑 CloudFront用 RSA 2048bit キーペアを生成中..."
openssl genrsa -out "${PRIVATE_KEY}" 2048
openssl rsa -pubout -in "${PRIVATE_KEY}" -out "${PUBLIC_KEY}"
chmod 600 "${PRIVATE_KEY}"
chmod 644 "${PUBLIC_KEY}"

echo "✅ 鍵の生成が完了しました！"
echo "  秘密鍵: ${PRIVATE_KEY} (※Gitにはコミットしないでください)"
echo "  公開鍵: ${PUBLIC_KEY} (CDKデプロイ時にCloudFront KeyGroupに登録されます)"
