import { existsSync, rmSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

if (process.platform !== "linux") {
  console.error("The AppImage build must run on Linux.");
  process.exit(1);
}

function executableOnPath(name) {
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    const candidate = resolve(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const pkgconf = executableOnPath("pkgconf") || executableOnPath("pkg-config");
if (!pkgconf) {
  console.error("pkgconf or pkg-config is required to build the AppImage.");
  process.exit(1);
}

const pixbufDirectory = spawnSync(
  pkgconf,
  ["--variable=gdk_pixbuf_binarydir", "gdk-pixbuf-2.0"],
  { encoding: "utf8" },
);
const declaredPixbufDirectory = pixbufDirectory.status === 0
  ? pixbufDirectory.stdout.trim()
  : "";
const needsPixbufCompat = !declaredPixbufDirectory || !existsSync(declaredPixbufDirectory);

const env = { ...process.env, NO_STRIP: "1" };
if (needsPixbufCompat) {
  // gdk-pixbuf 2.44 delegates decoding to glycin and no longer installs the
  // historical loader directory. Tauri's current linuxdeploy GTK plugin still
  // treats that directory as mandatory. The pkgconf shim supplies an empty,
  // package-local compatibility directory without modifying /usr or Tauri's
  // downloaded plugin.
  env.RECALLSTACK_APPIMAGE_GDK_PIXBUF_COMPAT = "1";
  env.RECALLSTACK_REAL_PKGCONF = pkgconf;
  env.PATH = `${resolve(root, "scripts/appimage-tools")}${delimiter}${env.PATH}`;
  console.warn(
    `gdk-pixbuf loader directory is absent (${declaredPixbufDirectory || "not reported"}); `
    + "enabling the gdk-pixbuf 2.44 AppImage compatibility shim.",
  );
}

const tauriCli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js");
const compatibilityDirectories = [
  resolve(root, ".recallstack-appimage-compat"),
  resolve(root, "src-tauri/.recallstack-appimage-compat"),
];
for (const directory of compatibilityDirectories) rmSync(directory, { recursive: true, force: true });

let result;
try {
  result = spawnSync(
    process.execPath,
    [tauriCli, "build", "--bundles", "appimage", "--ci", "--no-sign", "--", "--locked"],
    { cwd: root, env, stdio: "inherit" },
  );
} finally {
  for (const directory of compatibilityDirectories) rmSync(directory, { recursive: true, force: true });
}

if (result.error) console.error("Could not start the AppImage build:", result.error);
process.exit(result.status ?? 1);
