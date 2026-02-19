/**
 * 請求書管理 - PDF一覧（Finder風・フォルダ分け・ページネーション）
 */

const DB_NAME = 'InvoicePDFStore';
const DB_VERSION = 2;
const STORE_PDFS = 'pdfs';
const STORE_FOLDERS = 'folders';
const ITEMS_PER_PAGE = 20;

let db = null;
let editingId = null;
let editingFolderId = null;
let currentFolderId = 'all'; // 'all' | 'null' | folderId
let currentPage = 1;
let moveTargetPdfId = null;

// DOM
const folderList = document.getElementById('folderList');
const addFolderBtn = document.getElementById('addFolderBtn');
const breadcrumb = document.getElementById('breadcrumb');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearch');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const contentGrid = document.getElementById('contentGrid');
const countBadge = document.getElementById('countBadge');
const totalAmountEl = document.getElementById('totalAmount');
const pagination = document.getElementById('pagination');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const pageInfo = document.getElementById('pageInfo');
const emptyState = document.getElementById('emptyState');
const noResultsState = document.getElementById('noResultsState');
const viewerModal = document.getElementById('viewerModal');
const viewerTitle = document.getElementById('viewerTitle');
const pdfViewer = document.getElementById('pdfViewer');
const closeViewerBtn = document.getElementById('closeViewer');
const viewerBackdrop = viewerModal.querySelector('.viewer-backdrop');
const editModal = document.getElementById('editModal');
const editInput = document.getElementById('editInput');
const saveEditBtn = document.getElementById('saveEdit');
const cancelEditBtn = document.getElementById('cancelEdit');
const modalBackdrop = editModal.querySelector('.modal-backdrop');
const folderModal = document.getElementById('folderModal');
const folderModalTitle = document.getElementById('folderModalTitle');
const folderInput = document.getElementById('folderInput');
const saveFolderBtn = document.getElementById('saveFolder');
const cancelFolderBtn = document.getElementById('cancelFolder');
const moveModal = document.getElementById('moveModal');
const moveTargetName = document.getElementById('moveTargetName');
const moveFolderList = document.getElementById('moveFolderList');
const cancelMoveBtn = document.getElementById('cancelMove');

let viewerBlobUrl = null;

// PDF.js 初期化
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ========================================
// AI 金額抽出
// ========================================

function getConfig() {
  return (typeof window !== 'undefined' && window.INVOICE_CONFIG) || {};
}

async function extractTextFromPDF(blob) {
  if (typeof pdfjsLib === 'undefined') return '';
  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  let text = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n';
  }
  return text.trim();
}

