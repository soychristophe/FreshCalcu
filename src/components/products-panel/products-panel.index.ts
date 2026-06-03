// ─── src/components/products-panel/index.ts ──────────────────────────────────
// Self-contained Products Panel.
// Injects its own HTML, wires all events, calls the typed API.
import {
  apiGetProductsPage,
  apiCreateProduct,
  apiUpdateProduct,
  apiDeleteProduct,
  apiGetProduct,
} from '@/services/api.ts';
import { refreshProductCache, getCacheTimestamp } from '@/services/productCache.ts';
import { transformValuesInput }   from '@/utils/format.ts';
import { esc, findEl }            from '@/utils/dom.ts';
import { DELETE_PIN, EDIT_PIN }             from '@/config/constants.ts';
import type { Product, ProductPage } from '@/types/index.ts';

/* ── Module-private state ────────────────────────────────────────────────── */
interface PanelState {
  page:        number;
  pages:       number;
  total:       number;
  query:       string;
  editingId:   string | null;
  searchTimer: ReturnType<typeof setTimeout> | null;
}

const panelState: PanelState = {
  page:        1,
  pages:       1,
  total:       0,
  query:       '',
  editingId:   null,
  searchTimer: null,
};

let _toastTimer: ReturnType<typeof setTimeout> | null = null;

/* ── Public init ─────────────────────────────────────────────────────────── */
export function initProductsPanel(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
}

/* ── Setup ───────────────────────────────────────────────────────────────── */
function setup(): void {
  injectHTML();
  bindEvents();
  watchFloatButtonsVisibility(); // ✅ Unificado y corregido
}

function bindEvents(): void {
  findEl('products-btn')?.addEventListener('click', openPanel);
  
  const overlay = findEl('products-panel-overlay');
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) closePanel();
  });

  findEl('pp-close')?.addEventListener('click', closePanel);

  // Swipe-down to close (handle only)
  let swipeY0 = 0, swipeX0 = 0, swipeActive = false;
  const handle = document.querySelector<HTMLElement>('.pp-handle');
  handle?.addEventListener('touchstart', e => {
    swipeY0 = e.touches[0]!.clientY;
    swipeX0 = e.touches[0]!.clientX;
    swipeActive = true;
  }, { passive: true });

  handle?.addEventListener('touchend', e => {
    if (!swipeActive) return;
    swipeActive = false;
    const dY = e.changedTouches[0]!.clientY - swipeY0;
    const dX = Math.abs(e.changedTouches[0]!.clientX - swipeX0);
    if (dY > 60 && dX < dY * 0.6) closePanel();
  }, { passive: true });

  findEl<HTMLInputElement>('pp-search')?.addEventListener('input', e => {
    if (panelState.searchTimer !== null) clearTimeout(panelState.searchTimer);
    panelState.searchTimer = setTimeout(() => {
      panelState.query = (e.target as HTMLInputElement).value.trim();
      panelState.page  = 1;
      void loadProducts();
    }, 320);
  });

  findEl('pp-prev')?.addEventListener('click', () => {
    if (panelState.page > 1) { panelState.page--; void loadProducts(); }
  });

  findEl('pp-next')?.addEventListener('click', () => {
    if (panelState.page < panelState.pages) { panelState.page++; void loadProducts(); }
  });

  findEl('pp-refresh-btn')?.addEventListener('click', () => void refreshPanel());
  findEl('pp-add-btn')?.addEventListener('click',     () => void openForm(null));
  findEl('pp-form-cancel')?.addEventListener('click', closeForm);
  
  const formOverlay = findEl('pp-form-overlay');
  formOverlay?.addEventListener('click', e => { if (e.target === formOverlay) closeForm(); });

  findEl('pp-form-save')?.addEventListener('click', () => void saveProduct());

  // Edit password popup
  findEl('pp-editpwd-cancel')?.addEventListener('click',  closeEditPasswordPopup);
  findEl('pp-editpwd-confirm')?.addEventListener('click', () => void confirmEditPassword());
  findEl<HTMLInputElement>('pp-editpwd-pin')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') void confirmEditPassword();
  });
  const editPwdOverlay = findEl('pp-editpwd-overlay');
  editPwdOverlay?.addEventListener('click', e => {
    if (e.target === editPwdOverlay) closeEditPasswordPopup();
  });

  // Delete popup
  findEl('pp-delete-cancel')?.addEventListener('click',  closeDeletePopup);
  findEl('pp-delete-confirm')?.addEventListener('click', () => void executeDelete());
  findEl<HTMLInputElement>('pp-delete-pin')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') void executeDelete();
  });

  const deleteOverlay = findEl('pp-delete-overlay');
  deleteOverlay?.addEventListener('click', e => {
    if (e.target === deleteOverlay) closeDeletePopup();
  });

  // History All button (wired here, no global needed)
  findEl('history-all-btn')?.addEventListener('click', async () => {
    const { toggleHistoryAllPanel } = await import('@/components/history/historyAll.ts');
    void toggleHistoryAllPanel();
  });

  findEl('intel-btn')?.addEventListener('click', async () => {
    const { toggleIntelligencePanel } = await import('@/components/intelligence/intelligence.ts');
    void toggleIntelligencePanel();
  });
}

