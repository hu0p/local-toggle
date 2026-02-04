const PROFILING = true;

const perf = (label) => {
  if (!PROFILING) {
    return () => {};
  }
  const start = performance.now();
  return () => {
    const elapsed = (performance.now() - start).toFixed(2);
    console.log(`[popup] ${label}: ${elapsed}ms`);
  };
};

const perfTotal = perf('total init');

const STORAGE_PREFIX = 'tld:';
const PROTOCOL_PREFIX = 'proto:';
const LOCAL_PROTOCOL_PREFIX = 'localproto:';
const LOCAL_TLD_PREFIX = 'localtld:';
const DEFAULT_LOCAL_TLD = '.test';
const HTTPS = 'https:';
const HTTP = 'http:';

const extractTld = (hostname) => {
  const multiPartTlds = [
    '.co.uk', '.co.nz', '.co.za', '.co.jp', '.co.kr', '.co.in',
    '.com.au', '.com.br', '.com.sg', '.com.mx', '.com.ar',
    '.org.uk', '.org.au', '.net.au', '.ac.uk', '.gov.uk',
  ];

  const lowerHost = hostname.toLowerCase();
  const matchedMultiPart = multiPartTlds.find((tld) => lowerHost.endsWith(tld));
  if (matchedMultiPart) {
    return matchedMultiPart;
  }

  const lastDotIndex = lowerHost.lastIndexOf('.');
  return lastDotIndex === -1 ? '' : lowerHost.slice(lastDotIndex);
};

const getDomainBase = (hostname, tld) => hostname.slice(0, -tld.length);

const buildSwappedUrl = (originalUrl, domainBase, newTld, protocol) => {
  const url = new URL(originalUrl);
  url.hostname = `${domainBase}${newTld}`;
  url.protocol = protocol;
  return url.toString();
};

const stripLeadingDot = (value) => value.replace(/^\.+/, '');

const navigateAndClose = async (tabId, newUrl) => {
  await chrome.tabs.update(tabId, { url: newUrl });
  window.close();
};

