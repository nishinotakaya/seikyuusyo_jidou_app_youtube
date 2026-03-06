/**
 * レシート読み取り・割り勘
 * カメラ撮影 → OpenAI Vision で読み取り → 男性/女性 人数・割合で割り勘計算
 */

let stream = null;
let receiptData = { total: null, detail: '' };

const startCameraBtn = document.getElementById('startCameraBtn');
const cameraArea = document.getElementById('cameraArea');
const video = document.getElementById('video');
const captureBtn = document.getElementById('captureBtn');
const stopCameraBtn = document.getElementById('stopCameraBtn');
const cameraError = document.getElementById('cameraError');
const stepSplit = document.getElementById('stepSplit');
const receiptResult = document.getElementById('receiptResult');
const receiptTotal = document.getElementById('receiptTotal');
const receiptDetail = document.getElementById('receiptDetail');
const maleCount = document.getElementById('maleCount');
const maleRatio = document.getElementById('maleRatio');
const femaleCount = document.getElementById('femaleCount');
const femaleRatio = document.getElementById('femaleRatio');
const calcBtn = document.getElementById('calcBtn');
const splitResult = document.getElementById('splitResult');
const splitResultBody = document.getElementById('splitResultBody');
const resetBtn = document.getElementById('resetBtn');
const apiError = document.getElementById('apiError');
const loadingMsg = document.getElementById('loadingMsg');

function getConfig() {
  return (typeof window !== 'undefined' && window.INVOICE_CONFIG) || {};
}

async function startCamera() {
  cameraError.hidden = true;
  startCameraBtn.disabled = true;

  const constraintsList = [
    { video: { facingMode: 'environment' }, audio: false },
    { video: { facingMode: 'user' }, audio: false },
    { video: true, audio: false },
  ];

  for (const constraints of constraintsList) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      startCameraBtn.hidden = true;
      cameraArea.hidden = false;
      startCameraBtn.disabled = false;
      return;
    } catch (e) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    }
  }

  const errMsg = navigator.mediaDevices == null
    ? 'このブラウザはカメラに対応していません。Chrome等を利用してください。'
    : 'カメラを起動できません。設定でカメラの許可を確認するか、HTTPSのページで開いてください。';
  cameraError.textContent = errMsg;
  cameraError.hidden = false;
  startCameraBtn.disabled = false;
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  cameraArea.hidden = true;
  startCameraBtn.hidden = false;
}

function captureToCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function readReceiptWithAI(base64Image) {
  const config = getConfig();
  const apiKey = config.OPENAI_API_KEY;
  const model = config.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('config.js に OPENAI_API_KEY を設定してください');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: `あなたはレシートを読み取る専門家です。
画像のレシートから以下を抽出し、JSON形式で返してください。
- total: 合計金額（数値のみ、見つからない場合はnull）
- items: 明細の短文リスト（配列、最大20件）
- detail: レシートの要約（1〜2行の日本語）

必ず次の形式のみ返答: {"total": 数値またはnull, "items": ["...", "..."], "detail": "..."}`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: base64Image.startsWith('data:') ? base64Image : 'data:image/jpeg;base64,' + base64Image },
            },
          ],
        },
      ],
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || res.statusText);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  const numMatch = content.match(/(\d{1,10})/g);
  return {
    total: numMatch ? parseInt(numMatch[numMatch.length - 1], 10) : null,
    items: [],
    detail: content.slice(0, 200),
  };
}

function formatYen(n) {
  if (n == null || isNaN(n)) return '—';
  return '¥' + Number(n).toLocaleString();
}

async function onCapture() {
  loadingMsg.hidden = false;
  apiError.hidden = true;
  captureBtn.disabled = true;

  try {
    const dataUrl = captureToCanvas();
    stopCamera();

    const result = await readReceiptWithAI(dataUrl);
    receiptData = {
      total: result.total != null ? result.total : (typeof result.total === 'string' ? parseInt(result.total, 10) : null),
      detail: result.detail || '',
      items: result.items || [],
    };

    receiptTotal.textContent = '合計: ' + formatYen(receiptData.total);
    receiptDetail.textContent = receiptData.detail;
    if (receiptData.items && receiptData.items.length) {
      receiptDetail.innerHTML = receiptData.detail + '<br><small>' + (receiptData.items.slice(0, 10).join(' / ')) + '</small>';
    }

    stepSplit.hidden = false;
    stepSplit.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    apiError.textContent = '読み取りエラー: ' + (err.message || '');
    apiError.hidden = false;
  } finally {
    loadingMsg.hidden = true;
    captureBtn.disabled = false;
  }
}

function onCalc() {
  const total = receiptData.total;
  if (total == null || isNaN(total)) {
    splitResultBody.innerHTML = '<p class="error-msg">合計金額が読み取れていません。</p>';
    splitResult.hidden = false;
    return;
  }

  const mCount = parseInt(maleCount.value, 10) || 0;
  const mRatio = parseInt(maleRatio.value, 10) || 0;
  const fCount = parseInt(femaleCount.value, 10) || 0;
  const fRatio = parseInt(femaleRatio.value, 10) || 0;

  const totalRatio = mRatio + fRatio;
  if (totalRatio === 0) {
    splitResultBody.innerHTML = '<p class="error-msg">割合の合計を1以上にしてください。</p>';
    splitResult.hidden = false;
    return;
  }

  const maleAmount = Math.round((total * mRatio) / totalRatio);
  const femaleAmount = Math.round((total * fRatio) / totalRatio);
  const malePerPerson = mCount > 0 ? Math.round(maleAmount / mCount) : 0;
  const femalePerPerson = fCount > 0 ? Math.round(femaleAmount / fCount) : 0;

  let html = '<table class="split-table"><tbody>';
  html += '<tr><th>合計</th><td>' + formatYen(total) + '</td></tr>';
  if (mRatio > 0) {
    html += '<tr><th>男性</th><td>' + formatYen(maleAmount) + '（' + mRatio + '％）';
    if (mCount > 0) html += ' → 1人あたり ' + formatYen(malePerPerson);
    html += '</td></tr>';
  }
  if (fRatio > 0) {
    html += '<tr><th>女性</th><td>' + formatYen(femaleAmount) + '（' + fRatio + '％）';
    if (fCount > 0) html += ' → 1人あたり ' + formatYen(femalePerPerson);
    html += '</td></tr>';
  }
  html += '</tbody></table>';
  splitResultBody.innerHTML = html;
  splitResult.hidden = false;
  splitResult.scrollIntoView({ behavior: 'smooth' });
}

function onReset() {
  receiptData = { total: null, detail: '' };
  stepSplit.hidden = true;
  splitResult.hidden = true;
  maleCount.value = '0';
  maleRatio.value = '80';
  femaleCount.value = '0';
  femaleRatio.value = '20';
  startCameraBtn.hidden = false;
}

startCameraBtn.addEventListener('click', startCamera);
stopCameraBtn.addEventListener('click', stopCamera);
captureBtn.addEventListener('click', onCapture);
calcBtn.addEventListener('click', onCalc);
resetBtn.addEventListener('click', onReset);
