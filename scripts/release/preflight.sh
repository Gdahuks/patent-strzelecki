#!/usr/bin/env bash
# Release stage 1: everything that can be checked before spending half an hour on Gradle.
#
# Every item is checked and printed — not just the first failure — so one run shows the whole
# list of what to fix. The stage also opens the release directory: checks.md gets its heading,
# release.json its first values (expected version numbers computed from git, tool versions, the
# upload key's fingerprint), and later stages compare against those.

STAGE=preflight
source "$(dirname "$0")/lib.sh"

TOOLS_DIR="$RELEASES_DIR/tools"
BUNDLETOOL_VERSION=1.18.3
BUNDLETOOL_SHA256=a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29
BUNDLETOOL_URL="https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/bundletool-all-$BUNDLETOOL_VERSION.jar"
BUNDLETOOL="$TOOLS_DIR/bundletool-all-$BUNDLETOOL_VERSION.jar"
MIN_FREE_GB=5

# ── Tag format ────────────────────────────────────────────────────────────────
# First, because RELEASE_DIR is built from TAG and the block below deletes it: `TAG=..` would
# otherwise offer to remove the whole releases directory. A plain exit rather than `die` — there
# is no release directory to log into yet, and nothing may touch one before this passes.
#
# grep, not a case glob: `v[0-9]*.[0-9]*.[0-9]*` would accept v0.4.0-rc1 and v1.2.3.4, and
# app.config.js would then fall back to app.json's version without a word — after the build.
if ! printf '%s\n' "$TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  printf "\n✗ [%s] tag format: %s does not match vX.Y.Z — app.config.js would fall back to app.json's version\n" \
    "$STAGE" "$TAG" >&2
  exit 2
fi

# ── The release directory ──────────────────────────────────────────────────────
# Before `begin`, because a directory left by an earlier run is the one question that has to be
# asked before anything is written into it.
if [ -d "$RELEASE_DIR" ]; then
  uploaded_note=''
  # The uploaded marker is the proof that testers have this build — say so before offering to
  # delete it.
  [ ! -f "$RELEASE_DIR/.stage/uploaded" ] || uploaded_note=" — MARKED AS UPLOADED TO PLAY on $(cat "$RELEASE_DIR/.stage/uploaded")"
  if ask "$RELEASE_DIR already exists (a previous run of $TAG$uploaded_note). Delete it and start over?"; then
    rm -rf "$RELEASE_DIR"
  else
    die "stopped: $RELEASE_DIR kept — move it away or answer yes"
  fi
fi
begin
mkdir -p "$TOOLS_DIR"

problems=0
item() { # item ok|bad LABEL DETAIL
  if [ "$1" = ok ]; then log "✓ $2: $3"; else log "✗ $2: $3"; problems=$((problems + 1)); fi
}

# ── Tools ─────────────────────────────────────────────────────────────────────
for tool in git node npm java keytool jarsigner unzip shasum curl; do
  if command -v "$tool" > /dev/null; then item ok "$tool" "$(command -v "$tool")"
  else item bad "$tool" "not on PATH"; fi
done
# Everything below calls these tools; under `set -e` a missing one would end the script in the
# middle of the list without a word, so stop here with the list complete.
[ "$problems" -eq 0 ] || die 2 "$problems tool(s) missing — install them and rerun: make release-preflight TAG=$TAG"

wanted_node=$(cat "$REPO/.nvmrc")
node_version=$(node --version)
case "$node_version" in
  "v$wanted_node."*) item ok "node version" "$node_version (.nvmrc wants $wanted_node)" ;;
  *) item bad "node version" "$node_version, but .nvmrc wants $wanted_node — switch with fnm/nvm" ;;
esac
# `java -version` writes to stderr by design; redirecting it is how the version is read at all.
# sed rather than head: head closing the pipe early can trip pipefail with SIGPIPE.
java_version=$(java -version 2>&1 | sed -n 1p)
item ok "java" "$java_version"

# ── Upload key ────────────────────────────────────────────────────────────────
fingerprint=''
if [ -z "${UPLOAD_KEYSTORE:-}" ] || [ -z "${UPLOAD_KEYCHAIN_ITEM:-}" ]; then
  item bad "upload key" "PATENT_UPLOAD_KEYSTORE and PATENT_UPLOAD_KEYCHAIN_ITEM must be set (shell profile)"
elif [ ! -f "$UPLOAD_KEYSTORE" ]; then
  item bad "upload key" "no file at $UPLOAD_KEYSTORE — see: make android-key"
# The password is the command's output; only its presence is checked, nothing is printed.
elif ! security find-generic-password -s "$UPLOAD_KEYCHAIN_ITEM" -w > /dev/null 2>&1; then
  item bad "upload key" "no password in the keychain (service $UPLOAD_KEYCHAIN_ITEM) — see: make android-key"
else
  # The fingerprint of the certificate in the keystore — verify.ts compares it with the one in
  # the AAB. The password reaches keytool only through the environment (-storepass:env), never
  # as an argument visible in `ps` or the log. The assignment sits inside `if`: under set -e a
  # bare `x=$(failing | awk)` would end the script silently, and a wrong password has to become
  # an item on this list instead.
  if fingerprint=$(PATENT_UPLOAD_PASSWORD="$(security find-generic-password -s "$UPLOAD_KEYCHAIN_ITEM" -w)" \
      keytool -list -v -keystore "$UPLOAD_KEYSTORE" -storepass:env PATENT_UPLOAD_PASSWORD -alias upload 2>> "$LOG" \
      | awk '/SHA256:/ { print $2; exit }') && [ -n "$fingerprint" ]; then
    item ok "upload key" "$UPLOAD_KEYSTORE, alias upload, SHA-256 $fingerprint"
  else
    fingerprint=''
    item bad "upload key" "keytool could not read the certificate fingerprint (wrong password or alias? details in the log)"
  fi
