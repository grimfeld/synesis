// Copy the app icons into the generated mobile projects.
//
// `tauri android init` / `tauri ios init` create `src-tauri/gen/{android,apple}`
// from Tauri's templates, which ship the default Tauri icon. They never read
// `src-tauri/icons/android` and `src-tauri/icons/ios` (where `tauri icon`
// writes the mobile variants when `gen/` does not exist yet), so the APK and
// IPA would carry the wrong icon. Run this after every `init`.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = join(root, "src-tauri");

const targets = [
  {
    name: "Android",
    from: join(tauri, "icons", "android"),
    to: join(tauri, "gen", "android", "app", "src", "main", "res"),
  },
  {
    name: "iOS",
    from: join(tauri, "icons", "ios"),
    to: join(tauri, "gen", "apple", "Assets.xcassets", "AppIcon.appiconset"),
  },
];

let copied = 0;
for (const { name, from, to } of targets) {
  if (!existsSync(from)) {
    console.warn(`${name}: no icons in ${from}, run \`npm run tauri icon\` first`);
    continue;
  }
  if (!existsSync(to)) {
    console.log(`${name}: project not generated (${to}), skipping`);
    continue;
  }
  cpSync(from, to, { recursive: true, force: true });
  console.log(`${name}: icons copied to ${to}`);
  copied++;
}

if (process.argv.includes("--strict") && copied !== targets.length) {
  console.error("Expected every mobile project to receive icons.");
  process.exit(1);
}
