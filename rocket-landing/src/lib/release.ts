import releaseData from '@/data/release.json';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface ReleaseInfo {
  version: string;
  tag: string;
  publishedAt: string;
  htmlUrl: string;
  assets: {
    linux: ReleaseAsset;
    macos: ReleaseAsset;
    windows: ReleaseAsset;
  };
}

export const release: ReleaseInfo = releaseData;

export function formatAssetSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
