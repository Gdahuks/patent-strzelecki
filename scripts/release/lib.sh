# Shared functions of the release pipeline. Sourced, never executed.
#
# Every stage script sets STAGE and sources this file. Four environment variables come from the
# Makefile: REPO (app repository root), TAG, RELEASE_DIR (where this release's files live) and
# STAGE (set by the script itself). Everything a stage learns goes into files under RELEASE_DIR
# — release.json for values, .stage/<name> for "this stage finished" — so a stage can be rerun on
# its own and the next one still knows what happened.
#
# Two rules this file enforces for everyone:
#   * a failing command stops the pipeline and says which command, with the tail of the log
#     (`run`) — nothing runs with its exit code ignored;
#   * a question needs a terminal (`ask`) — no terminal means stop, because silence is not
#     consent.

set -euo pipefail

: "${REPO:?REPO (app repository root) must be set}"
: "${TAG:?TAG must be set}"
: "${RELEASE_DIR:?RELEASE_DIR must be set}"
: "${STAGE:?STAGE must be set by the calling script}"

# The stages in the order they run. `begin` walks it to invalidate everything downstream of the
# stage that is starting again. `uploaded` is deliberately absent: it records a human fact (this
# file went to Play), not a computation, and preflight already warns when a release directory
# carries it.
STAGES="preflight content build verify e2e summary"

LOG="$RELEASE_DIR/release.log"
CHECKS="$RELEASE_DIR/checks.md"
META="$RELEASE_DIR/release.json"
STAGE_DIR="$RELEASE_DIR/.stage"

timestamp() { date '+%H:%M:%S'; }

# Terminal and log.
log() {
  printf '%s\n' "$*"
  printf '[%s] [%s] %s\n' "$(timestamp)" "$STAGE" "$*" >> "$LOG"
}

# Log only — for detail nobody needs to see unless something went wrong.
note() { printf '[%s] [%s] %s\n' "$(timestamp)" "$STAGE" "$*" >> "$LOG"; }

# die [CODE] MESSAGE… — CODE defaults to 1; 2 is reserved for environment problems.
die() {
  local code=1
  case "${1:-}" in
    '' | *[!0-9]*) ;;
    *) code=$1; shift ;;
  esac
  note "FAILED: $*"
  printf '\n✗ [%s] %s\n  log: %s\n' "$STAGE" "$*" "$LOG" >&2
  exit "$code"
}

# Runs a command with both streams appended to the log. On failure dies with the last lines of
# the log, so the terminal shows the cause without opening the file. Arguments are logged
# shell-quoted (%q), so a path with a space reads back as one argument.
run() {
  note "\$ $(printf '%q ' "$@")"
  if ! "$@" >> "$LOG" 2>&1; then
    die "command failed: $*
  last lines of the log:
$(tail -n 15 "$LOG" | sed 's/^/    /')"
  fi
}

# Same as run, in another directory. A subshell rather than cd/cd back, so a failure inside
# never leaves the caller somewhere else.
run_in() {
  local dir=$1
  shift
  note "\$ (cd $dir) $(printf '%q ' "$@")"
  if ! (cd "$dir" && "$@") >> "$LOG" 2>&1; then
    die "command failed in $dir: $*
  last lines of the log:
$(tail -n 15 "$LOG" | sed 's/^/    /')"
  fi
}

# A passed check: terminal, log and checks.md.
ok() {
  log "✓ $*"
  printf '✓ %s\n' "$*" >> "$CHECKS"
}

# A failed check: checks.md gets the ✗ line before the pipeline stops, so the document shows
# what was found, not only what passed. Unused in stage 1 (verify.ts writes its own lines);
# the content gate of stage 2 is its first caller.
fail() {
  printf '✗ %s\n' "$*" >> "$CHECKS"
  die "$*"
}

# A free line into checks.md (a heading, a fact, an accepted answer).
checks() { printf '%s\n' "$*" >> "$CHECKS"; }

# ask QUESTION — returns 0 for yes. Enter means no. Without a terminal it dies: a pipeline that
# assumed consent when nobody was there would be the silent failure this whole thing exists to
# prevent.
ask() {
  local question=$1 answer
  [ -t 0 ] || die "cannot ask \"$question\" — no terminal, and this pipeline never assumes consent"
  printf '%s [y/N] ' "$question"
  # Ctrl-D closes the input without an answer; without this the script would end here in
  # silence and the caller would read a non-zero return as "no".
  read -r answer || die "no answer (end of input) to: $question"
  note "asked: $question → ${answer:-<enter>}"
  # The questions are English, so `y` has to work; `t` stays because that is what the prompt
  # used to accept and it is still the reflex of whoever runs this.
  case "$answer" in
    y | Y | yes | YES | Yes | t | T | tak | TAK | Tak) return 0 ;;
    *) return 1 ;;
  esac
}

stage_done() {
  mkdir -p "$STAGE_DIR"
  date -u '+%Y-%m-%dT%H:%M:%SZ' > "$STAGE_DIR/$STAGE"
  note "stage done"
}

require_stage() {
  [ -f "$STAGE_DIR/$1" ] \
    || die 2 "stage \"$1\" has not run for $TAG — run: make release-$1 TAG=$TAG"
}

# release.json — a flat string→string store shared by the stages. Node rather than jq, because
# Node is already a requirement and jq is not.
meta_set() {
  node -e '
    const fs = require("node:fs");
    const [file, key, value] = process.argv.slice(1);
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    data[key] = value;
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  ' "$META" "$1" "$2"
}

# Prints the value; a missing or empty key is an error, never an empty string — an empty
# expected value would turn the comparison that uses it into one that cannot fail.
meta_get() {
  node -e '
    const [file, key] = process.argv.slice(1);
    const value = JSON.parse(require("node:fs").readFileSync(file, "utf8"))[key];
    if (value === undefined || value === "") {
      process.stderr.write(`release.json has no "${key}"\n`);
      process.exit(1);
    }
    process.stdout.write(String(value));
  ' "$META" "$1"
}

# Opens the stage: makes sure the directory exists, drops this stage's own marker and the markers
# of every later stage, and writes the heading to the log. A stage that starts again owns its
# marker: one left by an earlier run must not vouch for a run that has not finished. It also
# invalidates everything built on its previous result — after a second `make release-build` the
# AAB is a new file, so the verify and the summary that judged the old one must not stand.
# Without this, a stage that dies half way through rewriting its output would leave require_stage
# in the next stage happy with a partial result.
begin() {
  mkdir -p "$RELEASE_DIR"
  local seen=0 name
  for name in $STAGES; do
    if [ "$name" = "$STAGE" ]; then seen=1; fi
    if [ "$seen" = 1 ]; then rm -f "$STAGE_DIR/$name"; fi
  done
  # And for a stage outside the list (a test harness, or one added later): its own marker goes
  # regardless, because the rule above all is that a running stage does not vouch for itself.
  rm -f "$STAGE_DIR/$STAGE"
  log "── $STAGE ── $(date '+%Y-%m-%d %H:%M')"
}