const init = async () => {
  const isConfigureMode = new URLSearchParams(window.location.search).has('configure');

  const endTabQuery = perf('chrome.tabs.query');
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  endTabQuery();

  if (!activeTab?.url) {
    window.close();
    return;
  }

  const activeUrl = new URL(activeTab.url);
  const { hostname } = activeUrl;
  const currentTld = extractTld(hostname);

  if (!currentTld) {
    window.close();
    return;
  }

  const domainBase = getDomainBase(hostname, currentTld);
  const storageKey = `${STORAGE_PREFIX}${domainBase}`;
  const protocolKey = `${PROTOCOL_PREFIX}${domainBase}`;
  const localProtocolKey = `${LOCAL_PROTOCOL_PREFIX}${domainBase}`;
  const localTldKey = `${LOCAL_TLD_PREFIX}${domainBase}`;

  const endStorage = perf('storage check');
  const [sessionStored, localStored] = await Promise.all([
    chrome.storage.session.get([storageKey, protocolKey, localProtocolKey, localTldKey]),
    chrome.storage.local.get([storageKey, protocolKey, localProtocolKey, localTldKey]),
  ]);
  endStorage();

  const savedProdTld = sessionStored[storageKey] || localStored[storageKey];
  const savedProtocol = sessionStored[protocolKey] || localStored[protocolKey];
  const savedLocalProtocol = sessionStored[localProtocolKey] || localStored[localProtocolKey];
  const savedLocalTld = sessionStored[localTldKey] || localStored[localTldKey] || DEFAULT_LOCAL_TLD;

  const isOnLocal = currentTld === savedLocalTld;

  if (!isConfigureMode && !isOnLocal) {
    const prodData = { [storageKey]: currentTld, [protocolKey]: activeUrl.protocol };
    await Promise.all([
      chrome.storage.session.set(prodData),
      chrome.storage.local.set(prodData),
    ]);
    const localProtocol = savedLocalProtocol || HTTP;
    const newUrl = buildSwappedUrl(activeTab.url, domainBase, savedLocalTld, localProtocol);
    navigateAndClose(activeTab.id, newUrl);
    perfTotal();
    return;
  }

  if (!isConfigureMode && savedProdTld) {
    const protocol = savedProtocol || HTTPS;
    if (!sessionStored[storageKey]) {
      chrome.storage.session.set({ [storageKey]: savedProdTld, [protocolKey]: protocol });
    }
    const newUrl = buildSwappedUrl(activeTab.url, domainBase, savedProdTld, protocol);
    navigateAndClose(activeTab.id, newUrl);
    perfTotal();
    return;
  }

  const endShow = perf('show form');
  document.body.style.visibility = 'visible';

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

  const prefillProdTld = isOnLocal ? savedProdTld : currentTld;
  const prefillLocalTld = isOnLocal ? currentTld : savedLocalTld;
  const prefillProdProtocol = isOnLocal ? savedProtocol : activeUrl.protocol;
  const prefillLocalProtocol = savedLocalProtocol || (isOnLocal ? activeUrl.protocol : HTTP);

  prodDomain.textContent = `://${domainBase}.`;
  localDomain.textContent = `://${domainBase}.`;

  const buttonLabel = document.querySelector('#button-label');
  buttonLabel.textContent = isOnLocal ? 'Go to Production' : 'Go to Local';

  if (prefillProdTld) {
    tldInput.value = prefillProdTld.replace(/^\./, '');
  }
  localTldInput.value = prefillLocalTld.replace(/^\./, '');
  productionTlsCheckbox.checked = prefillProdProtocol === HTTPS;
  localTlsCheckbox.checked = prefillLocalProtocol === HTTPS;

  const showError = (message, targetRow = inputRow) => {
    errorMessage.textContent = message;
    errorMessage.classList.add('visible');
    targetRow.classList.add('error');

    document.body.classList.remove('shake');
    requestAnimationFrame(() => {
      document.body.classList.add('shake');
    });
  };

  const clearError = () => {
    errorMessage.classList.remove('visible');
    inputRow.classList.remove('error');
    localInputRow.classList.remove('error');
  };

  const resizeInput = (input) => {
    const length = Math.max(input.value.length, input.placeholder.length, 3);
    input.style.width = `${length}ch`;
  };

  const handleTldInput = (event) => {
    clearError();
    resizeInput(event.target);
  };

  tldInput.addEventListener('input', handleTldInput);
  localTldInput.addEventListener('input', handleTldInput);

  resizeInput(tldInput);
  resizeInput(localTldInput);

  const handleSubmit = async () => {
    const rawProdTld = tldInput.value.trim();
    const rawLocalTld = localTldInput.value.trim();
    const prodTld = stripLeadingDot(rawProdTld);
    const localTld = stripLeadingDot(rawLocalTld);

    if (!prodTld) {
      showError('Production TLD is required', inputRow);
      return;
    }

    if (!localTld) {
      showError('Local TLD is required', localInputRow);
      return;
    }

    const newProdTld = `.${prodTld}`;
    const newLocalTld = `.${localTld}`;

    if (newProdTld === newLocalTld) {
      showError('TLDs must be different', localInputRow);
      return;
    }

    const productionProtocol = productionTlsCheckbox.checked ? HTTPS : HTTP;
    const localProtocol = localTlsCheckbox.checked ? HTTPS : HTTP;

    const storageData = {
      [storageKey]: newProdTld,
      [protocolKey]: productionProtocol,
      [localProtocolKey]: localProtocol,
      [localTldKey]: newLocalTld,
    };

    const targetTld = isOnLocal ? newProdTld : newLocalTld;
    const targetProtocol = isOnLocal ? productionProtocol : localProtocol;
    const newUrl = buildSwappedUrl(activeTab.url, domainBase, targetTld, targetProtocol);

    await Promise.all([
      chrome.storage.local.set(storageData),
      chrome.storage.session.set(storageData),
      chrome.tabs.update(activeTab.id, { url: newUrl }),
    ]);

    window.close();
  };

  submitButton.addEventListener('click', handleSubmit);

  const handleEnterKey = (event) => {
    if (event.key === 'Enter') {
      handleSubmit();
    }
  };

  tldInput.addEventListener('keydown', handleEnterKey);
  localTldInput.addEventListener('keydown', handleEnterKey);

  tldInput.focus();
  endShow();
  perfTotal();
};

init();

chrome.runtime.connect({ name: 'popup' });
