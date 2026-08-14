# Patent Strzelecki — shortcuts for everything you don't want to remember.
# `make` with no arguments prints the list.

# Device to install onto. Override it for one run: make ios DEVICE="iPhone 17 Pro"
# (works for simulators too). Names of connected devices: make doctor
#
# The default comes from the environment (`PATENT_DEVICE` in the shell profile), because
# a private phone's name has no business being in a public repository.
DEVICE ?= $(PATENT_DEVICE)

# Android SDK directory. The Makefile calls tools by their full path, so nothing needs
# adding to PATH. We export `ANDROID_HOME` because that's what Gradle and the Expo CLI
# look for (to find adb) — this way the build works without any shell profile changes.
ANDROID_SDK ?= $(HOME)/Library/Android/sdk
export ANDROID_HOME = $(ANDROID_SDK)

# Upload key for Google Play. The file lives **outside the repository**, because `android/`
# gets regenerated on every prebuild, and a key sitting in the project tree eventually ends
# up in git. The password sits in the macOS keychain under a service name — Gradle never
# sees it in a file, it gets it as an environment variable from `make android-aab`.
#
# Both come from the environment: the repository is public, and the key's location on disk
# and the keychain entry's name are hints for where to look if someone got into the Mac.
# Set them once, in the shell profile (`PATENT_UPLOAD_KEYSTORE`, `PATENT_UPLOAD_KEYCHAIN_ITEM`).
UPLOAD_KEYSTORE      ?= $(PATENT_UPLOAD_KEYSTORE)
UPLOAD_KEYCHAIN_ITEM ?= $(PATENT_UPLOAD_KEYCHAIN_ITEM)

# Distinguished name baked into the upload key by `android-key`. Defaults to the local
# username rather than a hardcoded person, since anyone who forks this repository and runs
# that target ends up owning the keystore, not the original author.
KEY_DNAME ?= CN=$(USER), OU=patent-strzelecki, O=patent-strzelecki, C=PL

# The package that goes to Google Play, and the file describing the content bundle that's
# currently in the working tree. `aab-content` compares the two.
AAB              := android/app/build/outputs/bundle/release/app-release.aab
CONTENT_MANIFEST := assets/content/manifest.json

.DEFAULT_GOAL := help
.PHONY: help setup \
        typecheck lint check start start-clean bundle ios ios-sim prebuild \
        android android-aab aab-content drop-stale-bundle \
        android-key android-avd android-emu prebuild-android version \
        icons icons-write doctor clean clean-native

help: ## This list
	@printf '\nPatent Strzelecki\n\n'
	@grep -hE '^[a-z][a-z-]*:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@printf '\nDevice for make ios: "%s"  (override: make ios DEVICE="...")\n\n' '$(DEVICE)'

# ── Setup ────────────────────────────────────────────────────────────────────

setup: ## Install app dependencies
	npm install --legacy-peer-deps

# ── Quality checks ───────────────────────────────────────────────────────────

check: typecheck lint test ## Types, linter and all tests — before a commit

test: ## App logic tests
	npx vitest run

typecheck: ## TypeScript, no emit
	npx tsc --noEmit

# Bug-catching rules are errors, line length is a warning — see the comment in
# eslint.config.js. That's why `check` passes despite warnings.
lint: ## ESLint — bug-catching rules plus line length
	npx eslint .

bundle: ## Check that the app bundles (without installing it)
	npx expo export --platform ios --output-dir /tmp/patent-bundle-check
	@rm -rf /tmp/patent-bundle-check
	@echo "Bundles fine."

# ── Development ──────────────────────────────────────────────────────────────

start: ## Metro dev server (for a debug build)
	npx expo start

start-clean: ## Dev server with the Metro cache cleared
	npx expo start --clear

# ── Version ──────────────────────────────────────────────────────────────────

