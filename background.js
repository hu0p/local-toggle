const PROFILING = true;
const SERVICE_WORKER_BOOT = performance.now();
console.log(`[background] service worker boot at: ${SERVICE_WORKER_BOOT.toFixed(2)}ms (performance.now origin)`);

const perf = (label) => {
  if (!PROFILING) {
    return () => {};
  }
  const start = performance.now();
  return () => {
    const elapsed = (performance.now() - start).toFixed(2);
    const sinceboot = (performance.now() - SERVICE_WORKER_BOOT).toFixed(2);
    console.log(`[background] ${label}: ${elapsed}ms (${sinceboot}ms since boot)`);
  };
};

const DEFAULT_LOCAL_TLD = '.test';
const STORAGE_PREFIX = 'tld:';
const PROTOCOL_PREFIX = 'proto:';
const LOCAL_PROTOCOL_PREFIX = 'localproto:';
const LOCAL_TLD_PREFIX = 'localtld:';
const LOCAL_BADGE_TEXT = 'L';
const LOCAL_BADGE_COLOR = '#22c55e';
const EMPTY_BADGE_TEXT = '';
const CLEAR_TLD_MENU_ID = 'clear-saved-tld';
const CONFIGURE_MENU_ID = 'configure-settings';
const HTTPS = 'https:';
const HTTP = 'http:';

const getStorageKey = (domainBase) => `${STORAGE_PREFIX}${domainBase}`;
const getLocalTldKey = (domainBase) => `${LOCAL_TLD_PREFIX}${domainBase}`;

const getLocalTldForDomain = async (domainBase) => {
  const localTldKey = getLocalTldKey(domainBase);
  const [sessionData, localData] = await Promise.all([
    chrome.storage.session.get(localTldKey),
    chrome.storage.local.get(localTldKey),
  ]);
  return sessionData[localTldKey] || localData[localTldKey] || DEFAULT_LOCAL_TLD;
};

/**
 * Extract the TLD from a hostname.
 * Handles multi-part TLDs like .co.uk by checking common patterns.
 */
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
  if (lastDotIndex === -1) {
    return '';
  }

  return lowerHost.slice(lastDotIndex);
};

/**
 * Get the base domain (hostname without TLD).
 */
const getDomainBase = (hostname, tld) => hostname.slice(0, -tld.length);

const buildSwappedUrl = (originalUrl, domainBase, newTld, protocol) => {
  const url = new URL(originalUrl);
  url.hostname = `${domainBase}${newTld}`;
  url.protocol = protocol;
  return url.toString();
};

const updateBadgeForTab = async (tabId, url) => {
  try {
    const { hostname } = new URL(url);
    const tld = extractTld(hostname);
    const domainBase = getDomainBase(hostname, tld);
    const localTld = await getLocalTldForDomain(domainBase);
    const isLocal = tld === localTld;

    chrome.action.setBadgeText({ tabId, text: isLocal ? LOCAL_BADGE_TEXT : EMPTY_BADGE_TEXT });
    chrome.action.setBadgeBackgroundColor({ tabId, color: LOCAL_BADGE_COLOR });
  } catch {
    chrome.action.setBadgeText({ tabId, text: EMPTY_BADGE_TEXT });
  }
};

const updatePopupForTab = async (tabId, url) => {
  try {
    const { hostname } = new URL(url);
    const tld = extractTld(hostname);

    if (!tld) {
      await chrome.action.setPopup({ tabId, popup: '' });
      return;
    }

    const domainBase = getDomainBase(hostname, tld);
    const localTld = await getLocalTldForDomain(domainBase);

    if (tld !== localTld) {
      await chrome.action.setPopup({ tabId, popup: '' });
      return;
    }

    const storageKey = getStorageKey(domainBase);
    const [sessionData, localData] = await Promise.all([
      chrome.storage.session.get(storageKey),
      chrome.storage.local.get(storageKey),
    ]);

    const hasSavedTld = sessionData[storageKey] || localData[storageKey];
    await chrome.action.setPopup({ tabId, popup: hasSavedTld ? '' : 'popup.html' });
  } catch {
    await chrome.action.setPopup({ tabId, popup: '' });
  }
};