/* ── Observers (UNIFICADO) ───────────────────────────────────────────────── */
function watchFloatButtonsVisibility(): void {
  const container = findEl('sped-float-btns');
  const secSped   = findEl('sec-sped');
  const spedStep1 = findEl('sped-step1');

  if (!container || !secSped || !spedStep1) return;

  const update = () => {
    const isSpedTabActive = secSped.style.display !== 'none' && secSped.style.display !== '';
    const isSearching     = spedStep1.classList.contains('is-searching');
    const isStep1Visible  = spedStep1.style.display !== 'none' && spedStep1.style.display !== '';

    // ✅ Los botones SOLO deben mostrarse si:
    // 1. Estamos en la pestaña SPED
    // 2. La vista step1 está activa (no calc-result/pull-result)
    // 3. NO estamos buscando
    const shouldHide = !isSpedTabActive || isSearching || !isStep1Visible;
    container.classList.toggle('hidden', shouldHide);
  };

  // Observa cambios en la pestaña SPED
  new MutationObserver(update).observe(secSped, { attributes: true, attributeFilter: ['style', 'hidden'] });
  // Observa cambios en step1 (clase is-searching + estilo display)
  new MutationObserver(update).observe(spedStep1, { attributes: true, attributeFilter: ['class', 'style'] });

  // Estado inicial
  update();
}

