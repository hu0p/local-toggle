# Sync Storage Format Specification

**Version:** 0
**Status:** Draft

## Overview

This document specifies the serialization format used to persist domain toggle configurations in `chrome.storage.sync`, enabling cross-device synchronization for signed-in Chrome users. The format is designed to maximize storage density within Chrome's sync storage quotas while remaining human-readable before compression.

When the user is not signed into Chrome, `chrome.storage.sync` falls back to local-only behavior, making this a progressive enhancement with no functional cost.

## Architecture

### Storage Layers

| Layer | API | Purpose |
|---|---|---|
| Hot Cache | `chrome.storage.session` | Fast per-key lookups during the current browser session |
| Persistent Sync | `chrome.storage.sync` | Compressed, cross-device persistence |

### Data Flow

**Read (hot path):**
1. Check `chrome.storage.session` for the domain key
2. On hit, return immediately

**Read (cold miss):**
1. `chrome.storage.sync.get(null)` — fetch all bucket keys in a single IPC call
2. Decompress: base64 decode → inflate → JSON parse
3. Linear scan for the matching domain (~0.07ms worst case at 2,700 entries)
4. Hydrate result into `chrome.storage.session`
5. All subsequent lookups for this domain hit the hot cache

**Write:**
1. Write to `chrome.storage.session` immediately (per-key)
2. Update the relevant `chrome.storage.sync` bucket asynchronously:
   - Read the bucket
   - Decompress, modify, recompress
   - Write back

## Chrome Sync Storage Quotas

| Constraint | Limit |
|---|---|
| Total storage | 102,400 bytes (100 KB) |
| Per-item size | 8,192 bytes (8 KB) |
| Maximum items | 512 |
| Write operations | 120 per minute |

### Bucket Strategy

Entries are distributed across bucket keys (`b0`, `b1`, ..., `b12`) to stay within the 8 KB per-item limit while utilizing the full 100 KB quota. Each bucket contains a base64-encoded, deflate-compressed JSON array of serialized entry strings.

```
chrome.storage.sync = {
  "b0": "<base64(deflate(JSON string[]))>",
  "b1": "<base64(deflate(JSON string[]))>",
  ...
}
```

Compression uses the native `CompressionStream` API (deflate), available in Chrome service workers since Chrome 80. No external dependencies are required.

## Entry Format

Each entry is a single string representing one domain's configuration across all of its environments.

### Structure

```
<version>|<envCount>|<flags>|<hostCheck>|<env1 values>|<env2 values>|...|<hostnames>
```

### Delimiters

- **Pipe** (`|`): Delimiter — separates major sections
- **Caret** (`^`): Sub-delimiter — separates values within a section

Both characters are invalid in DNS hostnames per RFC 952, eliminating any need for escaping.

### Sections

#### Version

Single field. Current version: `0`.

Delimited from the next section to support multi-character version identifiers in the future.

#### Environment Count

The number of environments configured for this domain. Determines how many flag groups and value sections follow.

Delimited from the flags section to support counts above 9.

#### Flags

A contiguous string of binary digits. Each environment contributes a fixed-width group of 4 flags, read left to right:

| Position | Flag | Meaning when `1` | Meaning when `0` |
|---|---|---|---|
| 1 | TLS | https | http |
| 2 | Custom TLD | Custom TLD value follows | Use default TLD |
| 3 | Custom Port | Custom port value follows | Use default port |
| 4 | Custom Title | Custom title value follows | Use default title |

The total flag string length is always `envCount * 4`.

#### Hostname Divergence

Single binary digit after the flags section.

| Value | Meaning |
|---|---|
| `0` | All environments share one hostname. A single hostname follows in the hostnames section. |
| `1` | Environments have different hostnames. One hostname per environment follows, ordered to match the environment flag order. |

#### Environment Values

One section per environment, separated by `|`. Within each section, values are separated by `^` and appear in flag order (TLD, then port, then title), but only when the corresponding flag is `1`.

**Examples:**

| Flags | Values Section | Explanation |
|---|---|---|
| `1000` | *(empty — no values)* | https, all defaults |
| `0000` | *(empty — no values)* | http, all defaults |
| `1110` | `.staging^8080` | https, custom TLD and port, default title |
| `1111` | `.local^3000^Dev` | https, custom TLD, port, and title |
| `0010` | `3000` | http, custom port only |
| `1001` | `Staging` | https, custom title only |

