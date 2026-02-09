import { SYNC_QUOTA_PER_ITEM, BUCKET_KEY_PREFIX } from './constants.js';
import { serialize, deserialize, compress, decompress } from './sync-codec.js';

const MAX_BUCKETS = 13;

/**
 * Build the storage key for a bucket index.
 *
 * @param {number} index
 * @returns {string}
 */
const bucketKey = (index) => `${BUCKET_KEY_PREFIX}${index}`;

/**
 * Read and decompress all buckets from chrome.storage.sync.
 *
 * @returns {Promise<{ bucketIndex: number, entries: string[] }[]>}
 */
const readBuckets = async () => {
  const keys = Array.from({ length: MAX_BUCKETS }, (_, i) => bucketKey(i));
  const data = await chrome.storage.sync.get(keys);

  const buckets = [];
  for (let i = 0; i < MAX_BUCKETS; i++) {
    const key = bucketKey(i);
    if (data[key]) {
      const entries = await decompress(data[key]);
      buckets.push({ bucketIndex: i, entries });
    }
  }

  return buckets;
};

/**
 * Find a single domain's config from sync storage.
 *
 * @param {string} domainBase
 * @returns {Promise<{ version: string, envCount: number, environments: Array, hostnameDivergence: boolean, hostnames: string[] } | null>}
 */
export const findDomainConfig = async (domainBase) => {
  const buckets = await readBuckets();

  for (const { entries } of buckets) {
    for (const entry of entries) {
      const config = deserialize(entry);
      if (config.hostnames.includes(domainBase)) {
        return config;
      }
    }
  }

  return null;
};

/**
 * Distribute serialized entries into buckets respecting the per-item size limit.
 *
 * @param {string[]} entries
 * @returns {string[][]}
 */
const distributeToBuckets = (entries) => {
  const buckets = [[]];
  // JSON array overhead: []
  let currentSize = 2;

  for (const entry of entries) {
    // +1 for the comma separator
    const entrySize = JSON.stringify(entry).length + 1;

    if (currentSize + entrySize > SYNC_QUOTA_PER_ITEM) {
      buckets.push([]);
      currentSize = 2;
    }

    buckets[buckets.length - 1].push(entry);
    currentSize += entrySize;
  }

  return buckets;
};

/**
 * Rebuild and write all buckets to sync storage.
 *
 * @param {string[]} allEntries
 * @returns {Promise<void>}
 */
const writeBuckets = async (allEntries) => {
  const distributed = distributeToBuckets(allEntries);
  const syncData = {};

  for (let i = 0; i < distributed.length; i++) {
    syncData[bucketKey(i)] = await compress(distributed[i]);
  }

  // Remove any previously-used bucket keys beyond current count
  const keysToRemove = [];
  for (let i = distributed.length; i < MAX_BUCKETS; i++) {
    keysToRemove.push(bucketKey(i));
  }

  await Promise.all([
    chrome.storage.sync.set(syncData),
    keysToRemove.length > 0 ? chrome.storage.sync.remove(keysToRemove) : Promise.resolve(),
  ]);
};

/**
 * Collect all serialized entries from all buckets.
 *
 * @returns {Promise<string[]>}
 */
export const collectAllEntries = async () => {
  const buckets = await readBuckets();
  return buckets.flatMap(({ entries }) => entries);
};

/**
 * Write or update a domain config in sync storage.
 *
 * @param {string} domainBase
 * @param {{ envCount: number, environments: Array<{ tls: boolean, tld: string, port: number, title: string }>, hostnameDivergence: boolean, hostnames: string[] }} config
 * @returns {Promise<void>}
 */
export const writeDomainConfig = async (domainBase, config) => {
  const allEntries = await collectAllEntries();
  const newEntry = serialize(config);

  const updatedEntries = [];
  let replaced = false;

  for (const entry of allEntries) {
    const existing = deserialize(entry);
    if (existing.hostnames.includes(domainBase)) {
      updatedEntries.push(newEntry);
      replaced = true;
    } else {
      updatedEntries.push(entry);
    }
  }

  if (!replaced) {
    updatedEntries.push(newEntry);
  }

  await writeBuckets(updatedEntries);
};

/**
 * Remove a domain config from sync storage.
 *
 * @param {string} domainBase
 * @returns {Promise<void>}
 */
export const removeDomainConfig = async (domainBase) => {
  const allEntries = await collectAllEntries();

  const filtered = allEntries.filter((entry) => {
    const config = deserialize(entry);
    return !config.hostnames.includes(domainBase);
  });

  if (filtered.length === allEntries.length) return;

  if (filtered.length === 0) {
    const keysToRemove = Array.from({ length: MAX_BUCKETS }, (_, i) => bucketKey(i));
    await chrome.storage.sync.remove(keysToRemove);
    return;
  }

  await writeBuckets(filtered);
};
