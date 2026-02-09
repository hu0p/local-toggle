import { DEFAULT_LOCAL_TLD, HTTPS, HTTP } from './lib/constants.js';
import { extractTld, getDomainBase, buildSwappedUrl, isRestrictedBrowserPage } from './lib/domain.js';
import { getDomainSettings, saveDomainSettings, removeDomainSettings, getAllDomainConfigs } from './lib/storage.js';

document.querySelectorAll('[data-i18n]').forEach((el) => {
  el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
});

const stripLeadingDot = (value) => value.replace(/^\.+/, '');

const i18n = (key) => chrome.i18n.getMessage(key);

const resizeInput = (input) => {
  const length = Math.max(input.value.length, input.placeholder.length, 3);
  input.style.width = `${length}ch`;
};

const showFormError = (message, targetRow, errorEl) => {
  errorEl.textContent = message;
  errorEl.classList.add('visible');
  targetRow.classList.add('error');

  document.body.classList.remove('shake');
  requestAnimationFrame(() => {
    document.body.classList.add('shake');
  });
};

const clearFormError = (rows, errorEl) => {
  errorEl.classList.remove('visible');
  rows.forEach((row) => row.classList.remove('error'));
};

const buildUrlPreview = (domainBase, settings) => {
  const prodProto = settings.prodProtocol === HTTPS ? 'https' : 'http';
  const localProto = settings.localProtocol === HTTPS ? 'https' : 'http';
  const prodTld = settings.prodTld.replace(/^\./, '');
  const localTld = settings.localTld.replace(/^\./, '');
  return `${prodProto}://${domainBase}.${prodTld} \u2194 ${localProto}://${domainBase}.${localTld}`;
};

// --- Mutable state read by event handlers ---

const state = {
  activeTab: null,
  domainBase: null,
  isOnLocal: false,
  editingDomainBase: null,
};

// --- DOM references (scripts are at bottom of body, DOM is parsed) ---

const loadingEl = document.querySelector('#loading');
const restrictedEl = document.querySelector('#restricted');
const panelContentEl = document.querySelector('#panel-content');
const tldInput = document.querySelector('#tld');
const localTldInput = document.querySelector('#local-tld');
const submitButton = document.querySelector('#submit');
const inputRow = document.querySelector('#prod-input-row');
const localInputRow = document.querySelector('#local-input-row');
const errorMessage = document.querySelector('#error');
const productionTlsCheckbox = document.querySelector('#tls-production');
const localTlsCheckbox = document.querySelector('#tls-local');
const prodDomain = document.querySelector('#prod-domain');
const localDomain = document.querySelector('#local-domain');
const buttonLabel = document.querySelector('#button-label');
const domainListEl = document.querySelector('#domain-list');
const emptyStateEl = document.querySelector('#empty-state');
const editSection = document.querySelector('#edit-section');
const editHeading = document.querySelector('#edit-heading');
const editCloseBtn = document.querySelector('#edit-close');
const editTldInput = document.querySelector('#edit-tld');
const editLocalTldInput = document.querySelector('#edit-local-tld');
const editProdInputRow = document.querySelector('#edit-prod-input-row');
const editLocalInputRow = document.querySelector('#edit-local-input-row');
const editErrorMessage = document.querySelector('#edit-error');
const editProdTlsCheckbox = document.querySelector('#edit-tls-production');
const editLocalTlsCheckbox = document.querySelector('#edit-tls-local');
const editProdDomain = document.querySelector('#edit-prod-domain');
const editLocalDomain = document.querySelector('#edit-local-domain');
const editSaveBtn = document.querySelector('#edit-save');
const editDeleteBtn = document.querySelector('#edit-delete');

// --- View state helpers ---

const showView = (view) => {
  loadingEl.style.display = view === 'loading' ? 'flex' : 'none';
  restrictedEl.style.display = view === 'restricted' ? 'flex' : 'none';
  panelContentEl.style.display = view === 'content' ? 'block' : 'none';
};

const closeEditForm = () => {
  editSection.style.display = 'none';
  state.editingDomainBase = null;

  document.querySelectorAll('.domain-item.editing').forEach((el) => {
    el.classList.remove('editing');
  });

  clearFormError([editProdInputRow, editLocalInputRow], editErrorMessage);
};

