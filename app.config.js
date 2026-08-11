// Dynamic Expo config. Extends `app.json`, which Expo loads first and hands in here as
// `config`.
//
// The split works like this: **`app.json` holds what's constant** (name, identifiers, icons,
// plugins) — it's readable and can be inspected without running anything. **This file holds
// what either has to be computed, or needs an explanation** that JSON can't carry, since it
// has no comments. When changing anything here, remember that `expo prebuild` writes the
// result into `ios/` and `android/` — editing the file alone doesn't reach the device without
// a fresh prebuild (the Makefile runs one before every build).
//
// To preview the merged result of both files: `npx expo config --type public`.

// This file runs under Node, but the linter gets a set of React Native global names from
// `eslint-config-expo`, and `__dirname` isn't among them. The declaration below is cheaper
// than adding an exception to `eslint.config.js` — it's scoped to this one file and visible
// right where it's needed.
/* global __dirname */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
// A sub-export of the `expo` package, not a separate `@expo/config-plugins` dependency:
// installing it directly duplicated a package Expo already carries, and it was the only
// warning from `npx expo-doctor` (risk of version drift on an SDK bump).
const { withAppBuildGradle, withDangerousMod, withGradleProperties } = require('expo/config-plugins');

/**
 * Restores `INTERNET` in the **debug** variant.
 *
 * The released app doesn't need this permission (checked on the emulator: a build without it
 * still opens a scan of the Journal of Laws, because `expo-web-browser` launches Chrome Custom
 * Tabs, a separate process). But a debug build doesn't ship the JS bundle embedded — it fetches
 * it from Metro over `http://10.0.2.2:8081`, and that request is made by the app itself.
 * Without this permission, `npm run android` fails with "Could not connect to development
 * server", with no hint that the manifest is the cause.
 *
 * `blockedPermissions` acts on the main manifest, so we add the permission to the debug
 * manifest instead, where merging would otherwise overwrite it with `tools:node="remove"`.
 * Result: zero permissions in the store build, and development keeps working as before.
 */
function withInternetForDebug(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const file = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app/src/debug/AndroidManifest.xml',
      );
      const xml = fs.readFileSync(file, 'utf8');

      if (!xml.includes('android.permission.INTERNET')) {
        // The `<manifest …>` tag is sometimes wrapped across several lines and carries a
        // variable set of namespaces, so it's matched with a pattern, not a literal string.
        const opening = /<manifest\b[^>]*>/;
        if (!opening.test(xml)) {
          throw new Error(
            `Could not recognise the <manifest> tag in ${file} — the plugin restoring the`
              + ' INTERNET permission for the debug variant needs a look.',
          );
        }
        fs.writeFileSync(
          file,
          xml.replace(
            opening,
            (tag) => `${tag}\n    <uses-permission android:name="android.permission.INTERNET"/>`,
          ),
        );
      }
      return modConfig;
    },
  ]);
}

/**
 * Keep rules that R8 can't work out on its own.
 *
 * Both groups come from a release build that ran and misbehaved, not from a list found on the
 * internet. The symptoms are written down so nobody drops a rule to see what happens — the
 * build succeeds either way, and the damage only shows up on a device.
 */
const KEEP_MARKER = '# --- patent-strzelecki ---';

