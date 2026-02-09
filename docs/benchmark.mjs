import { readFileSync } from 'fs';
import { deflateSync, inflateSync } from 'zlib';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Constants ---

const DEFAULT_TLDS = ['.test', '.com', '.com'];
const DEFAULT_TITLES = ['Local', 'Production'];
const DELIMITER = '|';
const SUB_DELIMITER = '^';
const VERSION = '0';

const CUSTOM_TLDS = ['.local', '.dev', '.staging', '.internal', '.localhost', '.example', '.invalid', '.co.uk', '.org', '.net', '.io'];
const CUSTOM_TITLES = ['Dev', 'Staging', 'QA', 'UAT', 'Preview', 'Canary', 'Nightly', 'Beta'];
const CUSTOM_PORTS = [3000, 3001, 4200, 5000, 5173, 8000, 8080, 8443, 9000];

const SYNC_QUOTA_BYTES = 102_400;
const SYNC_QUOTA_PER_ITEM = 8_192;
const SYNC_MAX_ITEMS = 512;
const FLAT_KEYS_PER_DOMAIN = 4;

// --- Helpers ---

const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomBool = (probability = 0.5) => Math.random() < probability;

const extractDomainBase = (hostname) => {
  const lastDot = hostname.lastIndexOf('.');
  if (lastDot === -1) return hostname + '.';
  return hostname.slice(0, lastDot + 1);
};

// --- Dataset Generation ---

const generateConfig = (hostname) => {
  const domainBase = extractDomainBase(hostname);
  const envCount = randomBool(0.15) ? 3 : 2;
  const environments = [];

  for (let i = 0; i < envCount; i++) {
    const defaultTld = DEFAULT_TLDS[i] ?? '.com';
    const defaultTitle = DEFAULT_TITLES[i] ?? `Environment ${i + 1}`;

    const tls = i === 0 ? randomBool(0.2) : randomBool(0.9);
    const customTld = i === 0 ? randomBool(0.3) : (i >= 2 ? randomBool(0.7) : randomBool(0.1));
    const customPort = i === 0 ? randomBool(0.4) : randomBool(0.05);
    const customTitle = randomBool(0.15);

    environments.push({
      tls,
      tld: customTld ? randomChoice(CUSTOM_TLDS) : defaultTld,
      customTld,
      port: customPort ? randomChoice(CUSTOM_PORTS) : (tls ? 443 : 80),
      customPort,
      title: customTitle ? randomChoice(CUSTOM_TITLES) : defaultTitle,
      customTitle,
    });
  }

  const hostnameDivergence = randomBool(0.1);
  const hostnames = hostnameDivergence
    ? environments.map((_, i) => i === 0 ? `local-${domainBase}` : (i === 1 ? domainBase : `staging-${domainBase}`))
    : [domainBase];

  return { domainBase, envCount, environments, hostnameDivergence, hostnames };
};

// --- Serialization (Spec Format) ---

const serialize = (config) => {
  const { envCount, environments, hostnameDivergence, hostnames } = config;

  const flags = environments.map((env) =>
    `${env.tls ? 1 : 0}${env.customTld ? 1 : 0}${env.customPort ? 1 : 0}${env.customTitle ? 1 : 0}`
  ).join('');

  const envValues = environments.map((env) => {
    const parts = [];
    if (env.customTld) parts.push(env.tld);
    if (env.customPort) parts.push(String(env.port));
    if (env.customTitle) parts.push(env.title);
    return parts.join(SUB_DELIMITER);
  });

  const hostnameSection = hostnames.join(SUB_DELIMITER);

  return [
    VERSION,
    String(envCount),
    flags,
    hostnameDivergence ? '1' : '0',
    ...envValues,
    hostnameSection,
  ].join(DELIMITER);
};

// --- Deserialization (Spec Format) ---

const deserialize = (entry) => {
  const sections = entry.split(DELIMITER);
  let idx = 0;

  const version = sections[idx++];
  const envCount = parseInt(sections[idx++], 10);
  const flagStr = sections[idx++];
  const hostnameDivergence = sections[idx++] === '1';

  const environments = [];
  for (let i = 0; i < envCount; i++) {
    const offset = i * 4;
    const tls = flagStr[offset] === '1';
    const customTld = flagStr[offset + 1] === '1';
    const customPort = flagStr[offset + 2] === '1';
    const customTitle = flagStr[offset + 3] === '1';

    const valuesStr = sections[idx++] || '';
    const values = valuesStr ? valuesStr.split(SUB_DELIMITER) : [];
    let vi = 0;

    const defaultTld = DEFAULT_TLDS[i] ?? '.com';
    const defaultTitle = DEFAULT_TITLES[i] ?? `Environment ${i + 1}`;

    environments.push({
      tls,
      tld: customTld ? values[vi++] : defaultTld,
      port: customPort ? parseInt(values[vi++], 10) : (tls ? 443 : 80),
      title: customTitle ? values[vi++] : defaultTitle,
    });
  }

  const hostnameStr = sections[idx++];
  const hostnames = hostnameStr.split(SUB_DELIMITER);

  return { version, envCount, environments, hostnameDivergence, hostnames };
};

