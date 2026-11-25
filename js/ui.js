// =========================================================================
// UI: diálogos, avisos (toasts) e "Desfazer"
// Substitui prompt() / confirm() / alert() do navegador por janelas do app.
// Carregado ANTES do app.js.
// =========================================================================

(function () {
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function ensureRoots() {
    if (!document.getElementById('uiToastStack')) {
      const stack = document.createElement('div');
      stack.id = 'uiToastStack';
      stack.className = 'ui-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    if (!document.getElementById('uiDialog')) {
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="modal fade" id="uiDialog" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
          <div class="modal-dialog modal-dialog-centered" style="max-width:440px;">
            <form class="modal-content nexus-card" id="uiDialogForm" novalidate>
              <div class="modal-header">
                <h5 class="modal-title fw-semibold" id="uiDialogTitle"></h5>
                <button type="button" class="btn-close btn-close-white" data-ui-cancel aria-label="Fechar"></button>
              </div>
              <div class="modal-body">
                <p class="mb-3 text-secondary" id="uiDialogMsg"></p>
                <div id="uiDialogFields" class="d-flex flex-column gap-3"></div>
                <div class="text-danger small mt-2 d-none" id="uiDialogError"></div>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-outline-nexus" data-ui-cancel id="uiDialogCancel">Cancelar</button>
                <button type="submit" class="btn btn-nexus px-4" id="uiDialogOk">OK</button>
              </div>
            </form>
          </div>
        </div>`;
      document.body.appendChild(wrap.firstElementChild);
    }
  }

  // ---------- Toasts ----------
  function uiToast(message, opts = {}) {
    ensureRoots();
    const { type = 'info', actionLabel, onAction, timeout = actionLabel ? 6000 : 3200 } = opts;
    const icons = { info: 'bi-info-circle', success: 'bi-check-circle', warning: 'bi-exclamation-triangle', error: 'bi-x-circle' };
    const el = document.createElement('div');
    el.className = `ui-toast ui-toast-${type}`;
    el.innerHTML = `
      <i class="bi ${icons[type] || icons.info}"></i>
      <span class="ui-toast-msg">${esc(message)}</span>
      ${actionLabel ? `<button type="button" class="ui-toast-action">${esc(actionLabel)}</button>` : ''}
      <button type="button" class="ui-toast-close" aria-label="Fechar"><i class="bi bi-x"></i></button>`;
    const stack = document.getElementById('uiToastStack');
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    };
    el.querySelector('.ui-toast-close').onclick = close;
    if (actionLabel) {
      el.querySelector('.ui-toast-action').onclick = () => { close(); onAction && onAction(); };
    }
    if (timeout > 0) setTimeout(close, timeout);
    return close;
  }

  // ---------- Diálogo genérico ----------
  let dialogQueue = Promise.resolve();

  function uiDialog(config) {
    // Enfileira para nunca abrir dois diálogos ao mesmo tempo
    const run = () => new Promise((resolve) => {
      ensureRoots();
      const modalEl = document.getElementById('uiDialog');
      const form = document.getElementById('uiDialogForm');
      const fieldsEl = document.getElementById('uiDialogFields');
      const errEl = document.getElementById('uiDialogError');
      const okBtn = document.getElementById('uiDialogOk');
      const cancelBtn = document.getElementById('uiDialogCancel');

      document.getElementById('uiDialogTitle').textContent = config.title || '';
      const msgEl = document.getElementById('uiDialogMsg');
      msgEl.textContent = config.message || '';
      msgEl.classList.toggle('d-none', !config.message);
      errEl.classList.add('d-none');

      okBtn.textContent = config.okLabel || 'OK';
      okBtn.className = `btn px-4 ${config.danger ? 'btn-danger' : 'btn-nexus'}`;
      cancelBtn.classList.toggle('d-none', config.hideCancel === true);
      cancelBtn.textContent = config.cancelLabel || 'Cancelar';
      const headerClose = modalEl.querySelector('.modal-header .btn-close');
      if (headerClose) headerClose.classList.toggle('d-none', config.noClose === true);
      const msgText = document.getElementById('uiDialogMsg');
      msgText.style.whiteSpace = 'pre-line';

      const fields = config.fields || [];
      fieldsEl.innerHTML = fields.map((f, i) => {
        const id = `uiField_${i}`;
        const label = f.label ? `<label class="form-label small mb-1" for="${id}">${esc(f.label)}</label>` : '';
        const hint = f.hint ? `<small class="text-secondary d-block mt-1">${esc(f.hint)}</small>` : '';
        if (f.type === 'select') {
          const opts = (f.options || []).map(o =>
            `<option value="${esc(o.value)}" ${String(o.value) === String(f.value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
          return `<div>${label}<select id="${id}" name="${esc(f.name)}" class="form-select">${opts}</select>${hint}</div>`;
        }
        if (f.type === 'textarea') {
          return `<div>${label}<textarea id="${id}" name="${esc(f.name)}" class="form-control" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>${hint}</div>`;
        }
        const attrs = [
          f.min !== undefined ? `min="${f.min}"` : '',
          f.max !== undefined ? `max="${f.max}"` : '',
          f.step !== undefined ? `step="${f.step}"` : '',
          f.required ? 'required' : ''
        ].join(' ');
        return `<div>${label}<input id="${id}" name="${esc(f.name)}" type="${f.type || 'text'}" class="form-control"
                  value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" ${attrs} autocomplete="off">${hint}</div>`;
      }).join('');

      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      let result = null;

      const readValues = () => {
        const out = {};
        fields.forEach((f, i) => { out[f.name] = document.getElementById(`uiField_${i}`).value; });
        return out;
      };

      form.onsubmit = (e) => {
        e.preventDefault();
        const values = readValues();
        if (config.validate) {
          const msg = config.validate(values);
          if (msg) {
            errEl.textContent = msg;
            errEl.classList.remove('d-none');
            return;
          }
        }
        result = { ok: true, values };
        modal.hide();
      };
      modalEl.querySelectorAll('[data-ui-cancel]').forEach(b => { b.onclick = () => { result = { ok: false }; modal.hide(); }; });

      modalEl.addEventListener('shown.bs.modal', () => {
        const first = fieldsEl.querySelector('input, select, textarea');
        (first || okBtn).focus();
        if (first && first.select) first.select();
      }, { once: true });
      modalEl.addEventListener('hidden.bs.modal', () => resolve(result || { ok: false }), { once: true });
      modal.show();
    });

    const p = dialogQueue.then(run, run);
    dialogQueue = p.catch(() => {});
    return p;
  }

  async function uiConfirm(message, opts = {}) {
    const r = await uiDialog({ title: opts.title || 'Confirmar', message, okLabel: opts.okLabel || 'Confirmar', cancelLabel: opts.cancelLabel, danger: opts.danger, noClose: opts.noClose });
    return r.ok;
  }

  async function uiPrompt(message, opts = {}) {
    const r = await uiDialog({
      title: opts.title || '',
      message,
      okLabel: opts.okLabel || 'Salvar',
      fields: [{ name: 'v', type: opts.type || 'text', value: opts.value, min: opts.min, max: opts.max, step: opts.step, placeholder: opts.placeholder, hint: opts.hint }],
      validate: opts.validate ? (vals) => opts.validate(vals.v) : undefined
    });
    return r.ok ? r.values.v : null;
  }

  async function uiForm(config) {
    const r = await uiDialog(config);
    return r.ok ? r.values : null;
  }

  function uiAlert(message, type = 'info') {
    uiToast(message, { type });
  }

  window.uiToast = uiToast;
  window.uiDialog = uiDialog;
  window.uiConfirm = uiConfirm;
  window.uiPrompt = uiPrompt;
  window.uiForm = uiForm;
  window.uiAlert = uiAlert;
})();