const KEEP_RULES = `${KEEP_MARKER}------------------------------------------------------

# React Native looks up a view manager's generated property setter by class name
# ("<ViewManager>$$PropsSetter"); when there is none it falls back to reflection over the
# manager's @ReactProp methods (FallbackViewManagerSetter in ViewManagerPropertyUpdater.kt).
# That fallback resolves each prop by name and does nothing at all when the name is missing
# from its map, which is why this breaks in silence: R8 renamed the manager and stripped the
# annotated methods, so every prop vanished without an error. Symptom: the lesson WebView
# rendered blank, because its "source" never arrived, and the footer collapsed under the
# header, because the view had no height.
#
# Do NOT use the log line "ViewManagerPropertyUpdater: Could not find generated setter" as the
# symptom, and do not read anything into an obfuscated class name in it either. A healthy
# release build logs it for 41 classes on every start. Nothing generates those setters here
# (neither mapping.txt nor usage.txt mentions a single $$PropsSetter, so R8 never saw one), so
# the fallback above is simply the normal path. The obfuscated names in that message are
# ReactShadowNode subclasses — findNodeSetter takes the same route — and renaming them is
# harmless, because the fallback resolves props by @ReactProp annotation rather than by class
# name. The rule below covers view managers; the annotation rule is what keeps both paths alive.
#
# The only real symptom is props not arriving on screen. To pin one down, build the control
# variant with -Pandroid.enableMinifyInReleaseBuilds=false and compare the same screen.
-keep class * extends com.facebook.react.uimanager.ViewManager { *; }
# Currently matches nothing, kept as insurance in case a future SDK does generate these.
-keep class **$$PropsSetter { *; }
-keepclassmembers class * {
  @com.facebook.react.uimanager.annotations.ReactProp <methods>;
}
-keepclassmembers class * {
  @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
}

# Expo modules publish their functions through reflection over Kotlin types, which R8 in full
# mode cannot follow. Expo ships rules for the module classes themselves, but not for
# everything those reach. Symptom: reading progress never loaded and the exercise list hung
# on "Liczę postęp…" for good — both database reads that failed without a word in the log,
# because the promise is consumed with "void" and nothing catches the rejection.
-keep class expo.modules.** { *; }

# Fresco decodes images in native code and registers its decoders by class, so R8 sees a
# reference to almost none of the pipeline: it removed 742 classes under
# com.facebook.imagepipeline, .drawee and .animated. React Native ships rules for
# @DoNotStrip and they are not enough — the members native code reaches indirectly carry no
# annotation. Symptom: every <Image> stayed blank, so lesson illustrations and the "Schemat"
# screen showed nothing at all, while the same build with minification switched off rendered
# them. That comparison is how this was pinned down; the build logs nothing.
-keep class com.facebook.imagepipeline.** { *; }
-keep class com.facebook.imageformat.** { *; }
-keep class com.facebook.drawee.** { *; }
-keep class com.facebook.animated.** { *; }
-keep class com.facebook.common.** { *; }
-dontwarn com.facebook.imagepipeline.**
`;

/**
 * Writes our keep rules into the generated \`proguard-rules.pro\`.
 *
 * A dangerous mod rather than a Gradle one, because the file is plain text owned by the
 * template.
 *
 * The block is **replaced**, not appended-once. Mods receive the file as the previous run left
 * it, so a plain "append if absent" would look idempotent and quietly stop working the moment
 * anyone edited \`KEEP_RULES\`: the marker is already there, so nothing gets written, and the
 * rule change only lands after \`make clean-native\`. Cutting everything from the marker down
 * and writing it again makes an edit here take effect on the next \`prebuild\`.
 */
function withKeepRules(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const file = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );
      const current = fs.readFileSync(file, 'utf8');
      const marker = current.indexOf(KEEP_MARKER);
      const template = marker === -1 ? current : current.slice(0, marker);
      fs.writeFileSync(file, `${template.trimEnd()}\n\n${KEEP_RULES}`);
      return modConfig;
    },
  ]);
}

