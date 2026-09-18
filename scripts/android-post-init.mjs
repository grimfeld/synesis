// Adjust the generated Android project after `tauri android init`.
//
// Tauri's template calls `enableEdgeToEdge()` and, with targetSdk 35+, Android
// draws the webview under the status bar and the keyboard: the app header
// sat under the clock and the bottom bar vanished behind the keyboard.
// Android's WebView does not expose safe-area insets to CSS, so the fix lives
// here: apply system-bar + keyboard insets as padding on the content view,
// and ask for `adjustResize` so keyboard insets are delivered.
//
// It also adds all-files access (ADR 0015) and the small Tauri plugin that
// checks and requests it, because a Vault must live where the Files app can
// browse it and Obsidian can open it.
//
// `src-tauri/gen/` is generated and gitignored, so everything the app needs in
// that project has to be re-applied here after every `init`. Idempotent
// (npm run android:post-init).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

// 1b. Manifest: all-files access, so a Vault can live in shared Documents
// where the Files app browses it and Obsidian can open it (ADR 0015). Without
// it the app still runs; Vaults fall back to its private storage.
if (!manifest.includes("MANAGE_EXTERNAL_STORAGE")) {
  const before = manifest;
  manifest = manifest.replace(
    /(<uses-permission android:name="android.permission.INTERNET"\s*\/>)/,
    '$1\n    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE" />',
  );
  if (manifest === before) {
    console.error("android-post-init: could not find the INTERNET permission in " + manifestPath);
    process.exit(1);
  }
  writeFileSync(manifestPath, manifest);
  console.log("android-post-init: AndroidManifest.xml -> MANAGE_EXTERNAL_STORAGE");
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

// 3. StoragePlugin: check and request all-files access, and report where the
// shared Documents folder is. Tauri's own PathPlugin only offers
// getExternalFilesDir(), which since Android 11 the Files app refuses to
// browse — the whole reason for ADR 0015.
const pluginDir = join(kotlinDir, ...(pkg ?? "tech.grimfeld.synesis").split("."));
const pluginPath = join(pluginDir, "StoragePlugin.kt");
if (!existsSync(pluginPath)) {
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    pluginPath,
    `package ${pkg ?? "tech.grimfeld.synesis"}

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

// Written by scripts/android-post-init.mjs; src-tauri/gen is regenerated.
@TauriPlugin
class StoragePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun isExternalStorageManager(invoke: Invoke) {
    val granted =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
      else true
    val res = JSObject()
    res.put("granted", granted)
    invoke.resolve(res)
  }

  // Opens the system page; the grant happens there, so the UI re-checks when
  // the window comes back.
  @Command
  fun requestExternalStorageManager(invoke: Invoke) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val intent =
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
          .setData(Uri.parse("package:" + activity.packageName))
      try {
        activity.startActivity(intent)
      } catch (e: Exception) {
        // Some builds have no per-app page; the full list always exists.
        activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
      }
    }
    invoke.resolve()
  }

  @Command
  fun getSharedDocumentsDir(invoke: Invoke) {
    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
    val res = JSObject()
    res.put("path", dir.absolutePath)
    invoke.resolve(res)
  }
}
`,
  );
  console.log("android-post-init: StoragePlugin.kt -> all-files access");
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
