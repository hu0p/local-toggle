import {
  DEFAULT_LOCAL_TLD,
  HTTPS,
  HTTP,
  LOCAL_BADGE_TEXT,
  LOCAL_BADGE_COLOR,
  EMPTY_BADGE_TEXT,
  CONFIGURE_MENU_ID,
  CLEAR_TLD_MENU_ID,
} from './lib/constants.js';
import { extractTld, getDomainBase, buildSwappedUrl, isRestrictedBrowserPage } from './lib/domain.js';
import { getDomainSettings, saveDomainSettings, removeDomainSettings } from './lib/storage.js';

const updateTabState = async (tabId, url) => {
  try {
    const { hostname } = new URL(url);
    const tld = extractTld(hostname);
    const domainBase = getDomainBase(hostname, tld);
    const settings = await getDomainSettings(domainBase);
    const localTld = settings?.localTld ?? DEFAULT_LOCAL_TLD;
    const isLocal = tld === localTld;

    chrome.action.setBadgeText({ tabId, text: isLocal ? LOCAL_BADGE_TEXT : EMPTY_BADGE_TEXT });
    chrome.action.setBadgeBackgroundColor({ tabId, color: LOCAL_BADGE_COLOR });

    const canToggle = settings && (!isLocal || settings.prodTld);
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !canToggle });
  } catch {
    chrome.action.setBadgeText({ tabId, text: EMPTY_BADGE_TEXT });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
};

const handleActionClick = async (tab) => {
  if (isRestrictedBrowserPage(tab?.url)) return;

  try {
    const activeUrl = new URL(tab.url);
    const { hostname } = activeUrl;
    const tld = extractTld(hostname);
    if (!tld) return;

    const domainBase = getDomainBase(hostname, tld);
    const settings = await getDomainSettings(domainBase);

    if (!settings) return;

    const localTld = settings.localTld ?? DEFAULT_LOCAL_TLD;
    const isOnLocal = tld === localTld;

    if (!isOnLocal) {
      await saveDomainSettings(domainBase, {
        prodTld: tld,
        localTld,
        prodProtocol: activeUrl.protocol,
        localProtocol: settings.localProtocol ?? HTTP,
      });
      const newUrl = buildSwappedUrl(tab.url, domainBase, localTld, settings.localProtocol ?? HTTP);
      await chrome.tabs.update(tab.id, { url: newUrl });
      return;
    }

    if (settings.prodTld) {
      const protocol = settings.prodProtocol ?? HTTPS;
      const newUrl = buildSwappedUrl(tab.url, domainBase, settings.prodTld, protocol);
      await chrome.tabs.update(tab.id, { url: newUrl });
    }
  } catch (err) {
    console.error('[background] action click failed:', err);
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
  if (!tab?.url) return;

  if (info.menuItemId === CONFIGURE_MENU_ID) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return;
  }

  if (info.menuItemId === CLEAR_TLD_MENU_ID) {
    try {
      const { hostname } = new URL(tab.url);
      const tld = extractTld(hostname);
      if (!tld) return;
      const domainBase = getDomainBase(hostname, tld);
      await removeDomainSettings(domainBase);
      await updateTabState(tab.id, tab.url);
    } catch (err) {
      console.error('[background] clear TLD failed:', err);
    }
  }
});

chrome.action.onClicked.addListener(handleActionClick);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    updateTabState(tabId, changeInfo.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) {
    updateTabState(tabId, tab.url);
  }
});
