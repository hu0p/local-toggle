import { DEFAULT_LOCAL_TLD, HTTPS, HTTP } from './constants.js';
import { collectAllEntries, findDomainConfig, writeDomainConfig, removeDomainConfig } from './sync-storage.js';
import { deserialize } from './sync-codec.js';

// Sync entries use "example." (with trailing dot) per the spec.
const toSyncDomainBase = (domainBase) => `${domainBase}.`;

/**
 * Convert domain settings to a sync config object.
 *
 * @param {string} domainBase
 * @param {{ prodTld: string, localTld: string, prodProtocol: string, localProtocol: string }} settings
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
  hostnameDivergence: false,
  hostnames: [toSyncDomainBase(domainBase)],
});

/**
 * Convert a sync config object back to domain settings.
 *
 * @param {{ environments: Array<{ tls: boolean, tld: string }> }} config
 * @returns {{ prodTld: string, localTld: string, prodProtocol: string, localProtocol: string }}
 */
const fromSyncConfig = (config) => ({
  prodTld: config.environments[1]?.tld ?? '.com',
  localTld: config.environments[0]?.tld ?? DEFAULT_LOCAL_TLD,
  prodProtocol: config.environments[1]?.tls ? HTTPS : HTTP,
  localProtocol: config.environments[0]?.tls ? HTTPS : HTTP,
});

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
 * @param {{ prodTld: string, localTld: string, prodProtocol: string, localProtocol: string }} settings
 * @returns {Promise<void>}
 */
export const saveDomainSettings = async (domainBase, settings) => {
  await Promise.all([
    chrome.storage.session.set({ [domainBase]: settings }),
    writeDomainConfig(toSyncDomainBase(domainBase), toSyncConfig(domainBase, settings)),
  ]);
};

/**
 * Remove domain settings from session cache and sync storage.
 *
 * @param {string} domainBase
 * @returns {Promise<void>}
 */
export const removeDomainSettings = async (domainBase) => {
  await Promise.all([
    chrome.storage.session.remove(domainBase),
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
