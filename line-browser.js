/**
 * Lineアプリ内ブラウザ検出
 * カメラ・ファイル機能を使うために外部ブラウザで開くよう案内
 */
(function () {
  const ua = navigator.userAgent || '';
  const isLine = /Line\/\d+/i.test(ua) || (ua.indexOf('Line') !== -1 && /Android|iPhone|iPad/i.test(ua));

  if (!isLine || sessionStorage.getItem('lineBannerClosed')) return;

  const banner = document.createElement('div');
  banner.className = 'line-browser-banner';
  const currentUrl = location.href;
  const isAndroid = /Android/i.test(ua);
  let openChromeBtn = '';
  if (isAndroid) {
    const intentUrl = 'intent://' + location.host + (location.pathname || '') + (location.search || '') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(currentUrl) + ';end';
    openChromeBtn = '<a href="' + intentUrl.replace(/"/g, '&quot;') + '" class="line-banner-btn">Chromeで開く</a>';
  } else {
    openChromeBtn = '<a href="' + currentUrl + '" target="_blank" class="line-banner-btn">ブラウザで開く</a>';
  }

  banner.innerHTML = `
    <div class="line-banner-inner">
      <p class="line-banner-text">📱 カメラ・ファイル機能を使うには、ブラウザで開いてください</p>
      <div class="line-banner-actions">
        ${openChromeBtn}
        <span class="line-banner-or">または 右上 ︙ → 「ブラウザで開く」</span>
      </div>
      <button type="button" class="line-banner-close" aria-label="閉じる">×</button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    .line-browser-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      background: linear-gradient(135deg, #00B900 0%, #00C300 100%);
      color: #fff;
      padding: 12px 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
      font-size: 14px;
    }
    .line-banner-inner { position: relative; padding-right: 32px; }
    .line-banner-text { margin: 0 0 8px; font-weight: 600; }
    .line-banner-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .line-banner-btn {
      display: inline-block;
      padding: 8px 16px;
      background: #fff;
      color: #00B900;
      font-weight: 600;
      font-size: 13px;
      text-decoration: none;
      border-radius: 8px;
      white-space: nowrap;
    }
    .line-banner-btn:hover { background: #f0fff0; }
    .line-banner-or { font-size: 11px; opacity: 0.9; }
    .line-banner-close {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 28px;
      height: 28px;
      border: none;
      background: rgba(255,255,255,0.3);
      color: #fff;
      font-size: 18px;
      line-height: 1;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .line-banner-close:hover { background: rgba(255,255,255,0.5); }
    body { padding-top: 0 !important; }
    body.line-banner-visible { padding-top: 88px !important; }
  `;
  document.head.appendChild(style);
  document.body.insertBefore(banner, document.body.firstChild);
  document.body.classList.add('line-banner-visible');

  banner.querySelector('.line-banner-close').addEventListener('click', function () {
    banner.remove();
    document.body.classList.remove('line-banner-visible');
    sessionStorage.setItem('lineBannerClosed', '1');
  });
})();