/**
 * Turns R8 on for the release build: code shrinking plus resource shrinking.
 *
 * Version 0.1.0 shipped without either. The React Native template reads two Gradle
 * properties and defaults both to `false`, and nothing set them — so `minifyEnabled` was off
 * and the package carried every class name and every unused method the dependencies brought
 * along.
 *
 * Why a plugin and not an edit in `android/app/build.gradle`: that directory is generated by
 * `expo prebuild` and is not in the repository, so an edit there survives on one machine
 * until the next `make clean-native` and reaches nobody else. The same reasoning as
 * `withReleaseSigning`.
 *
 * Three deliberate choices, all from
 * developer.android.com/topic/performance/app-optimization/enable-app-optimization:
 *
 * - **both switches, not just the first.** Google's guidance is to enable code and resource
 *   shrinking together; resource shrinking needs `minifyEnabled` anyway.
 * - **`proguard-android-optimize.txt` instead of `proguard-android.txt`.** The plain file
 *   turns optimization passes off, which is half of what R8 is for. AGP 9.0 drops support for
 *   it outright, so this is also one less thing to fix at the next upgrade.
 * - **full mode stays on.** It is the default from AGP 8.0 (we build with 8.11) and nothing
 *   in `gradle.properties` disables it. Don't add `android.enableR8.fullMode=false`.
 *
 * `android.r8.optimizedResourceShrinking` is deliberately absent: it needs AGP 8.12, and the
 * React Native Gradle plugin pins 8.11. It becomes the default in AGP 9.0 anyway.
 *
 * R8 removes whatever it can't see a reference to, and it can't see reflection. Every native
 * dependency here ships keep rules of its own, and they are **not enough**: the first build
 * with R8 came out silently broken, and `KEEP_RULES` above is what it took to fix it. The only
 * real proof is a **release** build clicked through on a device — unit tests don't run R8, and
 * the build succeeds either way. If something breaks after an upgrade, read the class name out
 * of the stack trace and add a rule there; don't turn this back off.
 *
 * The deobfuscation map needs no uploading: with an AAB, Gradle packs `mapping.txt` into the
 * bundle as `BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map`, and Play
 * takes it from there. Manual upload is an APK-only chore.
 */