# The numbers aren't written into config, they're computed from git (see app.config.js),
# so the only way to check what will actually ship to the store is to ask Expo. Worth
# checking right after creating a tag: a typo in the tag passes without a word, and the
# version falls back to the one in app.json.
version: ## Numbers the build will ship with (version from the tag, build from commit count)
	@printf 'git tag      %s\n' "$$(git describe --tags --abbrev=0 2>/dev/null || echo '(none — falling back to app.json version)')"
	@npx expo config --type public --json \
	  | node -pe "const c = JSON.parse(require('fs').readFileSync(0, 'utf8')); \
	      ['version      ' + c.version, \
	       'iOS build    ' + c.ios.buildNumber, \
	       'versionCode  ' + c.android.versionCode].join('\n')"

# ── Installing on the phone ──────────────────────────────────────────────────

# prebuild is a dependency on purpose. Icons and config (app.json plus app.config.js) are
# compiled into the native project, so without a fresh prebuild the build uses whatever
# landed in ios/ on the first run — and an icon change has no effect at all. The same goes
# for the build number: without prebuild, every install ships with the old number.
# prebuild preserves the signing team setting, so there's no need to go back into Xcode.
ios: prebuild ## Release build and install on the iPhone (works afterwards without a laptop)
	@test -n '$(DEVICE)' || { \
	  printf 'Not sure what to install onto. Set PATENT_DEVICE in your shell profile\n'; \
	  printf 'or pass it for one run: make ios DEVICE="device name"\n'; \
	  printf 'Names of connected devices: make doctor\n'; exit 1; }
	npx expo run:ios --device "$(DEVICE)" --configuration Release

ios-sim: prebuild ## Release build on the simulator — a quick check before installing on the phone
	npx expo run:ios --device "iPhone 17 Pro" --configuration Release

prebuild: ## Copy config and icons into the native ios/ project
	npx expo prebuild -p ios

# ── Android ──────────────────────────────────────────────────────────────────

# The emulator has to already be running — start it with make android-emu or from the
# Device Manager in Android Studio. `expo run:android` picks whichever device is connected
# on its own, so this one target installs onto both an emulator and a physical phone.
android: prebuild-android drop-stale-bundle ## Release build onto the emulator or a connected Android phone
	npx expo run:android --variant release

# Gradle keeps the JS bundle it compiled last time under android/app/build, and decides
# whether that task is up to date from its own inputs — not from assets/content/content.json.
# A refreshed content bundle therefore doesn't invalidate anything, and the build reuses the
# JS from the previous run: 0.2.0 shipped content three days older than the one on disk, an
# hour after a successful refresh.
#
# That failure has no symptom to notice. `make check` passes, Gradle reports success, the
# signature is right, and the divergence exists only between the working tree and the
# artefact — so nothing along the way can see it. Hence the deletion here rather than a
# reminder somewhere: the cost is one JS bundle recompiled from scratch, and the alternative
# is a store release with stale course content.
drop-stale-bundle:
	@rm -rf android/app/build/generated/assets/createBundleReleaseJsAndAssets \
	        android/app/build/intermediates/assets/release

# Google Play doesn't accept an APK from a new app — only an Android App Bundle. As a bonus,
# AAB splits the package into per-device variants, so a phone downloads one architecture
# instead of two: roughly half of 81 MB instead of the whole thing.
#
# The checks before Gradle are deliberate: without the key, the release build **silently**
# falls back to the debug signature (see the plugin in app.config.js) and you'd end up with
# a file Play won't accept, finding out only from Play itself. Better to stop right here and
# say what's missing.
android-aab: prebuild-android drop-stale-bundle ## AAB package for Google Play (signed with the upload key)
	@test -n '$(UPLOAD_KEYSTORE)' -a -n '$(UPLOAD_KEYCHAIN_ITEM)' || { \
	  printf 'Not sure where the upload key lives.\n'; \
	  printf 'Set in your shell profile: PATENT_UPLOAD_KEYSTORE and PATENT_UPLOAD_KEYCHAIN_ITEM\n'; \
	  exit 1; }
	@test -f '$(UPLOAD_KEYSTORE)' || { \
	  printf 'No upload key: %s\nCreate it once: make android-key\n' '$(UPLOAD_KEYSTORE)'; \
	  exit 1; }
	@security find-generic-password -s '$(UPLOAD_KEYCHAIN_ITEM)' -w >/dev/null 2>&1 || { \
	  printf 'No password in the keychain (service: %s).\nCreate it once: make android-key\n' \
	    '$(UPLOAD_KEYCHAIN_ITEM)'; exit 1; }
	cd android && \
	  PATENT_UPLOAD_STORE_FILE='$(UPLOAD_KEYSTORE)' \
	  PATENT_UPLOAD_PASSWORD="$$(security find-generic-password -s '$(UPLOAD_KEYCHAIN_ITEM)' -w)" \
	  ./gradlew bundleRelease
	@printf '\nAAB: %s\n' '$(AAB)'
	@printf 'Signed by:\n'
	@keytool -printcert -jarfile '$(AAB)' | grep -m1 'Owner:' || true
	@$(MAKE) --no-print-directory aab-content

