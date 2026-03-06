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
  banner.innerHTML = `
    <div class="line-banner-inner">
      <p class="line-banner-text">📱 カメラ・ファイル機能を使うには、ブラウザで開いてください</p>
      <p class="line-banner-hint">Line → 右上の ︙ メニュー → 「ブラウザで開く」をタップ</p>
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
    .line-banner-text { margin: 0 0 4px; font-weight: 600; }
    .line-banner-hint { margin: 0; opacity: 0.95; font-size: 12px; }
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
    body.line-banner-visible { padding-top: 72px !important; }
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
