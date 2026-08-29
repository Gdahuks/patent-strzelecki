#!/usr/bin/env bash
# Release stage 5: close checks.md and say what to upload where.
#
# Exit code 3 when e2e was skipped: the package is built and checked inside, but nobody has seen
# it run. From make this shows as exit 2 (make's own code for a failed recipe) — the last line of
# the terminal and the bold entry in checks.md are the signal that matters.

STAGE=summary
source "$(dirname "$0")/lib.sh"

require_stage preflight
require_stage content
require_stage build
require_stage verify
begin

unverified=0
if [ "$(meta_get skipE2e)" = 1 ]; then
  unverified=1
  checks "## E2E"
  checks "**NIEZWERYFIKOWANE: e2e pominięte flagą SKIP_E2E=1 — nikt nie widział tej paczki uruchomionej.**"
  checks ""
else
  require_stage e2e
fi

# Bare assignments first: a missing key stops the script here (set -e), while `$(meta_get …)`
# inside another command's arguments would be swallowed.
size_bytes=$(meta_get sizeBytes)
version_code=$(meta_get manifestVersionCode)
version=$(meta_get version)
size_mb=$(( size_bytes / 1000000 ))
sha=$(awk '{ print $1 }' "$RELEASE_DIR/SHA256SUMS")
[ -n "$sha" ] || die "SHA256SUMS is empty"
checks "## Do wgrania"
checks "\`$RELEASE_DIR/app-release.aab\` ($size_mb MB), sha256 \`$sha\`."
checks "Play Console → Testowanie → Test zamknięty → alpha → Utwórz nową wersję; konsola pokaże \`$version_code ($version)\`."
checks "Po wgraniu: \`make release-uploaded TAG=$TAG\`."
meta_set finishedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
stage_done

log ""
log "Release $TAG"
log "  package   $RELEASE_DIR/app-release.aab ($size_mb MB)"
log "  sha256    $sha"
log "  Play      $version_code ($version) — Testowanie → Test zamknięty → alpha → Utwórz nową wersję"
log "  checks    $CHECKS"
log "  after     make release-uploaded TAG=$TAG"
if [ "$unverified" = 1 ]; then
  printf '\n\033[1mNIEZWERYFIKOWANE: e2e (SKIP_E2E=1)\033[0m\n'
  note "exit 3: built, not verified end-to-end"
  exit 3
fi