#### Hostnames

The final section contains domain base hostnames (hostname without TLD, always ending with `.`).

When hostname divergence is `0`: a single hostname.
When hostname divergence is `1`: one hostname per environment, separated by `^`, ordered to match environment flag order.

## Defaults

### Environment Ordering

Environments must follow this ordering convention:

| Position | Role |
|---|---|
| Environment 1 | Local development |
| Environment 2 | Production |
| Environment 3+ | Additional environments |

### Default TLDs

| Environment | Default TLD |
|---|---|
| Environment 1 | `.test` |
| Environment 2 | `.com` |
| Environment 3+ | `.com` |

When the Custom TLD flag is `0`, the parser applies the default TLD for that environment's position.

### Default Ports

Derived from the TLS flag:

| TLS Flag | Default Port |
|---|---|
| `1` (https) | 443 |
| `0` (http) | 80 |

When the Custom Port flag is `0`, the parser derives the port from the TLS flag.

### Default Titles

| Environment | Default Title |
|---|---|
| Environment 1 | "Local" |
| Environment 2 | "Production" |
| Environment 3+ | "Environment N" (where N is the position) |

When the Custom Title flag is `0`, the parser applies the default title for that environment's position.

## Examples

### Minimal (Two Environments, All Defaults)

A local `.test` / production `.com` toggle with shared hostname, http local, https production.

```
0|2|00001000|0|myapp.
```

Parsed:
- Version: 0
- 2 environments
- Environment 1 flags `0000`: http, .test, port 80, "Local"
- Environment 2 flags `1000`: https, .com, port 443, "Production"
- Hostname divergence: 0 (shared)
- Shared hostname: `myapp.`

### Three Environments, All Defaults

```
0|3|000010001000|0|myapp.
```

Parsed:
- Version: 0
- 3 environments
- Environment 1 flags `0000`: http, .test, port 80, "Local"
- Environment 2 flags `1000`: https, .com, port 443, "Production"
- Environment 3 flags `1000`: https, .com, port 443, "Environment 3"
- Hostname divergence: 0 (shared)
- Shared hostname: `myapp.`

### Three Environments, Fully Custom

```
0|3|111110101110|1|Dev^.local^3000|Prod|Staging^.staging|localapp.^myapp.^stagingapp.
```

Parsed:
- Version: 0
- 3 environments
- Environment 1 flags `1111`: https, .local, port 3000, "Dev"
- Environment 2 flags `1010`: https, .com (default), port 443 (default), "Prod"
- Environment 3 flags `1110`: https, .staging, port 443 (default), "Environment 3" (default)
- Hostname divergence: 1 (different)
- Hostnames: `localapp.`, `myapp.`, `stagingapp.`

### Custom Local Port Only

```
0|2|00101000|0|myapp.
```

Parsed:
- Version: 0
- 2 environments
- Environment 1 flags `0010`: http, .test, custom port (value follows), "Local"
- Environment 2 flags `1000`: https, .com, port 443, "Production"
- Hostname divergence: 0 (shared)
- Shared hostname: `myapp.`

*Note: This example is missing the port value section for environment 1. A complete entry would be:*

```
0|2|00101000|0|3000|myapp.
```

## Capacity

### Without Compression

Constrained by the 8 KB per-item limit (single bucket):

| Scenario | Bytes per Entry | Domains per Bucket |
|---|---|---|
| Typical (short hostname, defaults) | ~15 | ~546 |
| Worst case (long hostname, defaults) | ~37 | ~221 |
| Fully custom (long hostname) | ~87 | ~94 |

### With Compression (Deflate + Base64)

Using all 13 buckets (100 KB total), deflate achieves ~80% reduction on typical data:

| Scenario | Estimated Capacity |
|---|---|
| Typical | ~13,000+ domains |
| Worst case | ~5,000+ domains |

### Comparison with Flat Key Storage

| Approach | Worst Case Domains |
|---|---|
| Current (4 flat keys per domain) | 128 |
| Packed format, no compression | ~2,700 |
| Packed format, deflate + base64 | ~13,000+ |

## Diagram

See [format.svg](./format.svg) for a visual representation of the entry format, including flag breakdowns, default values, and delimiter usage.