const openEditForm = async (targetDomainBase) => {
  const freshSettings = await getDomainSettings(targetDomainBase);
  if (!freshSettings) return;

  closeEditForm();
  state.editingDomainBase = targetDomainBase;

  const listItem = domainListEl.querySelector(`[data-domain="${CSS.escape(targetDomainBase)}"]`);
  if (listItem) {
    listItem.classList.add('editing');
  }

  editHeading.textContent = targetDomainBase;
  editProdDomain.textContent = `://${targetDomainBase}.`;
  editLocalDomain.textContent = `://${targetDomainBase}.`;

  editTldInput.value = freshSettings.prodTld.replace(/^\./, '');
  editLocalTldInput.value = freshSettings.localTld.replace(/^\./, '');
  editProdTlsCheckbox.checked = freshSettings.prodProtocol === HTTPS;
  editLocalTlsCheckbox.checked = freshSettings.localProtocol === HTTPS;

  resizeInput(editTldInput);
  resizeInput(editLocalTldInput);

  editSection.style.display = 'block';
  editSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

const renderDomainList = (configs) => {
  domainListEl.innerHTML = '';

  if (configs.length === 0) {
    emptyStateEl.style.display = 'block';
    return;
  }

  emptyStateEl.style.display = 'none';

  configs.forEach((config) => {
    const li = document.createElement('li');
    li.className = 'domain-item';
    li.dataset.domain = config.domainBase;

    const urlSpan = document.createElement('span');
    urlSpan.className = 'domain-item-url';
    const preview = buildUrlPreview(config.domainBase, config.settings);
    urlSpan.textContent = preview;
    urlSpan.title = preview;

    const goBtn = document.createElement('button');
    goBtn.className = 'icon-button';
    goBtn.type = 'button';
    goBtn.setAttribute('aria-label', i18n('buttonGoToDomain'));
    goBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>';
    goBtn.addEventListener('click', () => {
      const url = `${config.settings.prodProtocol}//${config.domainBase}${config.settings.prodTld}`;
      chrome.tabs.update(state.activeTab.id, { url });
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-button';
    editBtn.type = 'button';
    editBtn.setAttribute('aria-label', i18n('buttonEdit'));
    editBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    editBtn.addEventListener('click', () => openEditForm(config.domainBase));

    li.append(urlSpan, goBtn, editBtn);
    domainListEl.append(li);
  });
};

// --- Load and render (called on init + tab changes) ---

let renderGeneration = 0;

const loadAndRender = async (initial = false) => {
  const generation = ++renderGeneration;

  if (initial) {
    showView('loading');
  }

  closeEditForm();

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (generation !== renderGeneration) return;

  state.activeTab = activeTab;

  if (!activeTab?.url || isRestrictedBrowserPage(activeTab.url)) {
    showView('restricted');
    return;
  }

  const activeUrl = new URL(activeTab.url);
  const { hostname } = activeUrl;
  const currentTld = extractTld(hostname);

  if (!currentTld) {
    showView('restricted');
    return;
  }

  state.domainBase = getDomainBase(hostname, currentTld);

  const settings = await getDomainSettings(state.domainBase);
  if (generation !== renderGeneration) return;

  showView('content');

  const savedProdTld = settings?.prodTld;
  const savedProtocol = settings?.prodProtocol;
  const savedLocalProtocol = settings?.localProtocol;
  const savedLocalTld = settings?.localTld ?? DEFAULT_LOCAL_TLD;
  state.isOnLocal = currentTld === savedLocalTld;

  const prefillProdTld = state.isOnLocal ? savedProdTld : currentTld;
  const prefillLocalTld = state.isOnLocal ? currentTld : savedLocalTld;
  const prefillProdProtocol = state.isOnLocal ? (savedProtocol ?? HTTPS) : activeUrl.protocol;
  const prefillLocalProtocol = savedLocalProtocol ?? (state.isOnLocal ? activeUrl.protocol : HTTP);

  prodDomain.textContent = `://${state.domainBase}.`;
  localDomain.textContent = `://${state.domainBase}.`;
  buttonLabel.textContent = state.isOnLocal ? i18n('buttonGoToProduction') : i18n('buttonGoToLocal');

  tldInput.value = prefillProdTld ? prefillProdTld.replace(/^\./, '') : '';
  localTldInput.value = prefillLocalTld.replace(/^\./, '');
  productionTlsCheckbox.checked = prefillProdProtocol === HTTPS;
  localTlsCheckbox.checked = prefillLocalProtocol === HTTPS;

  clearFormError([inputRow, localInputRow], errorMessage);
  resizeInput(tldInput);
  resizeInput(localTldInput);

  if (initial) {
    tldInput.focus();
  }

  domainListEl.innerHTML = '';
  emptyStateEl.style.display = 'none';

  getAllDomainConfigs().then((allConfigs) => {
    if (generation !== renderGeneration) return;
    const otherConfigs = allConfigs.filter(
      (config) => config.domainBase !== state.domainBase
    );
    renderDomainList(otherConfigs);
  });
};

// --- Current domain form handlers (wired once) ---

tldInput.addEventListener('input', (event) => {
  clearFormError([inputRow, localInputRow], errorMessage);
  resizeInput(event.target);
});

localTldInput.addEventListener('input', (event) => {
  clearFormError([inputRow, localInputRow], errorMessage);
  resizeInput(event.target);
});

const handleSubmit = async () => {
  const rawProdTld = tldInput.value.trim();
  const rawLocalTld = localTldInput.value.trim();
  const prodTld = stripLeadingDot(rawProdTld);
  const localTld = stripLeadingDot(rawLocalTld);

  if (!prodTld) {
    showFormError(i18n('errorProdTldRequired'), inputRow, errorMessage);
    return;
  }

  if (!localTld) {
    showFormError(i18n('errorLocalTldRequired'), localInputRow, errorMessage);
    return;
  }

  const newProdTld = `.${prodTld}`;
  const newLocalTld = `.${localTld}`;

  if (newProdTld === newLocalTld) {
    showFormError(i18n('errorTldsMustDiffer'), localInputRow, errorMessage);
    return;
  }

  const productionProtocol = productionTlsCheckbox.checked ? HTTPS : HTTP;
  const localProtocol = localTlsCheckbox.checked ? HTTPS : HTTP;

  const { domainBase, isOnLocal, activeTab } = state;
  const targetTld = isOnLocal ? newProdTld : newLocalTld;
  const targetProtocol = isOnLocal ? productionProtocol : localProtocol;
  const newUrl = buildSwappedUrl(activeTab.url, domainBase, targetTld, targetProtocol);

  await Promise.all([
    saveDomainSettings(domainBase, {
      prodTld: newProdTld,
      localTld: newLocalTld,
      prodProtocol: productionProtocol,
      localProtocol,
    }),
    chrome.tabs.update(activeTab.id, { url: newUrl }),
  ]);
};

submitButton.addEventListener('click', handleSubmit);

tldInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSubmit();
});

localTldInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSubmit();
});