// --- Flat Key Format (Current) ---

const toFlatKeys = (config) => {
  const { domainBase, environments } = config;
  const keys = {};
  keys[`tld:${domainBase}`] = environments[1]?.tld ?? '.com';
  keys[`proto:${domainBase}`] = environments[1]?.tls ? 'https:' : 'http:';
  keys[`localproto:${domainBase}`] = environments[0]?.tls ? 'https:' : 'http:';
  keys[`localtld:${domainBase}`] = environments[0]?.tld ?? '.test';
  return keys;
};

// --- Compression ---

const compress = (data) => {
  const json = JSON.stringify(data);
  const deflated = deflateSync(Buffer.from(json));
  return deflated.toString('base64');
};

const decompress = (b64) => {
  const deflated = Buffer.from(b64, 'base64');
  const json = inflateSync(deflated).toString();
  return JSON.parse(json);
};

// --- Bucket Distribution ---

const distributeToBuckets = (entries, maxBucketSize) => {
  const buckets = [[]];
  let currentSize = 2; // JSON array overhead: []

  for (const entry of entries) {
    const entrySize = JSON.stringify(entry).length + 1; // + comma

    if (currentSize + entrySize > maxBucketSize) {
      buckets.push([]);
      currentSize = 2;
    }

    buckets[buckets.length - 1].push(entry);
    currentSize += entrySize;
  }

  return buckets;
};

// --- Timing ---

const timeIt = (label, fn, iterations = 1) => {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 3); i++) fn();

  const start = performance.now();
  let result;
  for (let i = 0; i < iterations; i++) {
    result = fn();
  }
  const elapsed = performance.now() - start;

  return { result, elapsed, perIteration: elapsed / iterations };
};

