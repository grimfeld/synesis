// What the download section can offer, read from the latest GitHub Release
// when the site is built. Downloads stay closed while the version is 0.0.x
// (the app is not ready to hand out yet), and a platform opens only once its
// file is attached to the Release: the release workflow builds for a while
// after the Release is created, and rebuilds this site when it is published.

export type PlatformId = "windows" | "macos" | "linux" | "android" | "ios";

/** Which Mac a macOS file is built for; the other platforms have one file. */
export type Variant = "appleSilicon" | "intel";

export interface PlatformFile {
  name: string;
  url: string;
  variant?: Variant;
}

export interface Platform {
  id: PlatformId;
  /**
   * The files to offer, the first one foremost, when downloads are open and
   * they are attached. Empty means "not yet".
   */
  files: PlatformFile[];
}

export interface Release {
  /** The app's version, without the "v": shown in the footer. */
  version: string;
  /** Whether downloads are open at all (version 0.1.0 or later). */
  open: boolean;
  platforms: Platform[];
}

const REPO = "grimfeld/synesis";

/**
 * The files each platform offers, by name, in the order shown. macOS has one
 * build per processor (no universal build), Apple Silicon first.
 */
const PICK: Record<PlatformId, { match: (name: string) => boolean; variant?: Variant }[]> = {
  windows: [{ match: (n) => n.endsWith("-setup.exe") }],
  macos: [
    { match: (n) => n.endsWith("_aarch64.dmg"), variant: "appleSilicon" },
    { match: (n) => n.endsWith("_x64.dmg"), variant: "intel" },
  ],
  linux: [{ match: (n) => n.endsWith(".AppImage") }],
  android: [{ match: (n) => n.endsWith(".apk") }],
  ios: [{ match: (n) => n.endsWith(".ipa") }],
};

const ORDER: PlatformId[] = ["windows", "macos", "linux", "android", "ios"];

/** 0.1.0 and later open the downloads; 0.0.x and anything unreadable do not. */
export function opensDownloads(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > 0 || minor >= 1;
}

export function fromRelease(tag: string, assets: { name: string; browser_download_url: string }[]): Release {
  const version = tag.replace(/^v/, "");
  const open = opensDownloads(version);
  return {
    version,
    open,
    platforms: ORDER.map((id) => ({
      id,
      files: open
        ? PICK[id].flatMap(({ match, variant }) => {
            const a = assets.find((x) => match(x.name));
            return a ? [{ name: a.name, url: a.browser_download_url, ...(variant && { variant }) }] : [];
          })
        : [],
    })),
  };
}

let cached: Promise<Release> | undefined;

/**
 * The latest Release, once per build. Offline or rate-limited, the page is
 * still built, with the downloads closed rather than pointing nowhere.
 */
export function latestRelease(): Promise<Release> {
  cached ??= (async () => {
    try {
      const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const j = (await r.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
      return fromRelease(j.tag_name, j.assets);
    } catch (e) {
      console.warn(`[release] downloads closed: ${e}`);
      return fromRelease("", []);
    }
  })();
  return cached;
}
