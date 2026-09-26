package com.uji52.sess3mailer

import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec

/**
 * CloudFront のカスタムポリシーに基づく署名付きクッキー（Signed Cookies）を生成するクラス
 */
object CloudFrontCookieSigner {

    data class SignedCookies(
        val policy: String,
        val signature: String,
        val keyPairId: String,
        val expiresEpoch: Long
    ) {
        /**
         * Android CookieManager に渡すための Cookie 文字列一覧を取得
         */
        fun toCookieStrings(domain: String): List<String> {
            val host = domain.removePrefix("https://").removePrefix("http://").trimEnd('/')
            return listOf(
                "CloudFront-Policy=$policy; Domain=$host; Path=/; Secure; SameSite=None",
                "CloudFront-Signature=$signature; Domain=$host; Path=/; Secure; SameSite=None",
                "CloudFront-Key-Pair-Id=$keyPairId; Domain=$host; Path=/; Secure; SameSite=None"
            )
        }
    }

    /**
     * 秘密鍵 PEM 文字列から PrivateKey を生成
     * (PKCS#8 および PKCS#1 の両方に対応)
     */
    fun parsePrivateKey(pem: String): PrivateKey {
        val cleanPem = pem
            .replace("-----BEGIN RSA PRIVATE KEY-----", "")
            .replace("-----END RSA PRIVATE KEY-----", "")
            .replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("\\s+".toRegex(), "")

        val derBytes = Base64.decode(cleanPem, Base64.DEFAULT)

        val pkcs8Bytes = if (pem.contains("BEGIN RSA PRIVATE KEY")) {
            // PKCS#1 の場合は PKCS#8 DER ラッパーを付与
            wrapPkcs1ToPkcs8(derBytes)
        } else {
            derBytes
        }

        val keySpec = PKCS8EncodedKeySpec(pkcs8Bytes)
        val kf = KeyFactory.getInstance("RSA")
        return kf.generatePrivate(keySpec)
    }

    /**
     * PKCS#1 DER バイト列を PKCS#8 DER に変換するヘルパー
     */
    private fun wrapPkcs1ToPkcs8(pkcs1Bytes: ByteArray): ByteArray {
        val pkcs1Len = pkcs1Bytes.size
        val totalLen = pkcs1Len + 22
        val header = byteArrayOf(
            0x30.toByte(), 0x82.toByte(), ((totalLen shr 8) and 0xff).toByte(), (totalLen and 0xff).toByte(),
            0x02.toByte(), 0x01.toByte(), 0x00.toByte(), // version = 0
            0x30.toByte(), 0x0d.toByte(), // SEQUENCE
            0x06.toByte(), 0x09.toByte(), 0x2a.toByte(), 0x86.toByte(), 0x48.toByte(), 0x86.toByte(), 0xf7.toByte(), 0x0d.toByte(), 0x01.toByte(), 0x01.toByte(), 0x01.toByte(), // rsaEncryption OID
            0x05.toByte(), 0x00.toByte(), // NULL
            0x04.toByte(), 0x82.toByte(), ((pkcs1Len shr 8) and 0xff).toByte(), (pkcs1Len and 0xff).toByte() // OCTET STRING
        )
        return header + pkcs1Bytes
    }

    /**
     * CloudFront URL-safe Base64 (+ -> -, = -> _, / -> ~)
     */
    fun toCloudFrontBase64(bytes: ByteArray): String {
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return b64.replace('+', '-').replace('=', '_').replace('/', '~')
    }

    /**
     * 署名付きクッキーの生成
     *
     * @param domain 対象ドメイン（例: "email.uji52.com"）
     * @param privateKey RSA 秘密鍵
     * @param publicKeyId CloudFront Public Key ID（例: "KW6WBIB778YSP"）
     * @param validDurationSeconds 有効期間（秒）。デフォルト 7 日間（604800 秒）
     */
    fun generateCookies(
        domain: String,
        privateKey: PrivateKey,
        publicKeyId: String,
        validDurationSeconds: Long = 7 * 24 * 3600L
    ): SignedCookies {
        val cleanHost = domain.removePrefix("https://").removePrefix("http://").trimEnd('/')
        val resource = "https://$cleanHost/*"
        val expireEpoch = (System.currentTimeMillis() / 1000) + validDurationSeconds

        // ポリシー JSON (空白なし)
        val policyJson = "{\"Statement\":[{\"Resource\":\"$resource\",\"Condition\":{\"DateLessThan\":{\"AWS:EpochTime\":$expireEpoch}}}]}"

        // RSA-SHA1 署名の作成
        val signer = Signature.getInstance("SHA1withRSA")
        signer.initSign(privateKey)
        signer.update(policyJson.toByteArray(StandardCharsets.UTF_8))
        val signatureBytes = signer.sign()

        val policyB64 = toCloudFrontBase64(policyJson.toByteArray(StandardCharsets.UTF_8))
        val signatureB64 = toCloudFrontBase64(signatureBytes)

        return SignedCookies(
            policy = policyB64,
            signature = signatureB64,
            keyPairId = publicKeyId,
            expiresEpoch = expireEpoch
        )
    }
}