/* ── Panel open / close ──────────────────────────────────────────────────── */
function openPanel(): void {
  findEl('products-panel-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
  panelState.page  = 1;
  panelState.query = '';
  const search = findEl<HTMLInputElement>('pp-search');
  if (search) search.value = '';
  void loadProducts();
  renderCacheFreshness();
}

function closePanel(): void {
  findEl('products-panel-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
  // Notify SPED so it can return focus to #sped-barcode if in step1
  document.dispatchEvent(new CustomEvent('modal:closed'));
}

/* ── Cache freshness badge ───────────────────────────────────────────────── */
function renderCacheFreshness(): void {
  const el = findEl('pp-cache-freshness');
  if (!el) return;
  const ts = getCacheTimestamp();
  if (!ts) {
    el.textContent          = 'Never updated';
    el.dataset['freshness'] = 'stale';
    return;
  }
  const diffMs  = Date.now() - new Date(ts).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  const diffH   = Math.round(diffMs / 3_600_000);
  let label: string;
  let freshness: 'fresh' | 'aging' | 'stale';
  if (diffMin < 1) {
    label = 'Just updated'; freshness = 'fresh';
  } else if (diffMin < 60) {
    label = `Updated ${diffMin} min ago`; freshness = 'fresh';
  } else if (diffH < 24) {
    label = `Updated ${diffH} h ago`; freshness = 'aging';
  } else {
    const diffDays = Math.round(diffMs / 86_400_000);
    label = `Updated ${diffDays} day${diffDays !== 1 ? 's' : ''} ago`; freshness = 'stale';
  }
  el.textContent          = label;
  el.dataset['freshness'] = freshness;
}

/* ── Products list ───────────────────────────────────────────────────────── */
async function loadProducts(): Promise<void> {
  const listEl     = findEl('pp-list-body');
  const countEl    = findEl('pp-count');
  const pageInfo   = findEl('pp-page-info');
  const prevBtn    = findEl<HTMLButtonElement>('pp-prev');
  const nextBtn    = findEl<HTMLButtonElement>('pp-next');
  const pagination = findEl('pp-pagination');

  if (!listEl) return;
  listEl.innerHTML = `<div class="pp-state"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.22 4.22l2.12 2.12m11.32 11.32 2.12 2.12M2 12h3m14 0h3M4.22 19.78l2.12-2.12M18.66 5.34l-2.12 2.12"/></svg> Loading...</div>`;

  try {
    const data: ProductPage = await apiGetProductsPage(
      panelState.page, 50, panelState.query || undefined,
    );
    panelState.pages = data.pages ?? 1;
    panelState.total = data.total ?? 0;
    panelState.page  = data.page  ?? 1;

    if (countEl) countEl.textContent = `(${panelState.total})`;

    if (!data.products?.length) {
      listEl.innerHTML = `<div class="pp-state"><svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>No products</div>`;
    } else {
      listEl.innerHTML = data.products.map(productRow).join('');
      listEl.querySelectorAll<HTMLButtonElement>('.pp-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => void openForm(btn.dataset['id'] ?? null));
      });
      listEl.querySelectorAll<HTMLButtonElement>('.pp-del-btn').forEach(btn => {
        btn.addEventListener('click', () => confirmDelete(btn.dataset['id'] ?? '', btn.dataset['name'] ?? ''));
      });
      listEl.querySelectorAll<HTMLElement>('.pp-barcode-copy').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          const barcode = el.dataset['barcode'] ?? '';
          if (!barcode) return;
          navigator.clipboard.writeText(barcode).then(() => {
            showToast(`Copied: ${barcode}`, 'success');
          }).catch(() => {
            showToast('Could not copy', 'error');
          });
        });
      });
    }

    if (pagination) pagination.style.display = panelState.pages > 1 ? 'flex' : 'none';
    if (pageInfo)   pageInfo.textContent = `${panelState.page} / ${panelState.pages}`;
    if (prevBtn)    prevBtn.disabled = panelState.page <= 1;
    if (nextBtn)    nextBtn.disabled = panelState.page >= panelState.pages;
  } catch {
    listEl.innerHTML = `<div class="pp-state" style="color:#ff7070"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Error loading products</div>`;
  }
}

function productRow(p: Product): string {
  const valuesText = Array.isArray(p.values) ? p.values.join(', ') : '';
  const skuTag = p.sku   ? `<span class="pp-tag pp-tag-sku">SKU: ${esc(p.sku)}</span>` : '';
  const valTag = valuesText ? `<span class="pp-tag pp-tag-values" title="${esc(valuesText)}">${esc(valuesText)}</span>` : '';
  
  return `<div class="pp-item">
    <div class="pp-item-info">
      <div class="pp-item-name">${esc(p.name)}</div>
      <div class="pp-item-meta">
        <span class="pp-tag pp-tag-id pp-barcode-copy" data-barcode="${esc(p.id)}" title="Tap to copy barcode">📋 ${esc(p.id)}</span>
        ${skuTag}${valTag}
      </div>
    </div>
    <div class="pp-item-actions">
      <button class="pp-action-btn edit pp-edit-btn" data-id="${esc(p.id)}" title="Edit">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="pp-action-btn del pp-del-btn" data-id="${esc(p.id)}" data-name="${esc(p.name)}" title="Delete">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
  </div>`;
}

/* ── Edit password ───────────────────────────────────────────────────────── */
let _pendingEditId: string | null = null;

function openEditPasswordPopup(id: string): void {
  _pendingEditId = id;
  const overlay  = findEl('pp-editpwd-overlay');
  const pinInput = findEl<HTMLInputElement>('pp-editpwd-pin');
  const errorEl  = findEl('pp-editpwd-error');
  if (!overlay) return;
  if (pinInput)  pinInput.value = '';
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  overlay.classList.add('open');
  setTimeout(() => pinInput?.focus(), 200);
}

