#!/usr/bin/env bash
# The one manual step after uploading to Play: mark this release as the one testers actually
# have. The content diff and the artefact comparisons of the next release use it as the baseline
# — a build nobody uploaded is not the previous release, however finished it looks.

STAGE=uploaded
source "$(dirname "$0")/lib.sh"

require_stage verify
# The mark says "this exact file is the one testers have", so the file on disk has to be the one
# verify judged: a rebuild between verify and the upload would otherwise be marked as uploaded
# and become the baseline the next release compares against.
run_in "$RELEASE_DIR" shasum -a 256 -c SHA256SUMS
[ ! -f "$STAGE_DIR/uploaded" ] || die "$TAG is already marked as uploaded ($(cat "$STAGE_DIR/uploaded"))"
begin
stage_done
checks "Wgrane do Play: $(date '+%Y-%m-%d %H:%M')."
log "marked $TAG as uploaded — the next release compares against it"
