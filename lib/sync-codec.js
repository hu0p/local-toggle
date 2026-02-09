import {
  VERSION,
  DELIMITER,
  SUB_DELIMITER,
  DEFAULT_TLDS,
  DEFAULT_TITLES,
} from './constants.js';

/**
 * Serialize a domain config object into a spec-format entry string.
 *
 * @param {{ envCount: number, environments: Array<{ tls: boolean, tld: string, port: number, title: string }>, hostnameDivergence: boolean, hostnames: string[] }} config
 * @returns {string}
 */
export const serialize = (config) => {
  const { envCount, environments, hostnameDivergence, hostnames } = config;

  const flags = environments.map((env, i) => {
    const defaultTld = DEFAULT_TLDS[i] ?? '.com';
    const defaultTitle = DEFAULT_TITLES[i] ?? `Environment ${i + 1}`;
    const defaultPort = env.tls ? 443 : 80;

    const customTld = env.tld !== defaultTld;
    const customPort = env.port !== defaultPort;
    const customTitle = env.title !== defaultTitle;

    return `${env.tls ? 1 : 0}${customTld ? 1 : 0}${customPort ? 1 : 0}${customTitle ? 1 : 0}`;
  }).join('');

  const envValues = environments.map((env, i) => {
    const defaultTld = DEFAULT_TLDS[i] ?? '.com';
    const defaultTitle = DEFAULT_TITLES[i] ?? `Environment ${i + 1}`;
    const defaultPort = env.tls ? 443 : 80;

    const parts = [];
    if (env.tld !== defaultTld) parts.push(env.tld);
    if (env.port !== defaultPort) parts.push(String(env.port));
    if (env.title !== defaultTitle) parts.push(env.title);
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

/**
 * Deserialize a spec-format entry string into a config object.
 *
 * @param {string} entry
 * @returns {{ version: string, envCount: number, environments: Array<{ tls: boolean, tld: string, port: number, title: string }>, hostnameDivergence: boolean, hostnames: string[] }}
 */
export const deserialize = (entry) => {
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

/**
 * Compress an array of entry strings using deflate + base64.
 * Uses the native CompressionStream API available in Chrome service workers.
 *
 * @param {string[]} entries
 * @returns {Promise<string>}
 */
export const compress = async (entries) => {
  const json = JSON.stringify(entries);
  const input = new TextEncoder().encode(json);

  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(input);
  writer.close();

  const chunks = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return btoa(String.fromCharCode(...merged));
};

/**
 * Decompress a base64-encoded deflate string back into an array of entry strings.
 *
 * @param {string} b64
 * @returns {Promise<string[]>}
 */
export const decompress = async (b64) => {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));

  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const json = new TextDecoder().decode(merged);
  return JSON.parse(json);
};