# Reads the content version out of the **package**, not out of the working tree. Those are
# two different questions, and the whole point of this target is the case where they disagree
# (see the comment on drop-stale-bundle). Worth running on its own before every upload to
# Play: it costs a second and answers "what is actually in the file I'm sending".
#
# Two traps live in the grep. The Hermes bytecode is a binary file, so without `-a` BSD grep
# reports no match even for a string that's there — a false alarm indistinguishable from the
# problem this looks for. And it works at all only because a version hash and a timestamp are
# ASCII: Polish strings sit in that bundle as UTF-16, so searching for them as UTF-8 finds
# nothing and looks like a missing feature.
aab-content: ## What content the built AAB carries (also runs at the end of android-aab)
	@test -f '$(AAB)' || { \
	  printf 'No package: %s\nBuild it first: make android-aab\n' '$(AAB)'; exit 1; }
	@test -f '$(CONTENT_MANIFEST)' || { \
	  printf 'No content bundle: %s\nSee "Skąd się bierze treść" in README.md\n' '$(CONTENT_MANIFEST)'; \
	  exit 1; }
	@# Both values have to be non-empty before they reach grep, and the manifest is read by a
	@# node that throws rather than printing `undefined`. Without this the check reports success
	@# on a manifest missing a field: `grep -F ''` matches any file at all, and the string
	@# "undefined" is present in every JS bundle — so it would announce OK having compared
	@# nothing. A check that can only pass is worse than no check, and it fails exactly the way
	@# the build it guards used to.
	@META=$$(node -pe "const m = JSON.parse(require('fs').readFileSync('$(CONTENT_MANIFEST)', 'utf8')); \
	     if (!m.version || !m.scrapedAt) throw new Error('incomplete manifest'); \
	     m.version + ' ' + m.scrapedAt" 2>/dev/null); \
	 set -- $$META; \
	 test $$# -eq 2 || { \
	   printf 'No content version in %s — the file is damaged or incomplete.\n' '$(CONTENT_MANIFEST)'; \
	   printf 'Rebuild the content bundle; see "Skąd się bierze treść" in README.md\n'; exit 1; }; \
	 JS=$$(mktemp); \
	 unzip -p '$(AAB)' base/assets/index.android.bundle > "$$JS" 2>/dev/null || { \
	   printf 'No JS bundle inside the package (base/assets/index.android.bundle).\n'; \
	   rm -f "$$JS"; exit 1; }; \
	 printf 'Content on disk: %s  (scraped %s)\n' "$$1" "$$2"; \
	 if grep -aqF "$$1" "$$JS" && grep -aqF "$$2" "$$JS"; then \
	   rm -f "$$JS"; printf 'Content in AAB:  the same — OK\n'; \
	 else \
	   rm -f "$$JS"; \
	   printf 'Content in AAB:  SOMETHING ELSE\n\n'; \
	   printf 'The package carries a different content bundle than assets/content.\n'; \
	   printf 'Build it again — make android-aab drops the stale JS bundle first.\n'; \
	   exit 1; \
	 fi