const fmtTime = (ms) => {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)} ns`;
  if (ms < 1) return `${(ms * 1_000).toFixed(1)} µs`;
  return `${ms.toFixed(2)} ms`;
};

// --- Benchmark ---

const run = () => {
  const domains = readFileSync(
    join(process.argv[2] || join(__dirname, 'top1000.txt')),
    'utf-8'
  ).trim().split('\n');

  console.log(`\nDataset: ${domains.length} domains\n`);
  console.log('='.repeat(60));

  // Generate configs
  const configs = domains.map(generateConfig);

  // Serialize to spec format
  const entries = configs.map(serialize);

  // Verify round-trip
  let roundTripErrors = 0;
  for (const entry of entries) {
    try {
      deserialize(entry);
    } catch {
      roundTripErrors++;
    }
  }
  console.log(`\nRound-trip verification: ${roundTripErrors === 0 ? 'PASS' : `FAIL (${roundTripErrors} errors)`}\n`);

  // --- Size: Flat Keys (Current Format) ---
  const allFlatKeys = {};
  for (const config of configs) {
    Object.assign(allFlatKeys, toFlatKeys(config));
  }
  const flatKeysJson = JSON.stringify(allFlatKeys);
  const flatKeysSize = Buffer.byteLength(flatKeysJson);
  const flatKeyCount = Object.keys(allFlatKeys).length;

  console.log('CURRENT FORMAT (Flat Keys)');
  console.log('-'.repeat(60));
  console.log(`  Keys:              ${flatKeyCount}`);
  console.log(`  JSON size:         ${flatKeysSize.toLocaleString()} bytes`);
  console.log(`  Exceeds MAX_ITEMS: ${flatKeyCount > SYNC_MAX_ITEMS ? `YES (${flatKeyCount} > ${SYNC_MAX_ITEMS})` : 'No'}`);
  console.log(`  Exceeds QUOTA:     ${flatKeysSize > SYNC_QUOTA_BYTES ? `YES (${flatKeysSize.toLocaleString()} > ${SYNC_QUOTA_BYTES.toLocaleString()})` : 'No'}`);
  console.log();

  // --- Size: Packed Entries (No Compression) ---
  const packedJson = JSON.stringify(entries);
  const packedSize = Buffer.byteLength(packedJson);

  // Distribute to buckets (respecting 8KB per item)
  const rawBuckets = distributeToBuckets(entries, SYNC_QUOTA_PER_ITEM);

  console.log('SPEC FORMAT (Packed, No Compression)');
  console.log('-'.repeat(60));
  console.log(`  Entries:           ${entries.length}`);
  console.log(`  JSON size:         ${packedSize.toLocaleString()} bytes`);
  console.log(`  Buckets needed:    ${rawBuckets.length}`);
  console.log(`  Exceeds MAX_ITEMS: ${rawBuckets.length > SYNC_MAX_ITEMS ? 'YES' : 'No'}`);
  console.log(`  Exceeds QUOTA:     ${packedSize > SYNC_QUOTA_BYTES ? `YES (${packedSize.toLocaleString()} > ${SYNC_QUOTA_BYTES.toLocaleString()})` : 'No'}`);
  console.log();

  // Entry size statistics
  const entrySizes = entries.map((e) => Buffer.byteLength(JSON.stringify(e)) + 1);
  const minEntry = Math.min(...entrySizes);
  const maxEntry = Math.max(...entrySizes);
  const avgEntry = entrySizes.reduce((a, b) => a + b, 0) / entrySizes.length;

  console.log('  Entry sizes:');
  console.log(`    Min:             ${minEntry} bytes`);
  console.log(`    Max:             ${maxEntry} bytes`);
  console.log(`    Average:         ${avgEntry.toFixed(1)} bytes`);
  console.log();

  // --- Size: Packed + Compressed ---
  const compressedBuckets = rawBuckets.map(compress);
  const compressedSizes = compressedBuckets.map((b) => Buffer.byteLength(JSON.stringify(b)));
  const totalCompressed = compressedSizes.reduce((a, b) => a + b, 0);

  console.log('SPEC FORMAT (Packed + Deflate + Base64)');
  console.log('-'.repeat(60));
  console.log(`  Buckets:           ${compressedBuckets.length}`);
  console.log(`  Total size:        ${totalCompressed.toLocaleString()} bytes`);
  console.log(`  Compression ratio: ${((1 - totalCompressed / packedSize) * 100).toFixed(1)}%`);
  console.log(`  Exceeds MAX_ITEMS: ${compressedBuckets.length > SYNC_MAX_ITEMS ? 'YES' : 'No'}`);
  console.log(`  Exceeds QUOTA:     ${totalCompressed > SYNC_QUOTA_BYTES ? `YES (${totalCompressed.toLocaleString()} > ${SYNC_QUOTA_BYTES.toLocaleString()})` : 'No'}`);
  console.log();

  for (let i = 0; i < compressedBuckets.length; i++) {
    const entries_in_bucket = rawBuckets[i].length;
    console.log(`  Bucket b${i}: ${compressedSizes[i].toLocaleString()} bytes (${entries_in_bucket} entries)`);
  }
  console.log();

  // --- Verification: Decompress and verify ---
  let decompressErrors = 0;
  for (const compressed of compressedBuckets) {
    try {
      const decompressed = decompress(compressed);
      decompressed.forEach(deserialize);
    } catch {
      decompressErrors++;
    }
  }
  console.log(`Decompress + parse verification: ${decompressErrors === 0 ? 'PASS' : `FAIL (${decompressErrors} errors)`}\n`);

  // --- Summary ---
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log();
  console.log(`  ${'Format'.padEnd(35)} ${'Size'.padStart(10)} ${'Fits?'.padStart(8)}`);
  console.log(`  ${'-'.repeat(35)} ${'-'.repeat(10)} ${'-'.repeat(8)}`);
  console.log(`  ${'Flat keys (current)'.padEnd(35)} ${flatKeysSize.toLocaleString().padStart(10)} ${flatKeyCount <= SYNC_MAX_ITEMS && flatKeysSize <= SYNC_QUOTA_BYTES ? 'Yes' : 'NO'.padStart(8)}`);
  console.log(`  ${'Spec format (no compression)'.padEnd(35)} ${packedSize.toLocaleString().padStart(10)} ${packedSize <= SYNC_QUOTA_BYTES ? 'Yes' : 'NO'.padStart(8)}`);
  console.log(`  ${'Spec format (deflate + base64)'.padEnd(35)} ${totalCompressed.toLocaleString().padStart(10)} ${totalCompressed <= SYNC_QUOTA_BYTES ? 'Yes' : 'NO'.padStart(8)}`);
  console.log();
  console.log(`  Reduction (spec vs flat):       ${((1 - packedSize / flatKeysSize) * 100).toFixed(1)}%`);
  console.log(`  Reduction (compressed vs flat):  ${((1 - totalCompressed / flatKeysSize) * 100).toFixed(1)}%`);
  console.log();

  // --- Timing ---

  const TIMING_ITERATIONS = 100;

  console.log('='.repeat(60));
  console.log('TIMING');
  console.log('='.repeat(60));
  console.log();

  // Serialize all entries
  const serializeAll = timeIt(
    'serialize',
    () => configs.map(serialize),
    TIMING_ITERATIONS
  );
  console.log(`  Serialize ${entries.length} entries`);
  console.log(`    Total:           ${fmtTime(serializeAll.perIteration)}`);
  console.log(`    Per entry:       ${fmtTime(serializeAll.perIteration / entries.length)}`);
  console.log();

  // Deserialize all entries
  const deserializeAll = timeIt(
    'deserialize',
    () => entries.map(deserialize),
    TIMING_ITERATIONS
  );
  console.log(`  Deserialize ${entries.length} entries`);
  console.log(`    Total:           ${fmtTime(deserializeAll.perIteration)}`);
  console.log(`    Per entry:       ${fmtTime(deserializeAll.perIteration / entries.length)}`);
  console.log();

  // Distribute to buckets
  const bucketDist = timeIt(
    'distribute',
    () => distributeToBuckets(entries, SYNC_QUOTA_PER_ITEM),
    TIMING_ITERATIONS
  );
  console.log(`  Distribute to buckets`);
  console.log(`    Total:           ${fmtTime(bucketDist.perIteration)}`);
  console.log();

  // Compress each bucket
  const compressAll = timeIt(
    'compress',
    () => rawBuckets.map(compress),
    TIMING_ITERATIONS
  );
  console.log(`  Compress ${rawBuckets.length} buckets`);
  console.log(`    Total:           ${fmtTime(compressAll.perIteration)}`);
  console.log(`    Per bucket:      ${fmtTime(compressAll.perIteration / rawBuckets.length)}`);
  console.log();

  // Decompress each bucket
  const decompressAll = timeIt(
    'decompress',
    () => compressedBuckets.map(decompress),
    TIMING_ITERATIONS
  );
  console.log(`  Decompress ${compressedBuckets.length} buckets`);
  console.log(`    Total:           ${fmtTime(decompressAll.perIteration)}`);
  console.log(`    Per bucket:      ${fmtTime(decompressAll.perIteration / compressedBuckets.length)}`);
  console.log();

  // Full encode pipeline: serialize → distribute → compress
  const fullEncode = timeIt(
    'full encode',
    () => {
      const serialized = configs.map(serialize);
      const buckets = distributeToBuckets(serialized, SYNC_QUOTA_PER_ITEM);
      return buckets.map(compress);
    },
    TIMING_ITERATIONS
  );
  console.log(`  Full encode pipeline (serialize + distribute + compress)`);
  console.log(`    Total:           ${fmtTime(fullEncode.perIteration)}`);
  console.log();

  // Full decode pipeline: decompress → deserialize all
  const fullDecode = timeIt(
    'full decode',
    () => {
      const allEntries = compressedBuckets.flatMap(decompress);
      return allEntries.map(deserialize);
    },
    TIMING_ITERATIONS
  );
  console.log(`  Full decode pipeline (decompress + deserialize)`);
  console.log(`    Total:           ${fmtTime(fullDecode.perIteration)}`);
  console.log();

  // Breakdown summary
  console.log('-'.repeat(60));
  console.log(`  ${'Operation'.padEnd(35)} ${'Time'.padStart(12)}`);
  console.log(`  ${'-'.repeat(35)} ${'-'.repeat(12)}`);
  console.log(`  ${'Serialize (all entries)'.padEnd(35)} ${fmtTime(serializeAll.perIteration).padStart(12)}`);
  console.log(`  ${'Deserialize (all entries)'.padEnd(35)} ${fmtTime(deserializeAll.perIteration).padStart(12)}`);
  console.log(`  ${'Distribute to buckets'.padEnd(35)} ${fmtTime(bucketDist.perIteration).padStart(12)}`);
  console.log(`  ${'Compress (all buckets)'.padEnd(35)} ${fmtTime(compressAll.perIteration).padStart(12)}`);
  console.log(`  ${'Decompress (all buckets)'.padEnd(35)} ${fmtTime(decompressAll.perIteration).padStart(12)}`);
  console.log(`  ${'-'.repeat(35)} ${'-'.repeat(12)}`);
  console.log(`  ${'Full encode pipeline'.padEnd(35)} ${fmtTime(fullEncode.perIteration).padStart(12)}`);
  console.log(`  ${'Full decode pipeline'.padEnd(35)} ${fmtTime(fullDecode.perIteration).padStart(12)}`);
  console.log();
};

run();
