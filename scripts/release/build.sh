#!/usr/bin/env bash
# Release stage 3: the build, in a directory that did not exist a minute ago.
#
# A fresh worktree of the tag is what makes the result trustworthy: no android/ left over from
# last week, no uncommitted change, no JS bundle Gradle considers "up to date" while the content
# has moved on (that last one shipped 0.2.0 with stale content, and no log said a word). The
# price is npm ci and a Gradle build with nothing cached — a few minutes, because React Native
# ships its native artefacts prebuilt and no C++ is compiled here — and it is paid on purpose.
#
# On failure the worktree stays, and the last lines say where; on success it is removed.

STAGE=build
source "$(dirname "$0")/lib.sh"

# Suites that skip themselves without the content bundle. Here the bundle is present, so they
# must run — a skip here means the copy did not land where the tests look.
CONTENT_SUITES=(
  src/content/versions.package.test.ts
  src/content/acts.package.test.ts
  src/content/assets.package.test.ts
  src/content/actSearch.test.ts
)

require_stage preflight
require_stage content
begin
started=$(date +%s)

# A predictable path, so a kept worktree is easy to find and remove.
WORK="${TMPDIR:-/tmp}/patent-release-$TAG"
[ ! -e "$WORK" ] || die "worktree path already exists: $WORK — remove it: git -C $REPO worktree remove --force $WORK"

# Set once the worktree is ours: the trap must not offer to remove a directory this run did not
# create (a leftover from an earlier run is the one case where the path already existed).
created=0
keep_worktree_on_failure() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$created" = 1 ] && [ -d "$WORK" ]; then
    printf '\nThe worktree is kept for inspection: %s\nRemove it with: git -C %s worktree remove --force %s\n' \
      "$WORK" "$REPO" "$WORK" >&2
  fi
}
trap keep_worktree_on_failure EXIT

# ── Worktree ──────────────────────────────────────────────────────────────────
# An interrupted run can leave a registration behind for a directory that is already gone; git
# then refuses to add the same path again. Pruning first costs nothing and removes nothing real.
run git -C "$REPO" worktree prune
run git -C "$REPO" worktree add --detach "$WORK" "$TAG"
created=1
head=$(git -C "$WORK" rev-parse HEAD)
# Bare assignments: under set -e a failing `$(…)` here stops the script, while the same
# substitution inside another command's arguments would compare against '' and pass.
tag_commit=$(meta_get tagCommit)
checkout_dirty=$(git -C "$WORK" status --porcelain)
[ "$head" = "$tag_commit" ] || die "worktree is at $head, the tag points at $tag_commit"
[ -z "$checkout_dirty" ] || die "worktree is not clean right after checkout — see git -C $WORK status"
log "worktree at $WORK ($head), clean"

# ── Content ───────────────────────────────────────────────────────────────────
run cp -R "$RELEASE_DIR/content" "$WORK/assets/content"
run cmp "$RELEASE_DIR/content/manifest.json" "$WORK/assets/content/manifest.json"

# ── Dependencies ──────────────────────────────────────────────────────────────
log "npm ci…"
run_in "$WORK" npm ci --legacy-peer-deps

# ── Tests, with the content bundle in place ───────────────────────────────────
log "tests with the content bundle…"
# Two reporters: the default one so a failure's cause is in the log's tail (with only the JSON
# reporter vitest prints a single "report written" line), the JSON one for the assertion below.
run_in "$WORK" npx vitest run --reporter=default --reporter=json --outputFile.json="$RELEASE_DIR/vitest.json"
test_summary=$(node "$REPO/scripts/release/test-report.ts" "$RELEASE_DIR/vitest.json" "${CONTENT_SUITES[@]}") \
  || die "the test run is not a clean pass — see $RELEASE_DIR/vitest.json"
log "✓ tests: $test_summary"

# ── Native project and the package ───────────────────────────────────────────
log "prebuild (from scratch — there is no android/ here)…"
# --no-install: dependencies were installed by npm ci above; prebuild has no reason to touch
# the network or node_modules.
run_in "$WORK" npx expo prebuild -p android --no-install
# app.config.js runs `git status --porcelain` during the Gradle build and appends `+` to the
# commit shown in Settings when the tree is dirty — so the tree has to be clean *now*, after
# prebuild, not only right after checkout.
dirty=$(git -C "$WORK" status --porcelain)
[ -z "$dirty" ] || die "prebuild left the worktree dirty — the app would carry a '+' in its version line:
$dirty"
gradle_version=$(sed -n 's|.*gradle-\([0-9.]*\)-.*|\1|p' "$WORK/android/gradle/wrapper/gradle-wrapper.properties")
[ -n "$gradle_version" ] || die "could not read the Gradle version from gradle-wrapper.properties"
meta_set gradleVersion "$gradle_version"

log "gradle bundleRelease (Gradle $gradle_version, R8 on — the longest stage)…"
# The password lives in a shell variable and reaches Gradle only through the environment of the
# subshell. `run` logs the function name, not the variables, so nothing secret lands in
# release.log. Read into a variable first: a failing `$(…)` inside an environment prefix would
# be ignored and Gradle would start with an empty password — minutes later, a keystore error.
gradle_bundle_release() {
  local secret
  secret=$(security find-generic-password -s "$UPLOAD_KEYCHAIN_ITEM" -w) \
    || { printf 'no password in the keychain (service %s)\n' "$UPLOAD_KEYCHAIN_ITEM"; return 1; }
  (
    cd "$WORK/android" \
      && PATENT_UPLOAD_STORE_FILE="$UPLOAD_KEYSTORE" PATENT_UPLOAD_PASSWORD="$secret" ./gradlew bundleRelease
  )
}
run gradle_bundle_release

built="$WORK/android/app/build/outputs/bundle/release/app-release.aab"
[ -f "$built" ] || die "Gradle finished but there is no $built"
run cp "$built" "$RELEASE_DIR/app-release.aab"
(cd "$RELEASE_DIR" && shasum -a 256 app-release.aab > SHA256SUMS)

# ── Close ─────────────────────────────────────────────────────────────────────
seconds=$(( $(date +%s) - started ))
meta_set buildSeconds "$seconds"
checks "## Build"
checks "✓ worktree z tagu $TAG (${head:0:7}), czyste drzewo, npm ci"
checks "✓ testy: $test_summary"
checks "✓ prebuild od zera, Gradle $gradle_version bundleRelease — $((seconds / 60)) min"
checks ""
log "built in $((seconds / 60)) min → $RELEASE_DIR/app-release.aab"

run git -C "$REPO" worktree remove --force "$WORK"
stage_done
