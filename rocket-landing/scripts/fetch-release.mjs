#!/usr/bin/env node
// Pulls the latest GitHub release for Snehal1112/rocket and writes the
// per-platform direct-download asset URLs to src/data/release.json. Runs
// before dev/build so the download cards never point at a stale version.
// Keeps the previous file on failure (offline dev, rate limits) so the
// build still has a usable, if slightly stale, set of links.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Snehal1112/rocket';
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../src/data/release.json');

const ASSET_MATCHERS = {
  linux: (name) => name.endsWith('_amd64.deb'),
  macos: (name) => name.endsWith('_aarch64.dmg'),
  windows: (name) => name.endsWith('_x64-setup.exe'),
};

async function main() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} ${response.statusText}`);
  }
  const release = await response.json();

  const assets = {};
  for (const [platform, matches] of Object.entries(ASSET_MATCHERS)) {
    const asset = release.assets.find((candidate) => matches(candidate.name));
    if (!asset) {
      throw new Error(`No ${platform} asset found on release ${release.tag_name}`);
    }
    assets[platform] = {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
    };
  }

  const data = {
    version: release.tag_name.replace(/^v/, ''),
    tag: release.tag_name,
    publishedAt: release.published_at,
    htmlUrl: release.html_url,
    assets,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`[fetch-release] wrote ${data.tag} asset links to ${OUT_PATH}`);
}

main().catch(async (error) => {
  console.warn(`[fetch-release] could not refresh release data: ${error.message}`);
  try {
    await readFile(OUT_PATH, 'utf8');
    console.warn('[fetch-release] keeping existing src/data/release.json');
  } catch {
    console.error('[fetch-release] no existing src/data/release.json to fall back to — failing build');
    process.exit(1);
  }
});