function closeEditPasswordPopup(): void {
  findEl('pp-editpwd-overlay')?.classList.remove('open');
  _pendingEditId = null;
}

async function confirmEditPassword(): Promise<void> {
  const pinInput = findEl<HTMLInputElement>('pp-editpwd-pin');
  const errorEl  = findEl('pp-editpwd-error');
  const pin = pinInput?.value?.trim() ?? '';
  if (pin !== EDIT_PIN) {
    if (errorEl) { errorEl.textContent = 'Incorrect password'; errorEl.style.display = 'block'; }
    pinInput?.select();
    return;
  }
  const id = _pendingEditId;
  closeEditPasswordPopup();
  if (id) await _doOpenForm(id);
}

/* ── Form ────────────────────────────────────────────────────────────────── */
async function openForm(id: string | null): Promise<void> {
  if (id) { openEditPasswordPopup(id); return; }
  await _doOpenForm(null);
}

async function _doOpenForm(id: string | null): Promise<void> {
  panelState.editingId = id;
  const overlay   = findEl('pp-form-overlay');
  const title     = findEl('pp-form-title');
  const fieldId   = findEl('pp-field-id');
  const inputId   = findEl<HTMLInputElement>('pp-input-id');
  const inputName = findEl<HTMLInputElement>('pp-input-name');
  const inputSku  = findEl<HTMLInputElement>('pp-input-sku');
  const inputVals = findEl<HTMLInputElement>('pp-input-values');
  const saveBtn   = findEl<HTMLButtonElement>('pp-form-save');

  if (!inputId || !inputName || !inputSku || !inputVals || !saveBtn) return;

  inputId.value = inputName.value = inputSku.value = inputVals.value = '';
  saveBtn.disabled = false;

  if (id) {
    if (title) title.textContent = 'Edit product';
    inputId.disabled = true;
    if (fieldId) (fieldId as HTMLElement).style.opacity = '0.5';
    try {
      const p = await apiGetProduct(id);
      if (p) {
        inputId.value   = p.id ?? id;
        inputName.value = p.name ?? '';
        inputSku.value  = p.sku  ?? '';
        inputVals.value = Array.isArray(p.values) ? p.values.join(', ') : '';
      }
    } catch {
      showToast('Error loading product', 'error');
      return;
    }
  } else {
    if (title) title.textContent = 'New product';
    inputId.disabled = false;
    if (fieldId) (fieldId as HTMLElement).style.opacity = '1';
  }

  // Ensure _suppressAutofill() doesn't block typing in dynamically-injected inputs
  [inputId, inputName, inputSku, inputVals].forEach(el => el?.removeAttribute('readonly'));

  overlay?.classList.add('open');
  setTimeout(() => (inputId.disabled ? inputName.focus() : inputId.focus()), 250);
}

function closeForm(): void {
  findEl('pp-form-overlay')?.classList.remove('open');
  panelState.editingId = null;
}