function withReleaseMinification(config) {
  const PROPERTIES = {
    'android.enableMinifyInReleaseBuilds': 'true',
    'android.enableShrinkResourcesInReleaseBuilds': 'true',
  };

  const withProperties = withGradleProperties(config, (modConfig) => {
    for (const [key, value] of Object.entries(PROPERTIES)) {
      const existing = modConfig.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );
      // Prebuild hands the mod the file left by the previous run, so an entry we wrote last
      // time is already there — set it in place instead of appending a second one, which
      // Gradle would read as a duplicate key.
      if (existing) existing.value = value;
      else modConfig.modResults.push({ type: 'property', key, value });
    }
    return modConfig;
  });

  return withAppBuildGradle(withProperties, (modConfig) => {
    const gradle = modConfig.modResults.contents;
    if (gradle.includes('proguard-android-optimize.txt')) return modConfig;

    // Matched with a pattern, not a literal: the template has changed quote style before, and
    // a plugin that throws over a swapped apostrophe would block the build for no reason.
    const plain = /getDefaultProguardFile\(\s*(['"])proguard-android\.txt\1\s*\)/;
    if (!plain.test(gradle)) {
      throw new Error(
        'Could not find the default ProGuard file in android/app/build.gradle — the'
          + ' minification plugin needs a look after a template change.',
      );
    }

    modConfig.modResults.contents = gradle.replace(
      plain,
      (_match, quote) => `getDefaultProguardFile(${quote}proguard-android-optimize.txt${quote})`,
    );
    return modConfig;
  });
}


/**
 * Signs the release build with the upload key instead of the template's debug key.
 *
 * The React Native template sets `release { signingConfig signingConfigs.debug }` and leaves
 * a comment reading "Caution! In production…". That key ships in every checkout of the
 * template on earth, so Google Play rejects a file signed with it.
 *
 * The fix lives here, not in `android/app/build.gradle`, because `android/` isn't in git.
 * A hand edit to the generated file would survive on this one Mac (prebuild patches an
 * existing directory in place, it doesn't regenerate it from scratch), but would exist
 * nowhere else: after `make clean-native`, on a fresh clone, or on someone else's machine,
 * the release build would silently fall back to the debug key. And the build would still
 * succeed either way — meaning the work would look done when it isn't. Signing config has
 * to live alongside the rest of the project config.
 *
 * The password and path come from the **environment**, not a file in the project: a password
 * sitting in the project tree eventually ends up in git. `make android-aab` supplies them,
 * pulling from the macOS keychain.
 *
 * When the variables are absent, the release build stays on the debug key — and that's the
 * intended behaviour, since a weekly `make android` to a personal phone has no reason to
 * prompt for the keychain. A "half-configured" state (a path with no password, or the other
 * way around) is treated as an error instead, since it would look like a real release
 * signature without being one.
 */
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let gradle = modConfig.modResults.contents;

    // Prebuild doesn't regenerate `android/` from scratch — mods receive the file from the
    // previous run, including whatever the plugin wrote in last time. Without this guard, a
    // second `make android` failed with "signingConfigs block not recognised", because the
    // pattern looked for `debug {` right after the block opens, and our own insert was
    // already sitting there.
    if (gradle.includes('PATENT_UPLOAD_STORE_FILE')) return modConfig;

    const signingConfigs = /signingConfigs\s*\{\s*\n(\s*)debug\s*\{/;
    if (!signingConfigs.test(gradle)) {
      throw new Error(
        'Could not recognise the signingConfigs block in android/app/build.gradle — the'
          + ' release-signing plugin needs a look after a template change.',
      );
    }

    gradle = gradle.replace(signingConfigs, (match, indent) => {
      const body = [
        `${indent}release {`,
        `${indent}    def store = System.getenv("PATENT_UPLOAD_STORE_FILE")`,
        `${indent}    def secret = System.getenv("PATENT_UPLOAD_PASSWORD")`,
        `${indent}    if (store != null && secret != null) {`,
        `${indent}        storeFile file(store)`,
        `${indent}        storePassword secret`,
        `${indent}        keyAlias System.getenv("PATENT_UPLOAD_KEY_ALIAS") ?: "upload"`,
        `${indent}        keyPassword secret`,
        `${indent}    } else if (store != null || secret != null) {`,
        `${indent}        throw new GradleException("The upload key is only half`
          + ` configured: PATENT_UPLOAD_STORE_FILE and PATENT_UPLOAD_PASSWORD must be`
          + ` set together. Use make android-aab.")`,
        `${indent}    }`,
        `${indent}}`,
        '',
      ].join('\n');
      return match.replace(/signingConfigs\s*\{\s*\n/, `signingConfigs {\n${body}`);
    });

    // Picking the key inside the variant itself. Anchored on `buildTypes`, because
    // `signingConfig signingConfigs.debug` appears twice — in the debug variant and in
    // release — and only the second one needs replacing.
    const releaseVariant = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseVariant.test(gradle)) {
      throw new Error(
        'Could not find the release variant signing config in android/app/build.gradle —'
          + ' the release-signing plugin needs a look after a template change.',
      );
    }

    gradle = gradle.replace(
      releaseVariant,
      '$1signingConfig System.getenv("PATENT_UPLOAD_PASSWORD") != null'
        + ' ? signingConfigs.release : signingConfigs.debug',
    );

    modConfig.modResults.contents = gradle;
    return modConfig;
  });
}

/**
 * Reads from git without ever failing the build.
 *
 * This config runs on every `expo prebuild`, `export` and `run:*`, so it also has to work
 * where the repository doesn't exist — an unpacked source archive, or a directory copied
 * without `.git`. Error output is silenced, because "fatal: not a git repository" on the
 * build console looks like a failure, when it's really an expected case with a fallback
 * value.
 */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The version shown in the store — from the latest `vX.Y.Z` tag.
 *
 * The tag is the source of truth instead of a number typed by hand, because an entry in a
 * file would have to be remembered anyway, while a tag stays in history and shows exactly
 * what shipped. The format is validated, not truncated: a tag like `content-2026-08` has no
 * business becoming a store version number, so in that case the value from `app.json` is
 * used instead.
 */
function storeVersion(fallback) {
  const tag = git('describe', '--tags', '--abbrev=0');
  const match = tag ? /^v?(\d+\.\d+\.\d+)$/.exec(tag) : null;
  return match ? match[1] : fallback;
}

/**
 * Build number — the number of commits in history.
 *
 * The App Store and Google Play both reject a repeated build number within a version, and
 * `prebuild` rewrites the config before every build, so a hardcoded `1` meant: the first
 * submission goes through, and every fix after it bounces off the store. Commit count grows
 * monotonically and requires remembering nothing.
 *
 * The fallback of `1` is for a build made outside the repository — you can't ship a fix to
 * the store from there, but the app still builds, which is the point.
 */
function buildCounter() {
  const parsed = Number.parseInt(git('rev-list', '--count', 'HEAD') ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * The commit this build was made from — together with a date and a dirty-tree marker.
 *
 * Why: the app's code is public, so anyone with the app on their phone can check which
 * version of the source they're holding. **This is identification, not proof** — the string
 * in the binary is only as trustworthy as whoever built it, and real verification means
 * comparing the file's signing fingerprint (`apksigner verify --print-certs`, documented in
 * the README). It still works independently for bug reports: it tells you what the
 * reporter's phone was built from.
 *
 * The `+` suffix for uncommitted changes is the important part here. Without it, a build made
 * from a workshop checkout would claim to be running code from the public repository — a lie
 * in exactly the situation someone would want to check it against. `git status` with no path
 * covers the whole repository, since the content bundle ships inside the app too.
 *
 * The date is the **commit date, not the build date**: the build date would write a different
 * value on every run, meaning two builds from the exact same code would differ in content —
 * which defeats the whole point of this line. The ISO format (`%cs`) sorts chronologically on
 * its own.
 */
function sourceCommit() {
  const head = git('rev-parse', '--short', 'HEAD');
  if (!head) return null;

  return {
    hash: git('status', '--porcelain') ? `${head}+` : head,
    date: git('log', '-1', '--format=%cs'),
  };
}

/**
 * Android permissions the app doesn't need, brought in by dependencies.
 *
 * Once this list is blocked, the app declares **zero permissions** — and that's meant to
 * stay true. None of them come from our own code: content ships in the bundle, writes go
 * only to a private directory (`Paths.document` in `src/content/materialize.ts`), and there
 * isn't a single `fetch`, XHR or WebSocket anywhere in `src/` or `app/`. OTA updates are
 * disabled. The worst one on this list is SYSTEM_ALERT_WINDOW: Google Play shows it as
 * "Display over other apps" and review asks for a justification that doesn't exist.
 *
 * INTERNET is also unneeded, which is less obvious, so it was **checked on the emulator**:
 * a build without this permission still opens a scan of the Journal of Laws and downloads
 * the PDF without a problem. On Android, `expo-web-browser` launches Chrome Custom Tabs — a
 * browser process with its own network access. If anything ever fetches data **inside** the
 * app (checking for bundle updates, remote legal acts), INTERNET will have to come back —
 * and that's the only reason it's allowed to be crossed off here.
 */
const UNUSED_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.VIBRATE',
];

module.exports = ({ config }) => {
  const build = buildCounter();
  const commit = sourceCommit();

  return withKeepRules(withReleaseMinification(withReleaseSigning(withInternetForDebug({
    ...config,
    version: storeVersion(config.version),
    // `extra` reaches the app as `Constants.expoConfig.extra` — the only way a value computed
    // at build time gets into the code without generating a source file. Split into fields
    // rather than joined into a string, because formatting belongs to the screen: the date
    // has to display in Polish, and here it stays in ISO.
    extra: {
      ...config.extra,
      commit: commit?.hash ?? null,
      commitDate: commit?.date ?? null,
    },
    ios: {
      ...config.ios,
      // iOS wants a string (CFBundleVersion), Android an integer — the same value in two
      // types, so the build number means the same thing on both platforms.
      buildNumber: String(build),
    },
    android: {
      ...config.android,
      versionCode: build,
      blockedPermissions: UNUSED_PERMISSIONS,
    },
  }))));
};
