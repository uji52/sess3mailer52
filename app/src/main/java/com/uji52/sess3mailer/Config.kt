package com.uji52.sess3mailer

import android.content.Context
import android.content.SharedPreferences

/**
 * アプリケーション設定管理
 */
object Config {
    private const val PREFS_NAME = "sess3mailer_prefs"
    private const val KEY_DOMAIN = "domain"
    private const val KEY_PUBLIC_KEY_ID = "public_key_id"
    private const val KEY_PRIVATE_KEY_PEM = "private_key_pem"

    // デフォルト値
    const val DEFAULT_DOMAIN = "email.uji52.com"
    const val DEFAULT_PUBLIC_KEY_ID = "KW6WBIB778YSP"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getDomain(context: Context): String {
        return getPrefs(context).getString(KEY_DOMAIN, DEFAULT_DOMAIN) ?: DEFAULT_DOMAIN
    }

    fun setDomain(context: Context, domain: String) {
        getPrefs(context).edit().putString(KEY_DOMAIN, domain.trim()).apply()
    }

    fun getPublicKeyId(context: Context): String {
        return getPrefs(context).getString(KEY_PUBLIC_KEY_ID, DEFAULT_PUBLIC_KEY_ID) ?: DEFAULT_PUBLIC_KEY_ID
    }

    fun setPublicKeyId(context: Context, keyId: String) {
        getPrefs(context).edit().putString(KEY_PUBLIC_KEY_ID, keyId.trim()).apply()
    }

    /**
     * 秘密鍵 PEM 文字列を取得
     * 1. SharedPreferences に保存されている値
     * 2. なければ assets/private_key.pem から読み込み
     */
    fun getPrivateKeyPem(context: Context): String? {
        val saved = getPrefs(context).getString(KEY_PRIVATE_KEY_PEM, null)
        if (!saved.isNullOrBlank()) {
            return saved
        }

        // assets/private_key.pem からのフォールバック読み込み
        return try {
            context.assets.open("private_key.pem").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            null
        }
    }

    fun setPrivateKeyPem(context: Context, pem: String) {
        getPrefs(context).edit().putString(KEY_PRIVATE_KEY_PEM, pem.trim()).apply()
    }

    fun isConfigured(context: Context): Boolean {
        return !getPrivateKeyPem(context).isNullOrBlank() && getPublicKeyId(context).isNotBlank()
    }
}