async function saveProduct(): Promise<void> {
  const saveBtn   = findEl<HTMLButtonElement>('pp-form-save');
  const inputId   = findEl<HTMLInputElement>('pp-input-id');
  const inputName = findEl<HTMLInputElement>('pp-input-name');
  const inputSku  = findEl<HTMLInputElement>('pp-input-sku');
  const inputVals = findEl<HTMLInputElement>('pp-input-values');

  if (!saveBtn || !inputId || !inputName || !inputSku || !inputVals) return;

  const id   = inputId.value.trim();
  const name = inputName.value.trim();
  const sku  = inputSku.value.trim();
  const values = transformValuesInput(inputVals.value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  if (!id)   { showToast('ID is required',   'error'); inputId.focus();   return; }
  if (!name) { showToast('Name is required', 'error'); inputName.focus(); return; }

  saveBtn.disabled   = true;
  saveBtn.textContent = 'Saving…';

  try {
    if (panelState.editingId) {
      await apiUpdateProduct(panelState.editingId, {
        name,
        values,
        ...(sku ? { sku } : {}),
      });
    } else {
      await apiCreateProduct({
        id,
        name,
        values,
        ...(sku ? { sku } : {}),
      });
    }
    showToast(panelState.editingId ? 'Product updated' : 'Product created', 'success');
    closeForm();
    void loadProducts();
    void refreshProductCache();
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Connection error', 'error');
    saveBtn.disabled   = false;
    saveBtn.textContent = 'Save';
  }
}

/* ── Refresh ─────────────────────────────────────────────────────────────── */
async function refreshPanel(): Promise<void> {
  const btn = findEl<HTMLButtonElement>('pp-refresh-btn');
  if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
  try { await refreshProductCache(); } catch { /* silent */ }
  await loadProducts();
  if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
  renderCacheFreshness();
  showToast('Products updated', 'success');
}

/* ── Delete ──────────────────────────────────────────────────────────────── */
function confirmDelete(id: string, name: string): void {
  const overlay    = findEl('pp-delete-overlay');
  const titleEl    = findEl('pp-delete-title');
  const pinInput   = findEl<HTMLInputElement>('pp-delete-pin');
  const errorEl    = findEl('pp-delete-error');
  const confirmBtn = findEl<HTMLButtonElement>('pp-delete-confirm');

  if (!overlay) return;
  if (titleEl)    titleEl.textContent  = `Delete "${name}"`;
  if (pinInput)   pinInput.value       = '';
  if (errorEl)  { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  if (confirmBtn) confirmBtn.disabled  = false;

  overlay.classList.add('open');
  overlay.dataset['deleteId']   = id;
  overlay.dataset['deleteName'] = name;
  setTimeout(() => pinInput?.focus(), 200);
}

function closeDeletePopup(): void {
  findEl('pp-delete-overlay')?.classList.remove('open');
  const pinInput = findEl<HTMLInputElement>('pp-delete-pin');
  if (pinInput) pinInput.value = '';
}

async function executeDelete(): Promise<void> {
  const overlay    = findEl('pp-delete-overlay');
  const pinInput   = findEl<HTMLInputElement>('pp-delete-pin');
  const errorEl    = findEl('pp-delete-error');
  const confirmBtn = findEl<HTMLButtonElement>('pp-delete-confirm');

  const pin  = pinInput?.value?.trim()           ?? '';
  const id   = overlay?.dataset['deleteId']   ?? '';

  if (pin !== DELETE_PIN) {
    if (errorEl) { errorEl.textContent = 'Incorrect password'; errorEl.style.display = 'block'; }
    pinInput?.select();
    return;
  }

  if (confirmBtn) confirmBtn.disabled = true;
  closeDeletePopup();

  try {
    await apiDeleteProduct(id);
    showToast('Product deleted', 'success');
    void loadProducts();
    void refreshProductCache();
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Error deleting', 'error');
  }
}

/* ── Toast ───────────────────────────────────────────────────────────────── */
function showToast(msg: string, type: 'success' | 'error' | '' = ''): void {
  const toast = findEl('pp-toast');
  if (!toast) return;
  if (_toastTimer !== null) clearTimeout(_toastTimer);
  toast.textContent = msg;
  toast.className   = `show ${type}`;
  _toastTimer = setTimeout(() => { toast.className = ''; }, 2_500);
}

/* ── HTML injection ──────────────────────────────────────────────────────── */
function injectHTML(): void {
  if (findEl('products-panel-overlay')) return; // already injected
  document.body.insertAdjacentHTML('beforeend', `
    <div id="sped-float-btns" class="hidden">
      <button id="products-btn" aria-label="View product catalog">
        <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        Products
      </button>
      <button id="history-all-btn" aria-label="View full cloud history">☁️ History All</button>
      <button id="intel-btn" aria-label="Product predictions">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        AI
      </button>
    </div>
    <div id="products-panel-overlay" role="dialog" aria-modal="true" aria-label="Product catalog">
      <div id="products-panel">
        <div class="pp-handle"><span></span></div>
        <div class="pp-header">
          <span class="pp-title">Products <span class="pp-count" id="pp-count"></span></span>
          <div class="pp-header-actions">
            <button class="pp-btn-icon pp-btn-refresh" id="pp-refresh-btn" aria-label="Update products">
              <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              Refresh
            </button>
            <button class="pp-btn-icon pp-btn-add" id="pp-add-btn" aria-label="Add product">
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add
            </button>
            <button class="pp-btn-icon pp-btn-close" id="pp-close" aria-label="Close">
              <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Close
            </button>
          </div>
        </div>
        <div class="pp-cache-freshness-bar"><span id="pp-cache-freshness" class="pp-cache-freshness" data-freshness="stale">—</span></div>
        <div class="pp-search-bar">
          <div class="pp-search-wrap">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="pp-search" type="search" placeholder="Search by name, ID or SKU..." autocomplete="off">
          </div>
        </div>
        <div class="pp-list" id="pp-list-body"><div class="pp-state">Opening…</div></div>
        <div class="pp-pagination" id="pp-pagination" style="display:none">
          <button class="pp-page-btn" id="pp-prev" disabled><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
          <span class="pp-page-info" id="pp-page-info">1 / 1</span>
          <button class="pp-page-btn" id="pp-next" disabled><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>
        </div>
      </div>
    </div>

    <div id="pp-form-overlay">
      <div id="pp-form-modal">
        <p class="pp-form-title" id="pp-form-title">New product</p>
        <div class="pp-field" id="pp-field-id">
          <label class="pp-label" for="pp-input-id">ID / Barcode</label>
          <input class="pp-input" id="pp-input-id" type="text" placeholder="5091234567890" autocomplete="off">
        </div>
        <div class="pp-field">
          <label class="pp-label" for="pp-input-name">Name</label>
          <input class="pp-input" id="pp-input-name" type="text" placeholder="Chicken Cajun Panini" autocomplete="off">
        </div>
        <div class="pp-field">
          <label class="pp-label" for="pp-input-sku">SKU <span style="opacity:0.5">(optional)</span></label>
          <input class="pp-input" id="pp-input-sku" type="text" placeholder="8194" autocomplete="off">
        </div>
        <div class="pp-field">
          <label class="pp-label" for="pp-input-values">Values <span style="opacity:0.5">(Separated by comma)</span></label>
          <input class="pp-input" id="pp-input-values" type="text" placeholder="9*6, 9*7, 9*8" autocomplete="off">
          <p class="pp-input-hint">e.g.: 9*6, 9*7  →  saved as ["9*6", "9*7"]</p>
        </div>
        <div class="pp-form-actions">
          <button class="pp-btn-cancel" id="pp-form-cancel">Cancel</button>
          <button class="pp-btn-save"   id="pp-form-save">Save</button>
        </div>
      </div>
    </div>

    <div id="pp-delete-overlay">
      <div id="pp-delete-modal">
        <p class="pp-delete-modal-title" id="pp-delete-title">Delete product</p>
        <p class="pp-delete-modal-sub">Enter the password to confirm</p>
        <input id="pp-delete-pin" class="pp-input pp-delete-pin-input"
              type="password" inputmode="numeric" maxlength="6"
              placeholder="••••" autocomplete="new-password">
        <p class="pp-delete-error" id="pp-delete-error" style="display:none"></p>
        <div class="pp-form-actions" style="margin-top:1rem">
          <button class="pp-btn-cancel"                    id="pp-delete-cancel">Cancel</button>
          <button class="pp-btn-save pp-btn-delete-confirm" id="pp-delete-confirm">Delete</button>
        </div>
      </div>
    </div>

    <div id="pp-editpwd-overlay">
      <div id="pp-editpwd-modal">
        <p class="pp-delete-modal-title">Edit product</p>
        <p class="pp-delete-modal-sub">Enter the password to edit</p>
        <input id="pp-editpwd-pin" class="pp-input pp-delete-pin-input"
              type="password" inputmode="numeric" maxlength="6"
              placeholder="••••" autocomplete="new-password">
        <p class="pp-delete-error" id="pp-editpwd-error" style="display:none"></p>
        <div class="pp-form-actions" style="margin-top:1rem">
          <button class="pp-btn-cancel" id="pp-editpwd-cancel">Cancel</button>
          <button class="pp-btn-save"   id="pp-editpwd-confirm">Continue</button>
        </div>
      </div>
    </div>
  `);
}