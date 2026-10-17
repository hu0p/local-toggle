import { DEFAULT_LOCAL_TLD } from './constants.js';

const MULTI_PART_TLDS = [
  '.co.uk', '.co.nz', '.co.za', '.co.jp', '.co.kr', '.co.in',
  '.com.au', '.com.br', '.com.sg', '.com.mx', '.com.ar',
  '.org.uk', '.org.au', '.net.au', '.ac.uk', '.gov.uk',
];

/**
 * Extract the TLD from a hostname.
 * Handles multi-part TLDs like .co.uk by checking common patterns.
 *
 * @param {string} hostname
 * @returns {string}
 */
export const extractTld = (hostname) => {
  const lowerHost = hostname.toLowerCase();

  const matchedMultiPart = MULTI_PART_TLDS.find((tld) => lowerHost.endsWith(tld));
  if (matchedMultiPart) {
    return matchedMultiPart;
  }

  const lastDotIndex = lowerHost.lastIndexOf('.');
  return lastDotIndex === -1 ? '' : lowerHost.slice(lastDotIndex);
};

/**
 * Get the base domain (hostname without TLD).
 *
 * @param {string} hostname
 * @param {string} tld
 * @returns {string}
 */
export const getDomainBase = (hostname, tld) => hostname.slice(0, -tld.length);

/**
 * Build a URL with a swapped domain and protocol.
 *
 * @param {string} originalUrl
 * @param {string} domainBase
 * @param {string} newTld
 * @param {string} protocol
 * @returns {string}
 */
export const buildSwappedUrl = (originalUrl, domainBase, newTld, protocol) => {
  const url = new URL(originalUrl);
  url.hostname = `${domainBase}${newTld}`;
  url.protocol = protocol;
  return url.toString();
};

/**
 * Build a full hostname from a domain base and TLD.
 *
 * @param {string} domainBase
 * @param {string} tld
 * @returns {string}
 */
export const toFullHostname = (domainBase, tld) => `${domainBase}${tld}`.toLowerCase();

/**
 * Decide whether a hostname is the local environment for the given settings.
 * When hostnames diverge, the TLD alone cannot distinguish environments
 * (e.g. icepickr.com vs dev.icepickr.com), so the full hostname is compared.
 *
 * @param {string} hostname
 * @param {{ localTld?: string, localHostname?: string } | null | undefined} settings
 * @returns {boolean}
 */
export const isLocalHostname = (hostname, settings) => {
  const localTld = settings?.localTld ?? DEFAULT_LOCAL_TLD;

  if (settings?.localHostname) {
    return hostname.toLowerCase() === toFullHostname(settings.localHostname, localTld);
  }

  return extractTld(hostname) === localTld;
};

/**
 * Check whether a URL points to a restricted browser page that the
 * extension cannot operate on.
 *
 * @param {string | undefined} url
 * @returns {boolean}
 */
export const isRestrictedBrowserPage = (url) => {
  if (!url) return true;
  const { protocol } = new URL(url);
  return protocol === 'chrome:' || protocol === 'about:' || protocol === 'chrome-extension:';
};