// --- Edit form handlers (wired once) ---

editTldInput.addEventListener('input', (event) => {
  clearFormError([editProdInputRow, editLocalInputRow], editErrorMessage);
  resizeInput(event.target);
});

editLocalTldInput.addEventListener('input', (event) => {
  clearFormError([editProdInputRow, editLocalInputRow], editErrorMessage);
  resizeInput(event.target);
});

editCloseBtn.addEventListener('click', closeEditForm);

editSaveBtn.addEventListener('click', async () => {
  const rawProdTld = editTldInput.value.trim();
  const rawLocalTld = editLocalTldInput.value.trim();
  const prodTld = stripLeadingDot(rawProdTld);
  const localTld = stripLeadingDot(rawLocalTld);

  if (!prodTld) {
    showFormError(i18n('errorProdTldRequired'), editProdInputRow, editErrorMessage);
    return;
  }

  if (!localTld) {
    showFormError(i18n('errorLocalTldRequired'), editLocalInputRow, editErrorMessage);
    return;
  }

  const newProdTld = `.${prodTld}`;
  const newLocalTld = `.${localTld}`;

  if (newProdTld === newLocalTld) {
    showFormError(i18n('errorTldsMustDiffer'), editLocalInputRow, editErrorMessage);
    return;
  }

  const productionProtocol = editProdTlsCheckbox.checked ? HTTPS : HTTP;
  const localProtocol = editLocalTlsCheckbox.checked ? HTTPS : HTTP;

  const updatedSettings = {
    prodTld: newProdTld,
    localTld: newLocalTld,
    prodProtocol: productionProtocol,
    localProtocol,
  };

  await saveDomainSettings(state.editingDomainBase, updatedSettings);

  const listItem = domainListEl.querySelector(`[data-domain="${CSS.escape(state.editingDomainBase)}"]`);
  if (listItem) {
    const urlSpan = listItem.querySelector('.domain-item-url');
    const preview = buildUrlPreview(state.editingDomainBase, updatedSettings);
    urlSpan.textContent = preview;
    urlSpan.title = preview;
  }

  closeEditForm();
});

editDeleteBtn.addEventListener('click', async () => {
  await removeDomainSettings(state.editingDomainBase);

  const listItem = domainListEl.querySelector(`[data-domain="${CSS.escape(state.editingDomainBase)}"]`);
  if (listItem) {
    listItem.remove();
  }

  closeEditForm();

  if (domainListEl.children.length === 0) {
    emptyStateEl.style.display = 'block';
  }
});

editTldInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') editSaveBtn.click();
});

editLocalTldInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') editSaveBtn.click();
});

// --- React to tab changes ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && tabId === state.activeTab?.id) {
    loadAndRender();
  }
});

chrome.tabs.onActivated.addListener(() => {
  loadAndRender();
});

// --- Initial load ---

loadAndRender(true);
