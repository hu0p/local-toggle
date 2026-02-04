![Local Toggle](screenshot.png)

A Chrome extension for developers who work with local development servers. Instantly swap between your local `.test` domain and production with a single click.

## Features

- **One-click toggle** — Click the extension icon to instantly switch between local and production
- **Preserves your path** — `/dashboard?tab=settings` stays intact when switching domains
- **Configurable TLDs** — Use any local TLD (`.test`, `.local`, `.dev`, etc.)
- **Protocol control** — Toggle HTTPS independently for local and production
- **Remembers settings** — Configuration is saved per-domain
- **Badge indicator** — Shows "L" when you're on a local domain

## Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder

## Usage

**First time setup:**
1. Visit your production site (e.g., `example.com`)
2. Click the extension icon — you'll be taken to `example.test`
3. That's it! The extension remembers the mapping

**Switching environments:**
- On production → Click icon → Go to local
- On local → Click icon → Go to production

**Configuring settings:**
- Right-click the extension icon → "Configure settings for this domain"
- Adjust TLDs and HTTPS settings as needed

**Clearing saved settings:**
- Right-click the extension icon → "Clear saved production TLD for this domain"

## How It Works

The extension extracts the base domain from your current URL and swaps the TLD while preserving the path, query parameters, and hash. Settings are stored per-domain using Chrome's storage API.

## Permissions

- `activeTab` — Access the current tab's URL
- `storage` — Save your TLD preferences
- `tabs` — Navigate to the swapped URL
- `contextMenus` — Right-click menu options

## Publishing

A GitHub Action automatically publishes to Chrome Web Store when you create a release.

**Setup (one-time):**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the **Chrome Web Store API**
3. Create OAuth 2.0 credentials (Desktop app)
4. Get a refresh token using [chrome-webstore-upload](https://github.com/nickytonline/chrome-webstore-upload-cli#setting-up-your-credentials)
5. Add these repository secrets in GitHub:
   - `EXTENSION_ID` — Your extension's ID from the Chrome Web Store
   - `CHROME_CLIENT_ID` — OAuth client ID
   - `CHROME_CLIENT_SECRET` — OAuth client secret
   - `CHROME_REFRESH_TOKEN` — OAuth refresh token

**To publish:** Create a new release on GitHub → Action runs automatically

## License

MIT