# Once in the app's lifetime. This is the **upload** key, not the signing key: with Play App
# Signing, the real signing key is held by Google, and this one only confirms that it's you
# uploading the package. So losing it isn't fatal for the app — it gets replaced through a
# request to Play.
#
# The password is generated randomly and lands straight in the keychain: it's never in shell
# history, never in a file in the project, and never something you have to remember.
android-key: ## Create the Google Play upload key (once in the app's lifetime)
	@test -n '$(UPLOAD_KEYSTORE)' -a -n '$(UPLOAD_KEYCHAIN_ITEM)' || { \
	  printf 'Not sure where to create the key.\n'; \
	  printf 'Set in your shell profile: PATENT_UPLOAD_KEYSTORE and PATENT_UPLOAD_KEYCHAIN_ITEM\n'; \
	  exit 1; }
	@test ! -f '$(UPLOAD_KEYSTORE)' || { \
	  printf 'Key already exists: %s\nNot overwriting — losing this file would be a real problem.\n' \
	    '$(UPLOAD_KEYSTORE)'; exit 1; }
	@mkdir -p '$(dir $(UPLOAD_KEYSTORE))' && chmod 700 '$(dir $(UPLOAD_KEYSTORE))'
	@# The key is created under a temporary name and only gets its real name once the
	@# password is already in the keychain. The reverse order left a file with a password
	@# that lives nowhere else behind whenever the keychain write failed (locked keychain,
	@# a dismissed prompt) — and then `android-key` refuses to overwrite it, `android-aab`
	@# refuses to build, and the only way out is deleting the file by hand.
	@NEW='$(UPLOAD_KEYSTORE).new'; rm -f "$$NEW"; \
	 SECRET=$$(openssl rand -base64 24) && \
	 keytool -genkeypair -v -keystore "$$NEW" -alias upload \
	   -keyalg RSA -keysize 2048 -validity 10000 \
	   -storepass "$$SECRET" -keypass "$$SECRET" \
	   -dname '$(KEY_DNAME)' >/dev/null && \
	 security add-generic-password -a "$$USER" -s '$(UPLOAD_KEYCHAIN_ITEM)' -w "$$SECRET" -U && \
	 mv "$$NEW" '$(UPLOAD_KEYSTORE)' && chmod 600 '$(UPLOAD_KEYSTORE)' \
	 || { rm -f "$$NEW"; \
	      printf 'Failed to create the key. Nothing was changed.\n'; exit 1; }
	@printf 'Key:      %s\nPassword: macOS keychain, service "%s"\nValid:    %s\n' \
	  '$(UPLOAD_KEYSTORE)' '$(UPLOAD_KEYCHAIN_ITEM)' \
	  "$$(keytool -list -v -keystore '$(UPLOAD_KEYSTORE)' \
	      -storepass "$$(security find-generic-password -s '$(UPLOAD_KEYCHAIN_ITEM)' -w)" \
	      2>/dev/null | grep -m1 'until:' | sed 's/.*until: //')"
	@printf '\nBack up the key file somewhere other than this Mac. Without it you can'\''t ship\n'
	@printf 'an update until you replace the upload key through a request to Google Play.\n'

# Rebuilding the emulator, in case the SDK ever needs a clean reinstall. `avdmanager`
# throws an error about devices.xml here — it's harmless, the device profile loads fine.
android-avd: ## Create the "patent" emulator (Pixel 9, API 36, arm64)
	echo no | $(ANDROID_SDK)/cmdline-tools/latest/bin/avdmanager create avd \
	  --name patent --device pixel_9 --force \
	  --package "system-images;android-36;google_apis_playstore;arm64-v8a"
	@sed -i '' -e 's/^hw.keyboard=no/hw.keyboard=yes/' -e 's/^hw.ramSize=2G/hw.ramSize=4096/' \
	  $(HOME)/.android/avd/patent.avd/config.ini
	@printf 'Done. Host keyboard enabled, RAM raised to 4 GB.\n'

android-emu: ## Start the first emulator from the AVD list (in the background)
	@if [ ! -x $(ANDROID_SDK)/emulator/emulator ]; then \
	  printf 'No emulator under %s\n' '$(ANDROID_SDK)'; \
	  printf 'Install Android Studio from developer.android.com/studio.\n'; exit 1; fi
	@AVD=$$($(ANDROID_SDK)/emulator/emulator -list-avds | head -1); \
	 if [ -z "$$AVD" ]; then \
	   printf 'No AVD. Android Studio → More Actions → Virtual Device Manager → Create.\n'; \
	   exit 1; fi; \
	 printf 'Starting %s\n' "$$AVD"; \
	 $(ANDROID_SDK)/emulator/emulator -avd "$$AVD" >/dev/null 2>&1 &

