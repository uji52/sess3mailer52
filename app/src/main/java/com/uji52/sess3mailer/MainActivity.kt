package com.uji52.sess3mailer

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.webkit.*
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    private val settingsLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            setupCookiesAndLoadUrl()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        setupWebView()
        setupSwipeRefresh()

        if (!Config.isConfigured(this)) {
            // 未設定の場合は設定画面へ誘導
            Toast.makeText(this, "初期設定（秘密鍵の登録）を行ってください", Toast.LENGTH_LONG).show()
            val intent = Intent(this, SettingsActivity::class.java)
            settingsLauncher.launch(intent)
        } else {
            setupCookiesAndLoadUrl()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false

        // WebView 内での Cookie を有効化
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress < 100) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                    swipeRefresh.isRefreshing = false
                }
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                val domain = Config.getDomain(this@MainActivity)

                // 同一ドメイン内は WebView で表示
                if (url.contains(domain)) {
                    return false
                }

                // 外部サイトのリンクは端末の既定ブラウザで開く
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    return true
                } catch (e: Exception) {
                    return false
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                if (errorResponse?.statusCode == 403 && request?.isForMainFrame == true) {
                    Toast.makeText(
                        this@MainActivity,
                        "認証エラー (403): 秘密鍵またはPublicKeyIdを確認してください",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }

        // 添付ファイルのダウンロード処理
        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            try {
                val request = DownloadManager.Request(Uri.parse(url))
                val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
                request.setTitle(filename)
                request.setDescription("添付ファイルをダウンロード中...")
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)

                // ダウンロードリクエストにも Cookie を付与
                val cookie = CookieManager.getInstance().getCookie(url)
                request.addRequestHeader("Cookie", cookie)

                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "ダウンロードを開始しました: $filename", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Toast.makeText(this, "ダウンロードに失敗しました: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun setupSwipeRefresh() {
        swipeRefresh.setOnRefreshListener {
            // スワイプ時に Cookie を再更新してリロード
            setupCookiesAndLoadUrl()
        }
    }

    /**
     * 秘密鍵から署名付きクッキーを自動生成して CookieManager に注入し、URL を開く
     */
    private fun setupCookiesAndLoadUrl() {
        val domain = Config.getDomain(this)
        val keyId = Config.getPublicKeyId(this)
        val pem = Config.getPrivateKeyPem(this)

        if (pem.isNullOrBlank()) {
            Toast.makeText(this, "秘密鍵が設定されていません", Toast.LENGTH_SHORT).show()
            return
        }

        try {
            val privateKey = CloudFrontCookieSigner.parsePrivateKey(pem)
            // 7日間の有効期間で Cookie を自動署名
            val cookies = CloudFrontCookieSigner.generateCookies(domain, privateKey, keyId)

            val cookieManager = CookieManager.getInstance()
            val targetUrl = "https://$domain"

            // 署名付きクッキーの登録
            cookies.toCookieStrings(domain).forEach { cookieStr ->
                cookieManager.setCookie(targetUrl, cookieStr)
            }
            cookieManager.flush()

            // ページの読み込み
            webView.loadUrl("$targetUrl/")
        } catch (e: Exception) {
            Toast.makeText(this, "署名付きクッキーの生成に失敗しました: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreateOptionsMenu(menu: Menu?): Boolean {
        menuInflater.inflate(R.menu.menu_main, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_refresh -> {
                setupCookiesAndLoadUrl()
                true
            }
            R.id.action_settings -> {
                val intent = Intent(this, SettingsActivity::class.java)
                settingsLauncher.launch(intent)
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}
