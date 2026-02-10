import { DEFAULT_LOCAL_TLD, HTTPS, HTTP } from './lib/constants.js';
import { extractTld, getDomainBase, buildSwappedUrl, isRestrictedBrowserPage } from './lib/domain.js';
import { getDomainSettings, saveDomainSettings, removeDomainSettings, getAllDomainConfigs, getAppConfig, saveAppConfig } from './lib/storage.js';

document.querySelectorAll('[data-i18n]').forEach((el) => {
  el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
});

document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
  el.setAttribute('aria-label', chrome.i18n.getMessage(el.dataset.i18nAria));
});

const stripLeadingDot = (value) => value.replace(/^\.+/, '');

const DOMAIN_TAIL_LENGTH = 8;

const renderDomain = (el, domainBase, { prefix = '://', suffix = '.' } = {}) => {
  el.textContent = '';
  el.title = `${prefix}${domainBase}${suffix}`;

  if (domainBase.length <= DOMAIN_TAIL_LENGTH * 2) {
    el.textContent = `${prefix}${domainBase}${suffix}`;
    return;
  }

  const prefixEl = document.createElement('span');
  prefixEl.className = 'domain-affix';
  prefixEl.textContent = prefix;

  const startEl = document.createElement('span');
  startEl.className = 'domain-truncate-start';
  startEl.textContent = domainBase.slice(0, -DOMAIN_TAIL_LENGTH);

  const endEl = document.createElement('span');
  endEl.className = 'domain-truncate-end';
  endEl.textContent = domainBase.slice(-DOMAIN_TAIL_LENGTH);

  const suffixEl = document.createElement('span');
  suffixEl.className = 'domain-affix';
  suffixEl.textContent = suffix;

  el.append(prefixEl, startEl, endEl, suffixEl);
};

const i18n = (key) => chrome.i18n.getMessage(key);

const resizeInput = (input) => {
  const length = Math.max(input.value.length, input.placeholder.length, 3);
  input.style.width = `${length}ch`;
};

const syncTlsLabel = (checkbox) => {
  const label = checkbox.parentElement.querySelector('.tls-label');
  if (label) label.textContent = checkbox.checked ? 'https' : 'http';
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
  const prodHost = settings.prodHostname ?? domainBase;
  const localHost = settings.localHostname ?? domainBase;
  const prodTld = settings.prodTld.replace(/^\./, '');
  const localTld = settings.localTld.replace(/^\./, '');
  return `${prodHost}.${prodTld} \u2194 ${localHost}.${localTld}`;
};

const buildListSide = (domainBase, tld) => {
  const side = document.createElement('span');
  side.className = 'domain-item-side';

  const tldEl = document.createElement('span');
  tldEl.className = 'domain-item-tld';
  tldEl.textContent = tld;

  if (domainBase.length <= DOMAIN_TAIL_LENGTH * 2) {
    const nameEl = document.createElement('span');
    nameEl.className = 'domain-item-name';
    nameEl.textContent = domainBase;
    side.append(nameEl, tldEl);
    return side;
  }

  const startEl = document.createElement('span');
  startEl.className = 'domain-truncate-start';
  startEl.textContent = domainBase.slice(0, -DOMAIN_TAIL_LENGTH);

  const endEl = document.createElement('span');
  endEl.className = 'domain-truncate-end';
  endEl.textContent = domainBase.slice(-DOMAIN_TAIL_LENGTH);

  side.append(startEl, endEl, tldEl);
  return side;
};

const renderUrlPreview = (container, domainBase, settings) => {
  container.textContent = '';
  container.title = buildUrlPreview(domainBase, settings);

  const prodHost = settings.prodHostname ?? domainBase;
  const localHost = settings.localHostname ?? domainBase;

  const arrow = document.createElement('span');
  arrow.className = 'domain-item-arrow';
  arrow.textContent = '\u2194';

  container.append(
    buildListSide(prodHost, settings.prodTld),
    arrow,
    buildListSide(localHost, settings.localTld),
  );
};

// --- Mutable state read by event handlers ---

