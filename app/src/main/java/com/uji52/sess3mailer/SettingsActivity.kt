package com.uji52.sess3mailer

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private lateinit var editDomain: EditText
    private lateinit var editPublicKeyId: EditText
    private lateinit var editPrivateKey: EditText
    private lateinit var btnSave: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        supportActionBar?.title = "接続・認証設定"

        editDomain = findViewById(R.id.editDomain)
        editPublicKeyId = findViewById(R.id.editPublicKeyId)
        editPrivateKey = findViewById(R.id.editPrivateKey)
        btnSave = findViewById(R.id.btnSave)

        // 現在の設定を読み込み
        editDomain.setText(Config.getDomain(this))
        editPublicKeyId.setText(Config.getPublicKeyId(this))
        editPrivateKey.setText(Config.getPrivateKeyPem(this) ?: "")

        btnSave.setOnClickListener {
            saveSettings()
        }
    }

    private fun saveSettings() {
        val domain = editDomain.text.toString().trim()
        val keyId = editPublicKeyId.text.toString().trim()
        val pem = editPrivateKey.text.toString().trim()

        if (domain.isBlank()) {
            editDomain.error = "ドメインを入力してください"
            return
        }
        if (keyId.isBlank()) {
            editPublicKeyId.error = "Public Key ID を入力してください"
            return
        }
        if (pem.isBlank()) {
            editPrivateKey.error = "秘密鍵 (PEM) を貼り付けてください"
            return
        }

        // 秘密鍵の検証
        try {
            val key = CloudFrontCookieSigner.parsePrivateKey(pem)
            // テスト署名
            CloudFrontCookieSigner.generateCookies(domain, key, keyId, 3600)
        } catch (e: Exception) {
            Toast.makeText(this, "秘密鍵の解析に失敗しました: ${e.message}", Toast.LENGTH_LONG).show()
            return
        }

        Config.setDomain(this, domain)
        Config.setPublicKeyId(this, keyId)
        Config.setPrivateKeyPem(this, pem)

        Toast.makeText(this, "設定を保存しました", Toast.LENGTH_SHORT).show()
        setResult(RESULT_OK)
        finish()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