async function extractAmountWithAI(text) {
  const config = getConfig();
  const apiKey = config.OPENAI_API_KEY;
  const model = config.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    return { amount: null, error: 'config.js に OPENAI_API_KEY を設定してください' };
  }

  const systemPrompt = `あなたは請求書を読み取る専門家です。
与えられた請求書のテキストから、最終的な合計金額（請求金額・お支払い金額）を抽出してください。
税込・税抜のどちらか明確な場合は税込を優先してください。
金額は数値のみで返答してください（カンマや円などの記号は含めない）。
見つからない場合は null を返してください。
JSON形式で応答: {"amount": 数値 または null}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '以下の請求書テキストから合計金額を抽出してください:\n\n' + text.slice(0, 8000) },
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { amount: null, error: err.error?.message || res.statusText };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\{\s*"amount"\s*:\s*(-?\d+|null)\s*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return { amount: parsed.amount === null ? null : Number(parsed.amount) };
    }
    const numMatch = content.match(/\d{1,15}/);
    if (numMatch) return { amount: parseInt(numMatch[0], 10) };
    return { amount: null, error: '金額を抽出できませんでした' };
  } catch (err) {
    return { amount: null, error: err.message || 'API通信エラー' };
  }
}

async function extractAndSaveAmount(pdfId, blob) {
  const text = await extractTextFromPDF(blob);
  if (!text || text.length < 10) {
    await updatePDF(pdfId, { amount: null, amountError: 'テキスト抽出失敗' });
    return;
  }
  const result = await extractAmountWithAI(text);
  await updatePDF(pdfId, {
    amount: result.amount,
    amountError: result.error || null,
  });
}

function formatAmount(val) {
  if (val == null || isNaN(val)) return '—';
  return '¥' + Number(val).toLocaleString();
}

// ========================================
// IndexedDB
// ========================================

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_PDFS)) {
        database.createObjectStore(STORE_PDFS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(STORE_FOLDERS)) {
        database.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
      }
    };
  });
}

function getAllPDFs() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PDFS, 'readonly');
    const request = tx.objectStore(STORE_PDFS).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

function getAllFolders() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOLDERS, 'readonly');
    const request = tx.objectStore(STORE_FOLDERS).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

function addPDF(id, name, blob, folderId = null, amount = null) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PDFS, 'readwrite');
    const record = { id, name, blob, folderId, amount };
    const request = tx.objectStore(STORE_PDFS).add(record);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function updatePDF(id, updates) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PDFS, 'readwrite');
    const store = tx.objectStore(STORE_PDFS);
    const getRequest = store.get(id);
    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) return reject(new Error('Not found'));
      Object.assign(record, updates);
      store.put(record).onsuccess = () => resolve();
    };
  });
}

function deletePDF(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PDFS, 'readwrite');
    const request = tx.objectStore(STORE_PDFS).delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function addFolder(id, name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOLDERS, 'readwrite');
    const request = tx.objectStore(STORE_FOLDERS).add({ id, name });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function updateFolder(id, name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FOLDERS, 'readwrite');
    const store = tx.objectStore(STORE_FOLDERS);
    const getRequest = store.get(id);
    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (!record) return reject(new Error('Not found'));
      record.name = name;
      store.put(record).onsuccess = () => resolve();
    };
  });
}

function deleteFolder(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_FOLDERS, STORE_PDFS], 'readwrite');
    const folderStore = tx.objectStore(STORE_FOLDERS);
    const pdfStore = tx.objectStore(STORE_PDFS);
    folderStore.delete(id);
    const pdfGetAll = pdfStore.getAll();
    pdfGetAll.onsuccess = () => {
      const pdfs = pdfGetAll.result || [];
      pdfs.filter((p) => p.folderId === id).forEach((p) => {
        p.folderId = null;
        pdfStore.put(p);
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ========================================
// Util
// ========================================

function generateId(prefix = 'pdf') {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========================================
// Render
// ========================================

function getFolderDisplayName(folderId) {
  if (folderId === 'all') return 'すべて';
  if (folderId === 'null' || folderId == null) return '未分類';
  return folderId;
}

function renderSidebar(folders) {
  const activeId = currentFolderId === 'null' ? 'null' : currentFolderId;
  document.querySelectorAll('.sidebar-item[data-folder-id]').forEach((el) => {
    el.classList.toggle('active', el.dataset.folderId === activeId);
  });

  folderList.innerHTML = folders
    .map(
      (f) => `
    <div class="sidebar-folder-row" data-folder-id="${escapeHtml(f.id)}">
      <button type="button" class="sidebar-item folder-item">
        <span class="sidebar-icon">📁</span>
        <span class="sidebar-label">${escapeHtml(f.name)}</span>
      </button>
      <div class="folder-actions">
        <button type="button" class="btn-icon-small rename-folder-btn" title="名前変更">✏️</button>
        <button type="button" class="btn-icon-small delete-folder-btn" title="削除">🗑️</button>
      </div>
    </div>
  `
    )
    .join('');

  folderList.querySelectorAll('.folder-item').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateToFolder(folders[i].id);
    });
  });

  folderList.querySelectorAll('.rename-folder-btn').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderEditModal(folders[i].id, folders[i].name);
    });
  });

  folderList.querySelectorAll('.delete-folder-btn').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`「${folders[i].name}」を削除しますか？中のPDFは未分類に移動されます。`)) {
        deleteFolder(folders[i].id).then(loadAndRender);
      }
    });
  });
}

function renderBreadcrumb(folders) {
  if (currentFolderId === 'all') {
    breadcrumb.innerHTML = '<span class="breadcrumb-item current">すべて</span>';
    return;
  }
  if (currentFolderId === 'null') {
    breadcrumb.innerHTML = '<span class="breadcrumb-item current">未分類</span>';
    return;
  }
  const folder = folders.find((f) => f.id === currentFolderId);
  breadcrumb.innerHTML = `<span class="breadcrumb-item">すべて</span><span class="breadcrumb-sep"> › </span><span class="breadcrumb-item current">${escapeHtml(folder?.name || 'フォルダ')}</span>`;
}

function filterItems(pdfs, folders) {
  let items = pdfs.map((p) => ({ ...p, type: 'pdf' }));
  const searchTerm = searchInput.value.trim().toLowerCase();

  if (currentFolderId === 'all') {
    // フォルダも表示（現在のビューはPDFのみ、フォルダはサイドバー）
    items = items;
  } else if (currentFolderId === 'null') {
    items = items.filter((p) => p.folderId == null || p.folderId === 'null');
  } else {
    items = items.filter((p) => p.folderId === currentFolderId);
  }

  if (searchTerm) {
    items = items.filter((p) => p.name.toLowerCase().includes(searchTerm));
  }

  return items;
}

function renderContentGrid(pdfs, folders) {
  const items = filterItems(pdfs, folders);
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);

  countBadge.textContent = items.length + '件';

  if (items.length === 0) {
    contentGrid.innerHTML = '';
    contentGrid.hidden = true;
    pagination.hidden = true;
    totalAmountEl.textContent = '合計: —';
    emptyState.hidden = pdfs.length > 0;
    noResultsState.hidden = pdfs.length === 0;
    return;
  }

  emptyState.hidden = true;
  noResultsState.hidden = true;
  contentGrid.hidden = false;

  const totalSum = items.reduce((sum, it) => sum + (it.amount != null && !isNaN(it.amount) ? it.amount : 0), 0);
  totalAmountEl.textContent = '合計: ' + formatAmount(totalSum);
  totalAmountEl.title = items.length + '件中、' + items.filter((it) => it.amount != null).length + '件の金額を認識';

  contentGrid.innerHTML = pageItems
    .map(
      (item) => {
        const amt = item.amount != null && !isNaN(item.amount) ? formatAmount(item.amount) : (item.amountError ? '解析失敗' : '解析中…');
        const amtCls = item.amount != null ? 'amount-ok' : (item.amountError ? 'amount-error' : 'amount-pending');
        return `
    <div class="grid-item ${item.type}" data-id="${escapeHtml(item.id)}">
      <div class="grid-item-icon">${item.type === 'pdf' ? '📄' : '📁'}</div>
      <div class="grid-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      ${item.type === 'pdf' ? `<div class="grid-item-amount ${amtCls}">${amt}</div>` : ''}
      <div class="grid-item-actions">
        ${item.type === 'pdf' ? `
        <button type="button" class="btn-icon-small parse-btn" title="AIで金額を再解析">🤖</button>
        <button type="button" class="btn-icon-small edit-btn" title="名前編集">✏️</button>
        <button type="button" class="btn-icon-small move-btn" title="フォルダに移動">📂</button>
        <a href="#" class="btn-icon-small download-btn" title="ダウンロード">⬇️</a>
        <button type="button" class="btn-icon-small delete-btn" title="削除">🗑️</button>
        ` : ''}
      </div>
    </div>
  `;
      }
    )
    .join('');

  contentGrid.querySelectorAll('.grid-item.pdf').forEach((el, i) => {
    const item = pageItems[i];
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.grid-item-actions')) openPDFViewer(item);
    });
    el.querySelector('.parse-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = e.target.closest('.parse-btn');
      if (btn?.dataset.loading) return;
      btn.dataset.loading = '1';
      btn.title = '解析中…';
      await extractAndSaveAmount(item.id, item.blob);
      delete btn.dataset.loading;
      btn.title = 'AIで金額を再解析';
      await loadAndRender();
    });
    el.querySelector('.edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(item.id, item.name);
    });
    el.querySelector('.move-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openMoveModal(item);
    });
    const dl = el.querySelector('.download-btn');
    if (dl) {
      dl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = URL.createObjectURL(item.blob);
        dl.href = url;
        dl.download = item.name + '.pdf';
        dl.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
      });
    }
    el.querySelector('.delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`「${item.name}」を削除しますか？`)) handleDelete(item.id);
    });
  });

  // ページネーション
  pagination.hidden = totalPages <= 1;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  pageInfo.textContent = `${currentPage} / ${totalPages}`;
}

function navigateToFolder(folderId) {
  currentFolderId = folderId;
  currentPage = 1;
  loadAndRender();
}

// ========================================
// Handlers
// ========================================

async function loadAndRender() {
  const [pdfs, folders] = await Promise.all([getAllPDFs(), getAllFolders()]);
  pdfs.forEach((p) => {
    if (p.folderId === undefined) p.folderId = null;
  });
  renderSidebar(folders);
  renderBreadcrumb(folders);
  renderContentGrid(pdfs, folders);
}

async function handleFileAdd(files) {
  const pdfFiles = Array.from(files).filter((f) => f.type === 'application/pdf');
  if (pdfFiles.length === 0) {
    alert('PDFファイルを選択してください。');
    return;
  }

  const targetFolderId = currentFolderId === 'all' || currentFolderId === 'null' ? null : currentFolderId;
  const addedIds = [];

  for (const file of pdfFiles) {
    const id = generateId();
    const name = (file.name || '').replace(/\.pdf$/i, '') || '無題';
    await addPDF(id, name, file, targetFolderId, null);
    addedIds.push({ id, blob: file });
  }

  await loadAndRender();

  for (const { id, blob } of addedIds) {
    await extractAndSaveAmount(id, blob);
  }
  await loadAndRender();
}

async function handleDelete(id) {
  await deletePDF(id);
  await loadAndRender();
}

function openPDFViewer(item) {
  if (viewerBlobUrl) URL.revokeObjectURL(viewerBlobUrl);
  viewerBlobUrl = URL.createObjectURL(item.blob);
  pdfViewer.src = viewerBlobUrl;
  viewerTitle.textContent = item.name;
  viewerModal.hidden = false;
}

function closePDFViewer() {
  viewerModal.hidden = true;
  pdfViewer.src = '';
  if (viewerBlobUrl) {
    URL.revokeObjectURL(viewerBlobUrl);
    viewerBlobUrl = null;
  }
}

function openEditModal(id, currentName) {
  editingId = id;
  editInput.value = currentName;
  editModal.hidden = false;
  editInput.focus();
}

function closeEditModal() {
  editingId = null;
  editModal.hidden = true;
}

async function handleSaveEdit() {
  if (!editingId) return;
  const newName = editInput.value.trim();
  if (!newName) {
    alert('名前を入力してください。');
    return;
  }
  await updatePDF(editingId, { name: newName });
  closeEditModal();
  await loadAndRender();
}

// フォルダモーダル
function openFolderCreateModal() {
  editingFolderId = null;
  folderModalTitle.textContent = '新規フォルダ';
  folderInput.value = '';
  folderInput.placeholder = 'フォルダ名を入力';
  saveFolderBtn.textContent = '作成';
  folderModal.hidden = false;
  folderInput.focus();
}

function openFolderEditModal(id, name) {
  editingFolderId = id;
  folderModalTitle.textContent = 'フォルダ名を変更';
  folderInput.value = name;
  folderInput.placeholder = 'フォルダ名を入力';
  saveFolderBtn.textContent = '保存';
  folderModal.hidden = false;
  folderInput.focus();
}

function closeFolderModal() {
  editingFolderId = null;
  folderModal.hidden = true;
}

async function handleSaveFolder() {
  const name = folderInput.value.trim();
  if (!name) {
    alert('フォルダ名を入力してください。');
    return;
  }
  if (editingFolderId) {
    await updateFolder(editingFolderId, name);
  } else {
    await addFolder(generateId('folder'), name);
  }
  closeFolderModal();
  await loadAndRender();
}

// フォルダ移動モーダル
function openMoveModal(item) {
  moveTargetPdfId = item.id;
  moveTargetName.textContent = item.name;
  getAllFolders().then((folders) => {
    moveFolderList.innerHTML = [
      '<li><button type="button" class="move-folder-option" data-folder-id="null">未分類</button></li>',
      ...folders.map((f) => `<li><button type="button" class="move-folder-option" data-folder-id="${escapeHtml(f.id)}">${escapeHtml(f.name)}</button></li>`),
    ].join('');
    moveFolderList.querySelectorAll('.move-folder-option').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const fid = btn.dataset.folderId;
        await updatePDF(moveTargetPdfId, { folderId: fid === 'null' ? null : fid });
        moveModal.hidden = true;
        moveTargetPdfId = null;
        await loadAndRender();
      });
    });
    moveModal.hidden = false;
  });
}

// ========================================
// Events
// ========================================

document.querySelectorAll('.sidebar-item[data-folder-id]').forEach((btn) => {
  btn.addEventListener('click', () => navigateToFolder(btn.dataset.folderId));
});

addFolderBtn.addEventListener('click', openFolderCreateModal);

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    loadAndRender();
  }
});

nextPageBtn.addEventListener('click', () => {
  currentPage++;
  loadAndRender();
});

searchInput.addEventListener('input', () => {
  currentPage = 1;
  loadAndRender();
  clearSearchBtn.hidden = !searchInput.value.trim();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  clearSearchBtn.hidden = true;
  currentPage = 1;
  loadAndRender();
});

function preventDefault(e) {
  e.preventDefault();
  e.stopPropagation();
}

dropZone.addEventListener('dragenter', (e) => {
  preventDefault(e);
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', (e) => {
  preventDefault(e);
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('dragover', preventDefault);
dropZone.addEventListener('drop', (e) => {
  preventDefault(e);
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files?.length) handleFileAdd(e.dataTransfer.files);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files?.length) handleFileAdd(e.target.files);
  e.target.value = '';
});

closeViewerBtn.addEventListener('click', closePDFViewer);
viewerBackdrop.addEventListener('click', closePDFViewer);

saveEditBtn.addEventListener('click', handleSaveEdit);
cancelEditBtn.addEventListener('click', closeEditModal);
modalBackdrop.addEventListener('click', closeEditModal);

saveFolderBtn.addEventListener('click', handleSaveFolder);
cancelFolderBtn.addEventListener('click', closeFolderModal);
folderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSaveFolder();
  if (e.key === 'Escape') closeFolderModal();
});

cancelMoveBtn.addEventListener('click', () => {
  moveModal.hidden = true;
  moveTargetPdfId = null;
});

folderModal.querySelector('.modal-backdrop')?.addEventListener('click', closeFolderModal);
moveModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
  moveModal.hidden = true;
  moveTargetPdfId = null;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!viewerModal.hidden) closePDFViewer();
    else if (!folderModal.hidden) closeFolderModal();
    else if (!moveModal.hidden) {
      moveModal.hidden = true;
      moveTargetPdfId = null;
    }
  }
});

// Init
openDB()
  .then(() => loadAndRender())
  .catch((err) => {
    console.error('DB init error:', err);
    alert('ストレージの初期化に失敗しました。');
  });
