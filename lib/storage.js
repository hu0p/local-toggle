import { DEFAULT_LOCAL_TLD, HTTPS, HTTP, APP_CONFIG_KEY } from './constants.js';
import { collectAllEntries, findDomainConfig, writeDomainConfig, removeDomainConfig } from './sync-storage.js';
import { deserialize } from './sync-codec.js';

// Sync entries use "example." (with trailing dot) per the spec.
const toSyncDomainBase = (domainBase) => `${domainBase}.`;

/**
 * Convert domain settings to a sync config object.
 *
 * @param {string} domainBase
 * @param {{ prodTld: string, localTld: string, prodProtocol: string, localProtocol: string, prodHostname?: string, localHostname?: string }} settings
 * @returns {{ envCount: number, environments: Array<{ tls: boolean, tld: string, port: number, title: string }>, hostnameDivergence: boolean, hostnames: string[] }}
 */
const toSyncConfig = (domainBase, settings) => ({
  envCount: 2,
  environments: [
    {
      tls: settings.localProtocol === HTTPS,
      tld: settings.localTld,
      port: settings.localProtocol === HTTPS ? 443 : 80,
      title: 'Local',
    },
    {
      tls: settings.prodProtocol === HTTPS,
      tld: settings.prodTld,
      port: settings.prodProtocol === HTTPS ? 443 : 80,
      title: 'Production',
    },
  ],
  hostnameDivergence: Boolean(settings.prodHostname),
  hostnames: settings.prodHostname
    ? [toSyncDomainBase(settings.prodHostname), toSyncDomainBase(settings.localHostname)]
    : [toSyncDomainBase(domainBase)],
});

/**
 * Convert a sync config object back to domain settings.
 *
 * @param {{ environments: Array<{ tls: boolean, tld: string }>, hostnameDivergence: boolean, hostnames: string[] }} config
 * @returns {{ prodTld: string, localTld: string, prodProtocol: string, localProtocol: string, prodHostname?: string, localHostname?: string }}
 */
const fromSyncConfig = (config) => {
  const base = {
    prodTld: config.environments[1]?.tld ?? '.com',
    localTld: config.environments[0]?.tld ?? DEFAULT_LOCAL_TLD,
    prodProtocol: config.environments[1]?.tls ? HTTPS : HTTP,
    localProtocol: config.environments[0]?.tls ? HTTPS : HTTP,
  };

  if (config.hostnameDivergence && config.hostnames.length >= 2) {
    base.prodHostname = config.hostnames[0].replace(/\.$/, '');
    base.localHostname = config.hostnames[1].replace(/\.$/, '');
  }

  return base;
};

/**
 * Get domain settings. Checks session cache first, falls back to sync storage.
 *
 * @param {string} domainBase
 * @returns {Promise<{ prodTld: string, localTld: string, prodProtocol: string, localProtocol: string } | null>}
 */
export const getDomainSettings = async (domainBase) => {
  const sessionData = await chrome.storage.session.get(domainBase);

  if (sessionData[domainBase]) {
    return sessionData[domainBase];
  }

  const config = await findDomainConfig(toSyncDomainBase(domainBase));
  if (!config) return null;

  const settings = fromSyncConfig(config);
  await chrome.storage.session.set({ [domainBase]: settings });
  return settings;
};

/**
 * Save domain settings to session cache and sync storage.
 *
 * @param {string} domainBase
 * @param {{ prodTld: string, localTld: string, prodProtocol: string, localProtocol: string, prodHostname?: string, localHostname?: string }} settings
 * @returns {Promise<void>}
 */
export const saveDomainSettings = async (domainBase, settings) => {
  const sessionEntries = { [domainBase]: settings };

  if (settings.prodHostname && settings.localHostname) {
    sessionEntries[settings.prodHostname] = settings;
    sessionEntries[settings.localHostname] = settings;
  }

  const syncDomainBase = settings.prodHostname
    ? toSyncDomainBase(settings.prodHostname)
    : toSyncDomainBase(domainBase);

  await Promise.all([
    chrome.storage.session.set(sessionEntries),
    writeDomainConfig(syncDomainBase, toSyncConfig(domainBase, settings)),
  ]);
};

/**
 * Remove domain settings from session cache and sync storage.
 *
 * @param {string} domainBase
 * @returns {Promise<void>}
 */
export const removeDomainSettings = async (domainBase) => {
  const sessionData = await chrome.storage.session.get(domainBase);
  const settings = sessionData[domainBase];
  const keysToRemove = [domainBase];

  if (settings?.prodHostname) keysToRemove.push(settings.prodHostname);
  if (settings?.localHostname) keysToRemove.push(settings.localHostname);

  await Promise.all([
    chrome.storage.session.remove(keysToRemove),
    removeDomainConfig(toSyncDomainBase(domainBase)),
  ]);
};

/**
 * Get all domain configs from sync storage.
 *
 * @returns {Promise<Array<{ domainBase: string, settings: { prodTld: string, localTld: string, prodProtocol: string, localProtocol: string } }>>}
 */
export const getAllDomainConfigs = async () => {
  const entries = await collectAllEntries();
  return entries.map((entry) => {
    const config = deserialize(entry);
    const domainBase = config.hostnames[0].replace(/\.$/, '');
    return { domainBase, settings: fromSyncConfig(config) };
  });
};

/**
 * Get app-level configuration from local storage.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
export const getAppConfig = async () => {
  const data = await chrome.storage.local.get(APP_CONFIG_KEY);
  return data[APP_CONFIG_KEY] ?? {};
};

/**
 * Merge updates into the app-level configuration in local storage.
 *
 * @param {Record<string, unknown>} updates
 * @returns {Promise<void>}
 */
export const saveAppConfig = async (updates) => {
  const current = await getAppConfig();
  await chrome.storage.local.set({ [APP_CONFIG_KEY]: { ...current, ...updates } });
};