fi

# ── Tag ───────────────────────────────────────────────────────────────────────
tag_commit=''
# Already enforced at the top of the file, before anything destructive; the line is repeated here
# so the printed checklist reads in one order from top to bottom.
item ok "tag format" "$TAG"
if git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG" > /dev/null; then
  tag_commit=$(git -C "$REPO" rev-parse "$TAG^{commit}")
  item ok "tag exists" "$tag_commit"
  if git -C "$REPO" tag -v "$TAG" >> "$LOG" 2>&1; then item ok "tag signature" "good GPG signature"
  else item bad "tag signature" "git tag -v failed — unsigned tag or unknown key (details in the log)"; fi
  run git -C "$REPO" fetch origin --tags --quiet
  if git -C "$REPO" merge-base --is-ancestor "$TAG" origin/main; then item ok "tag on main" "ancestor of origin/main"
  else item bad "tag on main" "$TAG is not reachable from origin/main — a release must correspond to public code"; fi
  remote_sha=$(git -C "$REPO" ls-remote --tags origin "refs/tags/$TAG" | awk '{ print $1 }')
  local_sha=$(git -C "$REPO" rev-parse "refs/tags/$TAG")
  if [ -n "$remote_sha" ] && [ "$remote_sha" = "$local_sha" ]; then item ok "tag on origin" "$remote_sha"
  else item bad "tag on origin" "not on origin or different there (local $local_sha, origin ${remote_sha:-none}) — git push origin $TAG"; fi
else
  item bad "tag exists" "no tag $TAG in $REPO"
fi

# ── Content bundle (existence only; content.sh validates it) ──────────────────
if [ -f "$CONTENT_DIR/manifest.json" ]; then item ok "content bundle" "$CONTENT_DIR"
else item bad "content bundle" "no manifest.json in $CONTENT_DIR — set PATENT_CONTENT_DIR or build the bundle"; fi

# ── bundletool ────────────────────────────────────────────────────────────────
if [ ! -f "$BUNDLETOOL" ]; then
  log "downloading bundletool ${BUNDLETOOL_VERSION}…"
  run curl -fsSL -o "$BUNDLETOOL.part" "$BUNDLETOOL_URL"
  mv "$BUNDLETOOL.part" "$BUNDLETOOL"
fi
actual_sha=$(shasum -a 256 "$BUNDLETOOL" | awk '{ print $1 }')
if [ "$actual_sha" = "$BUNDLETOOL_SHA256" ]; then item ok "bundletool" "$BUNDLETOOL_VERSION, checksum matches"
else item bad "bundletool" "checksum mismatch for $BUNDLETOOL ($actual_sha) — delete the file and rerun"; fi

# The emulator and the test keystore for e2e are checked here from stage 3 of the plan on;
# in stage 1 there is no e2e to prepare for.
[ "${SKIP_E2E:-}" = 1 ] && log "e2e: skipped by flag (SKIP_E2E=1)"

# ── Disk ──────────────────────────────────────────────────────────────────────
for dir in "$RELEASES_DIR" "${TMPDIR:-/tmp}"; do
  free_gb=$(df -g "$dir" | awk 'NR == 2 { print $4 }')
  if [ "$free_gb" -ge "$MIN_FREE_GB" ]; then item ok "disk" "$free_gb GB free at $dir"
  else item bad "disk" "only $free_gb GB free at $dir (need $MIN_FREE_GB)"; fi
done

[ "$problems" -eq 0 ] || die 2 "$problems preflight check(s) failed — fix them and rerun: make release-preflight TAG=$TAG"

# ── Record what this release is ───────────────────────────────────────────────
pipeline_commit=$(git -C "$REPO" rev-parse --short HEAD)
# The `+` marks a pipeline run from an uncommitted checkout, the same way app.config.js marks
# the app. Note: the *app* is built from a clean worktree regardless; this is about the scripts.
[ -z "$(git -C "$REPO" status --porcelain)" ] || pipeline_commit="$pipeline_commit+"

# Bare assignments on purpose: under set -e a failing `$(…)` here stops the script, while the
# same substitution inside another command's arguments would not.
tag_commit_short=$(git -C "$REPO" rev-parse --short "$TAG^{commit}")
tag_commit_date=$(git -C "$REPO" log -1 --format=%cs "$TAG")
expected_version_code=$(git -C "$REPO" rev-list --count "$TAG")

meta_set tag "$TAG"
meta_set version "${TAG#v}"
meta_set tagCommit "$tag_commit"
meta_set tagCommitShort "$tag_commit_short"
meta_set tagCommitDate "$tag_commit_date"
meta_set expectedVersionCode "$expected_version_code"
meta_set pipelineCommit "$pipeline_commit"
meta_set nodeVersion "$node_version"
meta_set javaVersion "$java_version"
meta_set bundletoolVersion "$BUNDLETOOL_VERSION"
meta_set uploadKeyFingerprint "$fingerprint"
meta_set startedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
meta_set skipE2e "${SKIP_E2E:-0}"

checks "# Wydanie $TAG — $(date '+%Y-%m-%d %H:%M')"
checks ""
checks "Tag $TAG (podpisany, na origin/main), commit $tag_commit_short z $tag_commit_date."
checks "Pipeline z commita $pipeline_commit. Node $node_version, $java_version, bundletool $BUNDLETOOL_VERSION."
checks "Oczekiwane: versionName ${TAG#v}, versionCode $expected_version_code."
checks ""

log "preflight complete: $TAG → versionName ${TAG#v}, versionCode $expected_version_code"
stage_done