const handleActionClick = async (tab) => {
  if (!tab?.url) {
    return;
  }

  try {
    const activeUrl = new URL(tab.url);
    const { hostname } = activeUrl;
    const tld = extractTld(hostname);

    if (!tld) {
      return;
    }

    const domainBase = getDomainBase(hostname, tld);
    const storageKey = getStorageKey(domainBase);
    const protocolKey = `${PROTOCOL_PREFIX}${domainBase}`;
    const localProtocolKey = `${LOCAL_PROTOCOL_PREFIX}${domainBase}`;
    const localTldKey = getLocalTldKey(domainBase);

    const [sessionData, localData] = await Promise.all([
      chrome.storage.session.get([storageKey, protocolKey, localProtocolKey, localTldKey]),
      chrome.storage.local.get([storageKey, protocolKey, localProtocolKey, localTldKey]),
    ]);

    const localTld = sessionData[localTldKey] || localData[localTldKey] || DEFAULT_LOCAL_TLD;
    const isOnLocal = tld === localTld;

    if (!isOnLocal) {
      const prodData = { [storageKey]: tld, [protocolKey]: activeUrl.protocol };
      await Promise.all([
        chrome.storage.session.set(prodData),
        chrome.storage.local.set(prodData),
      ]);
      const localProtocol = sessionData[localProtocolKey] || localData[localProtocolKey] || HTTP;
      const newUrl = buildSwappedUrl(tab.url, domainBase, localTld, localProtocol);
      await chrome.tabs.update(tab.id, { url: newUrl });
      return;
    }

    const savedTld = sessionData[storageKey] || localData[storageKey];
    const protocol = sessionData[protocolKey] || localData[protocolKey] || HTTPS;

    if (savedTld) {
      if (!sessionData[storageKey]) {
        chrome.storage.session.set({ [storageKey]: savedTld, [protocolKey]: protocol });
      }
      const newUrl = buildSwappedUrl(tab.url, domainBase, savedTld, protocol);
      await chrome.tabs.update(tab.id, { url: newUrl });
    }
  } catch {
    // noop for invalid URLs
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONFIGURE_MENU_ID,
    title: chrome.i18n.getMessage('menuConfigure'),
    contexts: ['action'],
  });
  chrome.contextMenus.create({
    id: CLEAR_TLD_MENU_ID,
    title: chrome.i18n.getMessage('menuClearTld'),
    contexts: ['action'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url) {
    return;
  }

  if (info.menuItemId === CONFIGURE_MENU_ID) {
    await chrome.action.setPopup({ tabId: tab.id, popup: 'popup.html?configure=1' });
    await chrome.action.openPopup();
    return;
  }

  if (info.menuItemId !== CLEAR_TLD_MENU_ID) {
    return;
  }

  try {
    const { hostname } = new URL(tab.url);
    const tld = extractTld(hostname);

    if (!tld) {
      return;
    }

    const domainBase = getDomainBase(hostname, tld);
    const storageKey = getStorageKey(domainBase);
    const protocolKey = `${PROTOCOL_PREFIX}${domainBase}`;
    const localProtocolKey = `${LOCAL_PROTOCOL_PREFIX}${domainBase}`;
    const localTldKey = getLocalTldKey(domainBase);

    const keysToRemove = [storageKey, protocolKey, localProtocolKey, localTldKey];
    await Promise.all([
      chrome.storage.local.remove(keysToRemove),
      chrome.storage.session.remove(keysToRemove),
    ]);

    updateBadgeForTab(tab.id, tab.url);
    updatePopupForTab(tab.id, tab.url);
  } catch {
    // noop for invalid URLs
  }
});

chrome.action.onClicked.addListener(handleActionClick);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    port.onDisconnect.addListener(() => {
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.url) {
          updatePopupForTab(tab.id, tab.url);
        }
      });
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    updateBadgeForTab(tabId, changeInfo.url);
    updatePopupForTab(tabId, changeInfo.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) {
    updateBadgeForTab(tabId, tab.url);
    updatePopupForTab(tabId, tab.url);
  }
});
