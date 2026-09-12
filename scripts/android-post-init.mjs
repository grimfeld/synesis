// Adjust the generated Android project after `tauri android init`.
//
// Tauri's template calls `enableEdgeToEdge()` and, with targetSdk 35+, Android
// draws the webview under the status bar and the keyboard: the app header
// sat under the clock and the bottom bar vanished behind the keyboard.
// Android's WebView does not expose safe-area insets to CSS, so the fix lives
// here: apply system-bar + keyboard insets as padding on the content view,
// and ask for `adjustResize` so keyboard insets are delivered.
//
// Idempotent; run after every `init` (npm run android:post-init).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const android = join(root, "src-tauri", "gen", "android", "app", "src", "main");
if (!existsSync(android)) {
  console.log("android-post-init: no src-tauri/gen/android, nothing to do");
  process.exit(0);
}

// 1. Manifest: keyboard resizes the window instead of panning.
const manifestPath = join(android, "AndroidManifest.xml");
let manifest = readFileSync(manifestPath, "utf8");
if (!manifest.includes("android:windowSoftInputMode")) {
  const before = manifest;
  manifest = manifest.replace(/<activity(\r?\n)(\s*)android:configChanges/, '<activity$1$2android:windowSoftInputMode="adjustResize"$1$2android:configChanges');
  if (manifest === before) {
    console.error("android-post-init: could not find the main <activity> element in " + manifestPath);
    process.exit(1);
  }
  writeFileSync(manifestPath, manifest);
  console.log("android-post-init: AndroidManifest.xml -> windowSoftInputMode=adjustResize");
}

// 2. MainActivity: pad the content view by the system bars and the keyboard.
const pkg = /package="([^"]+)"/.exec(manifest)?.[1];
const kotlinDir = join(android, "java");
const activity = findFile(kotlinDir, "MainActivity.kt");
if (!activity) {
  console.error("android-post-init: MainActivity.kt not found under " + kotlinDir);
  process.exit(1);
}
let kt = readFileSync(activity, "utf8");
if (!kt.includes("setOnApplyWindowInsetsListener")) {
  const packageLine = /^package .*$/m.exec(kt)?.[0] ?? (pkg ? `package ${pkg}` : "");
  kt = `${packageLine}

import android.os.Bundle
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Keep the web content out from under the status bar, the navigation bar
    // and the keyboard. Android's WebView gives CSS no safe-area insets, so
    // the padding is applied here (scripts/android-post-init.mjs).
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }
}
`;
  writeFileSync(activity, kt);
  console.log("android-post-init: MainActivity.kt -> window insets as padding");
}

function findFile(dir, name) {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (entry === name) return p;
  }
  return null;
}