const state = {
  activeTab: null,
  domainBase: null,
  isOnLocal: false,
  editingDomainBase: null,
  editingProdTld: null,
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
const navigateCheckbox = document.querySelector('#navigate-on-save');
const closeCheckbox = document.querySelector('#close-on-save');
const prodLabel = document.querySelector('.field-label[for="tld"]');
const localLabel = document.querySelector('.field-label[for="local-tld"]');
const prodHostnameInput = document.querySelector('#prod-hostname');
const localHostnameInput = document.querySelector('#local-hostname');
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
const editProdHostnameInput = document.querySelector('#edit-prod-hostname');
const editLocalHostnameInput = document.querySelector('#edit-local-hostname');
const editSaveBtn = document.querySelector('#edit-save');
const editDeleteBtn = document.querySelector('#edit-delete');

const prodBadge = document.createElement('span');
prodBadge.className = 'active-badge';
prodBadge.dataset.env = 'prod';
prodBadge.textContent = i18n('badgeActive');
prodLabel.append(prodBadge);

const localBadge = document.createElement('span');
localBadge.className = 'active-badge';
localBadge.dataset.env = 'local';
localBadge.textContent = i18n('badgeActive');
localLabel.append(localBadge);

// --- View state helpers ---

const showView = (view) => {
  loadingEl.style.display = view === 'loading' ? 'flex' : 'none';
  restrictedEl.style.display = view === 'restricted' ? 'flex' : 'none';
  panelContentEl.style.display = view === 'content' ? 'flex' : 'none';
};

const closeEditForm = () => {
  editSection.style.display = 'none';
  state.editingDomainBase = null;
  state.editingProdTld = null;

  const wrapper = editSection.parentElement;
  if (wrapper?.classList.contains('edit-wrapper')) {
    panelContentEl.append(editSection);
    wrapper.remove();
  }

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
  state.editingProdTld = freshSettings.prodTld;

  const fullDomain = `${targetDomainBase}${freshSettings.prodTld}`;
  const listItem = domainListEl.querySelector(`[data-domain="${CSS.escape(fullDomain)}"]`);
  if (listItem) {
    listItem.classList.add('editing');
    const wrapper = document.createElement('li');
    wrapper.className = 'edit-wrapper';
    listItem.after(wrapper);
    wrapper.append(editSection);
  }

  renderDomain(editHeading, targetDomainBase, { prefix: '', suffix: freshSettings.prodTld });

  editProdHostnameInput.value = freshSettings.prodHostname ?? targetDomainBase;
  editLocalHostnameInput.value = freshSettings.localHostname ?? targetDomainBase;
  resizeInput(editProdHostnameInput);
  resizeInput(editLocalHostnameInput);

  editTldInput.value = freshSettings.prodTld.replace(/^\./, '');
  editLocalTldInput.value = freshSettings.localTld.replace(/^\./, '');
  editProdTlsCheckbox.checked = freshSettings.prodProtocol === HTTPS;
  editLocalTlsCheckbox.checked = freshSettings.localProtocol === HTTPS;
  syncTlsLabel(editProdTlsCheckbox);
  syncTlsLabel(editLocalTlsCheckbox);

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
    li.dataset.domain = `${config.domainBase}${config.settings.prodTld}`;

    const urlSpan = document.createElement('span');
    urlSpan.className = 'domain-item-url';
    renderUrlPreview(urlSpan, config.domainBase, config.settings);

    const goBtn = document.createElement('button');
    goBtn.className = 'icon-button';
    goBtn.type = 'button';
    goBtn.setAttribute('aria-label', i18n('buttonGoToDomain'));
    goBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>';
    goBtn.addEventListener('click', () => {
      const prodHost = config.settings.prodHostname ?? config.domainBase;
      const url = `${config.settings.prodProtocol}//${prodHost}${config.settings.prodTld}`;
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

  prodBadge.style.visibility = state.isOnLocal ? 'hidden' : 'visible';
  localBadge.style.visibility = state.isOnLocal ? 'visible' : 'hidden';

  const prefillProdTld = state.isOnLocal ? savedProdTld : currentTld;
  const prefillLocalTld = state.isOnLocal ? currentTld : savedLocalTld;
  const prefillProdProtocol = state.isOnLocal ? (savedProtocol ?? HTTPS) : activeUrl.protocol;
  const prefillLocalProtocol = savedLocalProtocol ?? (state.isOnLocal ? activeUrl.protocol : HTTP);

  const prodHostname = settings?.prodHostname ?? state.domainBase;
  const localHostname = settings?.localHostname ?? state.domainBase;
  prodHostnameInput.value = prodHostname;
  localHostnameInput.value = localHostname;
  resizeInput(prodHostnameInput);
  resizeInput(localHostnameInput);

  const appConfig = await getAppConfig();
  if (generation !== renderGeneration) return;
  navigateCheckbox.checked = appConfig.navigateOnSave !== false;
  closeCheckbox.checked = appConfig.closeOnSave === true;

  tldInput.value = prefillProdTld ? prefillProdTld.replace(/^\./, '') : '';
  localTldInput.value = prefillLocalTld.replace(/^\./, '');
  productionTlsCheckbox.checked = prefillProdProtocol === HTTPS;
  localTlsCheckbox.checked = prefillLocalProtocol === HTTPS;
  syncTlsLabel(productionTlsCheckbox);
  syncTlsLabel(localTlsCheckbox);

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

productionTlsCheckbox.addEventListener('change', () => syncTlsLabel(productionTlsCheckbox));
localTlsCheckbox.addEventListener('change', () => syncTlsLabel(localTlsCheckbox));

prodHostnameInput.addEventListener('input', (event) => {
  clearFormError([inputRow, localInputRow], errorMessage);
  resizeInput(event.target);
});

localHostnameInput.addEventListener('input', (event) => {
  clearFormError([inputRow, localInputRow], errorMessage);
  resizeInput(event.target);
});

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
  const prodHostname = prodHostnameInput.value.trim();
  const localHostname = localHostnameInput.value.trim();

  if (!prodHostname) {
    showFormError(i18n('errorHostnameRequired'), inputRow, errorMessage);
    return;
  }

  if (!localHostname) {
    showFormError(i18n('errorHostnameRequired'), localInputRow, errorMessage);
    return;
  }

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
  const navigateOnSave = navigateCheckbox.checked;
  const closeOnSave = closeCheckbox.checked;

  const { domainBase, isOnLocal, activeTab } = state;

  const settings = {
    prodTld: newProdTld,
    localTld: newLocalTld,
    prodProtocol: productionProtocol,
    localProtocol,
  };

  if (prodHostname !== localHostname) {
    settings.prodHostname = prodHostname;
    settings.localHostname = localHostname;
  }

  const promises = [
    saveDomainSettings(domainBase, settings),
    saveAppConfig({ navigateOnSave, closeOnSave }),
  ];

  if (navigateOnSave) {
    const targetHostname = isOnLocal ? prodHostname : localHostname;
    const targetTld = isOnLocal ? newProdTld : newLocalTld;
    const targetProtocol = isOnLocal ? productionProtocol : localProtocol;
    const newUrl = buildSwappedUrl(activeTab.url, targetHostname, targetTld, targetProtocol);
    promises.push(chrome.tabs.update(activeTab.id, { url: newUrl }));
  }

  await Promise.all(promises);

  if (closeOnSave) {
    window.close();
  }
};

submitButton.addEventListener('click', handleSubmit);

prodHostnameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSubmit();
});

localHostnameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSubmit();
});

tldInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSubmit();
});

localTldInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') handleSubmit();
});

// --- Edit form handlers (wired once) ---

editProdTlsCheckbox.addEventListener('change', () => syncTlsLabel(editProdTlsCheckbox));
editLocalTlsCheckbox.addEventListener('change', () => syncTlsLabel(editLocalTlsCheckbox));

editProdHostnameInput.addEventListener('input', (event) => {
  clearFormError([editProdInputRow, editLocalInputRow], editErrorMessage);
  resizeInput(event.target);
});

editLocalHostnameInput.addEventListener('input', (event) => {
  clearFormError([editProdInputRow, editLocalInputRow], editErrorMessage);
  resizeInput(event.target);
});

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
  const editProdHostname = editProdHostnameInput.value.trim();
  const editLocalHostname = editLocalHostnameInput.value.trim();

  if (!editProdHostname) {
    showFormError(i18n('errorHostnameRequired'), editProdInputRow, editErrorMessage);
    return;
  }

  if (!editLocalHostname) {
    showFormError(i18n('errorHostnameRequired'), editLocalInputRow, editErrorMessage);
    return;
  }

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

  if (editProdHostname !== editLocalHostname) {
    updatedSettings.prodHostname = editProdHostname;
    updatedSettings.localHostname = editLocalHostname;
  }

  await saveDomainSettings(state.editingDomainBase, updatedSettings);

  const fullDomain = `${state.editingDomainBase}${state.editingProdTld}`;
  const listItem = domainListEl.querySelector(`[data-domain="${CSS.escape(fullDomain)}"]`);
  if (listItem) {
    listItem.dataset.domain = `${state.editingDomainBase}${newProdTld}`;
    const urlSpan = listItem.querySelector('.domain-item-url');
    renderUrlPreview(urlSpan, state.editingDomainBase, updatedSettings);
  }

  closeEditForm();
});

editDeleteBtn.addEventListener('click', async () => {
  await removeDomainSettings(state.editingDomainBase);

  const fullDomain = `${state.editingDomainBase}${state.editingProdTld}`;
  const listItem = domainListEl.querySelector(`[data-domain="${CSS.escape(fullDomain)}"]`);
  if (listItem) {
    listItem.remove();
  }

  closeEditForm();

  if (domainListEl.children.length === 0) {
    emptyStateEl.style.display = 'block';
  }
});

editProdHostnameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') editSaveBtn.click();
});

editLocalHostnameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') editSaveBtn.click();
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