# Same trap as on iOS: icons and config get compiled into the native project, so without
# a fresh prebuild the build carries whatever landed in android/ the first time around.
prebuild-android: ## Copy config and icons into the native android/ project
	npx expo prebuild -p android

# ── Icons ────────────────────────────────────────────────────────────────────

icons: ## Preview the icons without overwriting any files
	cd assets && uv run --with pillow python generate-icons.py

icons-write: ## Generate and overwrite the full set of icons
	cd assets && uv run --with pillow python generate-icons.py --write

# ── Diagnostics ──────────────────────────────────────────────────────────────

doctor: ## Check the environment: tools, signing, devices, content bundle
	@printf '\n── Tools ──\n'
	@printf '%-14s ' 'node';      command -v node      >/dev/null && node --version || echo 'MISSING'
	@printf '%-14s ' 'xcodebuild'; xcodebuild -version 2>/dev/null | head -1        || echo 'MISSING (see below)'
	@printf '\n── Xcode ──\n'
	@printf 'active path: %s\n' "$$(xcode-select -p 2>/dev/null)"
	@case "$$(xcode-select -p 2>/dev/null)" in \
	  */CommandLineTools) printf 'WARNING: pointing at Command Line Tools. Run this yourself:\n'; \
	                      printf '  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer\n';; \
	  *) printf 'OK\n';; \
	esac
	@printf '\n── Code signing ──\n'
	@security find-identity -v -p codesigning 2>/dev/null | tail -2 || true
	@if [ "$$(security find-identity -v -p codesigning 2>/dev/null | grep -c 'valid identities')" = "1" ] && \
	    security find-identity -v -p codesigning 2>/dev/null | grep -q '0 valid'; then \
	  printf 'No certificate. Open ios/PatentStrzelecki.xcworkspace, TARGETS →\n'; \
	  printf 'PatentStrzelecki → Signing & Capabilities → Team = Personal Team.\n'; \
	fi
	@printf '\n── Devices ──\n'
	@xcrun devicectl list devices 2>/dev/null | grep -i connected || echo 'none connected'
	@printf '\n── Android ──\n'
	@printf '%-14s ' 'adb'; test -x $(ANDROID_SDK)/platform-tools/adb \
	  && $(ANDROID_SDK)/platform-tools/adb --version | head -1 || echo 'MISSING'
	@printf '%-14s ' 'emulator'; test -x $(ANDROID_SDK)/emulator/emulator \
	  && echo 'present' || echo 'MISSING'
	@printf '%-14s ' 'java'; command -v java >/dev/null && java -version 2>&1 | head -1 || echo 'MISSING'
	@printf '%-14s ' 'AVD'; if [ -x $(ANDROID_SDK)/emulator/emulator ]; then \
	  $(ANDROID_SDK)/emulator/emulator -list-avds | tr '\n' ' ' | sed 's/^$$/none/'; echo; \
	  else echo '—'; fi
	@if [ -x $(ANDROID_SDK)/platform-tools/adb ]; then \
	  $(ANDROID_SDK)/platform-tools/adb devices | tail -n +2 | grep . || echo 'nothing running'; fi
	@printf '\n── Content bundle ──\n'
	@if [ -f assets/content/manifest.json ]; then cat assets/content/manifest.json; \
	  else printf 'MISSING — see "Skąd się bierze treść" in README.md\n'; fi
	@printf '\n'

# ── Cleanup ──────────────────────────────────────────────────────────────────

clean: ## Remove caches and build artefacts (content and icons stay)
	rm -rf .expo dist
	find . -name __pycache__ -type d -prune -exec rm -rf {} +

clean-native: ## Remove ios/ and android/ — the next build starts from scratch
	rm -rf ios android
