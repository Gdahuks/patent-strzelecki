#!/usr/bin/env bash
# Release stage 2 — the minimal version: validate the bundle's manifest, copy the bundle into the
# release directory, record how old the content is. Refreshing the bundle, the diff against the
# previous release and the interactive gate come in stage 2 of the plan.
#
# From here on every stage reads the content from the release directory, not from the working
# tree: the tree may change during the half hour Gradle takes, the copy does not.

STAGE=content
source "$(dirname "$0")/lib.sh"

OLD_CONTENT_DAYS=30   # the same threshold the content tool warns at

require_stage preflight
begin

MANIFEST="$CONTENT_DIR/manifest.json"
[ -f "$MANIFEST" ] || die "no content bundle manifest: $MANIFEST"

# Reads one field; empty or missing is an error, so nothing downstream compares against ''.
field() {
  node -e '
    const [file, key] = process.argv.slice(1);
    const value = JSON.parse(require("node:fs").readFileSync(file, "utf8"))[key];
    if (value === undefined || value === "" || value === 0) {
      process.stderr.write(`manifest.json has no usable "${key}"\n`);
      process.exit(1);
    }
    process.stdout.write(String(value));
  ' "$MANIFEST" "$1" || die "content bundle manifest is incomplete ($1) — rebuild the bundle"
}

version=$(field version)
scraped_at=$(field scrapedAt)
lessons=$(field lessons)
sets=$(field sets)
questions=$(field questions)
age_days=$(node -e '
  const scraped = new Date(process.argv[1]);
  if (Number.isNaN(scraped.getTime())) { process.stderr.write("scrapedAt is not a date\n"); process.exit(1); }
  process.stdout.write(String(Math.floor((Date.now() - scraped.getTime()) / 86400000)));
' "$scraped_at") || die "scrapedAt in manifest.json is not a date: $scraped_at"

for file in content.json acts.json assets-base64.js; do
  [ -f "$CONTENT_DIR/$file" ] || die "content bundle is missing $file"
done

rm -rf "$RELEASE_DIR/content"
run cp -R "$CONTENT_DIR" "$RELEASE_DIR/content"
run cmp "$MANIFEST" "$RELEASE_DIR/content/manifest.json"

meta_set contentVersion "$version"
meta_set contentScrapedAt "$scraped_at"
meta_set contentLessons "$lessons"
meta_set contentSets "$sets"
meta_set contentQuestions "$questions"
meta_set contentAgeDays "$age_days"

log "content $version, scraped $scraped_at ($age_days days ago): $lessons lessons, $sets sets, $questions questions"
checks "Treść: wersja $version, pobrana ${scraped_at%%T*} ($age_days dni) — $lessons lekcji, $sets zestawów, $questions pytań."

if [ "$age_days" -ge "$OLD_CONTENT_DAYS" ]; then
  if ask "The content is $age_days days old (scraped ${scraped_at%%T*}). Release with it anyway?"; then
    checks "**Zaakceptowano: treść sprzed $age_days dni.**"
  else
    die "stopped: content is $age_days days old — refresh the bundle and rerun"
  fi
fi
checks ""

stage_done
