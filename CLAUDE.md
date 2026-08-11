# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other agents working in this
repository.

Conversations with the repository owner are in Polish; the app's UI text is Polish too.
Code, comments and commit messages are in English. Thrown error messages are the one
deliberate exception: `app/_layout.tsx` renders `error.message` straight to the user, and
the surrounding interface is Polish, so those strings are Polish too.

## What this is

An offline mobile app for the theory part of the Polish PZSS shooting licence exam
("patent strzelecki"). Course content comes from the free course at patentstrzelecki.eu,
run by Braterstwo (Stowarzyszenie KS Amator), and is used with their written permission.

**The content is not in this repository** and never will be — it belongs to the course
authors. The tool that builds the content bundle lives in a separate private repository.
A fresh clone therefore type-checks and passes tests, but cannot build a runnable app.

## Commands

Everyday tasks live in the `Makefile` — `make` with no arguments prints the list, `make doctor`
diagnoses the environment. Most common: `make check` (typecheck + lint + test), `make start`,
`make ios`. Android: `make android-emu` (boots the AVD) and `make android`; `make android-avd`
rebuilds the emulator from scratch if the SDK ever needs reinstalling.

For a single test, skip the Makefile and call vitest directly:

```sh
npx vitest run src/engine/exam.test.ts -t "fails on a critical mistake despite a score above the threshold"
```

**`npm install` requires `--legacy-peer-deps`.** Expo pins `react` to a version that conflicts
with the `react-dom` pulled in by web-facing dependencies. Without the flag, every install ends
in `ERESOLVE`.

## The content bundle boundary

This app never parses the course website's HTML directly. A separate, private tool (the
scraper) turns the course pages into a single content bundle; the app only ever reads that
bundle. The boundary is the **bundle format**, and the format is a contract: the app's side of
it is typed in `src/content/types.ts`. Whoever changes the bundle shape has to change both ends
of that contract, or the app breaks silently on a bundle that "looks fine".

## Rules the content permission imposes

Course content belongs to its authors and is used under a written permission. The permission
document stays outside this repository. What follows is what that permission means **for the
code**. These are conditions, not preferences.

- **Free, no ads, no accounts, no user tracking.** Today there isn't a single
  `fetch`/XHR/WebSocket call in `src/` or `app/`, and the privacy declarations in both stores
  rest on that fact — the first SDK that reaches onto the network has to be reflected there.
- **The content's origin is credited with a clickable link to patentstrzelecki.eu**, both in
  the app and in the store listing. In the app this is done: the "Treść" card in
  `app/settings.tsx` opens `content.source` — the address shipped inside the bundle, not one
  hardcoded into the source.
- **The app states that it is not an official Braterstwo app.** The "Aplikacja" card reads
  "Nieoficjalna — Braterstwo jej nie prowadzi i nie odpowiada za jej działanie."
- **The names "Braterstwo" and "KS Amator", and their logo, are used only to credit the
  source.** The app icon is original (drawn by `assets/generate-icons.py`) and stays that way.
  The one deliberate exception is a link to their 1.5% tax-donation drive
  (`braterstwo.eu/1procent`) on the "Treść" card; the beneficiary is Stowarzyszenie KS Amator,
  the registered public-benefit organisation.
- **The app name is "Patent Strzelecki" and is not to be changed** without the authors'
  agreement.
- **User reports go to the app's author, not to Braterstwo.** The contact address lives on the
  "Aplikacja" card. The rules for composing a report — a subject line to filter on, a footer
  carrying the app version — live in `src/engine/report.ts` and are covered by tests; that text
  is not meant to be re-typed into a screen by hand.
- **Course content never reaches this repository, and the tool that fetches it is not
  published.**

## Things that are not obvious and easy to break

**The Expo SDK is pinned to 54, and stays that way — but not for Expo Go.** Read the exact
versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code against this
project.

Expo Go is not used in this project at all. Don't suggest it — neither as a way to run the app
nor as a workaround for anything (the Apple developer account fee, the seven-day signing
profile, permissions). The same goes for `eas update`. The repository owner builds **Release**
through `make ios` and rebuilds weekly, when the free signing profile expires. That's a
deliberate choice, not a problem to solve. `make start` boots Metro for a **debug** build, i.e.
for day-to-day coding — not for Expo Go.

The reason for staying on SDK 54 isn't the Expo Go compatibility that motivated the original
pin — with Expo Go out of the picture, that argument is dead. The reason today is different,
and checkable in the built APK: SDK 54 targets **API 36**, which clears the current Google Play
bar, and it keeps a **low entry threshold** at the same time — `minSdkVersion 24` (Android 7.0,
2016) and `IPHONEOS_DEPLOYMENT_TARGET 15.1` (iPhone 6s, 2015). Every SDK bump **raises** those
floors, cutting off older phones — the opposite of what the owner wants. Bumping the SDK is
therefore a regression risk (especially in the WebView, which half the app is built on) for no
upside.

Two things not to over-read from this:

- **Reach is set by `minSdkVersion`, not `targetSdkVersion`.** Raising the latter doesn't add a
  single user — it only opts the app into newer platform behaviour changes. Wanting "as many
  people as possible to be able to install this" means wanting a low `minSdk`, which is exactly
  what SDK 54 already gives.
- **Google Play's floor rises every year.** API 36 has been required since 31 August 2026; API
  37 (Android 17, released June 2026) isn't required until August 2027. None of this applies
  until the app is actually in Play. Once it is, staying on SDK 54 stops being a free choice and
  becomes a yearly commitment — and that's the only point at which it's worth revisiting.

Checking the facts, if this ever comes up again:

```sh
# what the built APK actually targets
aapt2 dump badging android/app/build/outputs/apk/release/app-release.apk \
  | grep -E 'sdkVersion|targetSdkVersion'

# the latest available Expo release
npm view expo dist-tags
```

**Correct answers are hashed in the content source** as `md5(letter + hash-of-that-letter)`.
With three candidates, recovering the letter is unambiguous —
`questions.decode_correct_letter` on the scraper side does the decoding before the bundle ships.

**Provisions that ship with two renderings are resolved by date, not by the source's own
future/past marking.** Some legal acts carry a provision that reads differently before and
after a given date — both versions ship in the bundle, and the app decides which one to show.
The date that decides comes from a note attached to the text, and it is compared against
**today's date** in `src/content/versions.ts` at render time — never against whichever version
the bundle happened to mark as "future" at build time, because that marking goes stale as the
bundle ages on the phone.

The future-dated labels carry three distinct meanings and the rendering has to say which one
applies: „Zmieni się {date}" — the provision in force today, due to be replaced; its text stays
plain, because it is current law. „Wejdzie w życie {date}" — the provision doesn't exist yet;
its text renders in italics and dimmed. „Traci moc {date}" — a repeal with no replacement; there
is no new text to show at all. The first two used to share a single "od {date}" wording, and a
real user reading it at art. 15c of the firearms act **read it backwards** — the meaning most
people would guess first is the wrong one for at least one of the three. Contrast ratios: the
dimmed style is 5.42:1 in light mode and 7.14:1 in dark mode, the label itself is 4.52:1 and
6.77:1 — the italics are a color-independent signal here, the same role `✓`/`✗` play in the ABC
quiz.

**A legal act's name inside a question's "podstawa prawna" is searched across the whole chain,
by word stem, not by matching the start of the string.** The course writes „§8 ust. 1
**rozporządzenia w sprawie przechowywania**" and „Rozdział 1 ust. 2 **wzorcowego
regulaminu**…" — matching from the start of the string silently dropped 30 questions that point
to documents the app actually has. Act names live once, in a lookup table that ships inside the
bundle. This matching rule has two copies — `resolveLaw` in this app, and an equivalent rule in
the private scraper — kept in sync by a test in the scraper repo that runs the app's real
`resolveLaw` through node and diffs it against the whole bundle. Don't write a third copy; when
the rule changes, change both.

**Lessons are materialized to disk and loaded through `file://`.** A WebView can accept raw HTML
as a string, but then relative image paths have nothing to resolve against. Hence
`src/content/materialize.ts`. The version marker is cleared for the duration of the write, so an
interrupted materialization retries on the next app start — the earlier version left a
permanently missing image behind instead.

**Images ship inside the bundle as base64, not through `require`.** Android's bundler compiles
images into app resources (`res/drawable-mdpi/assets_content_assets_*.png`), and when it does,
`expo-asset` hands back the bare drawable resource name instead of a file path, so `File.copy`
rejects it with "URI is not absolute" — the same code works without complaint on iOS.
`File.write(payload, { encoding: 'base64' })` behaves identically on both platforms. The module
holding the encoded assets (`assets/content/assets-base64.js`) is `require`d **lazily**, inside
the write function only: it's several megabytes of strings, needed only on first launch and
after a content bundle update.

**Links inside the content are written for a website** (`/pzss`, `/testy/uobia`,
`assets/x.jpg`). `src/navigation/links.ts` translates them. Watch the address arithmetic: inside
a `file://` document, a root-relative link like `/pzss` resolves to the filesystem root, while a
relative one resolves to the content directory — `fileUrlToHref` handles that distinction. An
unrecognized internal path falls through to the system browser, because the course may have
added a page since the bundle was last refreshed.

**Link clicks are intercepted on the page, not in `onShouldStartLoadWithRequest`.** A
root-relative link from the course content ("/pzss") gets resolved by the browser, relative to
`file://`, to `file:///pzss` — outside the directory the WebView is sandboxed to. WebKit rejects
that itself ("Ignoring request to load this main resource because it is outside the sandbox")
and shows an error page — there's nothing left for a navigation guard to intercept. That's why
`linkClickScript` in `src/content/linkScript.ts` blocks the default action during the capture
phase and forwards the **raw `href` attribute** instead. `assets/…` links and absolute
`http(s)` links worked before this fix, which is what made the routing look fine: the first kind
sits inside the content directory, and the second kind was never a filesystem address to begin
with. `onShouldStartLoadWithRequest` stays in place as a guard against navigation that happens
without a click.

**No backticks in WebView stylesheets or injected scripts.** The act stylesheet, and the
tooltip, search and diagram scripts, are TypeScript template literals — a backtick anywhere
inside them, even inside a comment around a CSS property name, closes the string and breaks
`tsc`. This has happened three times, in `src/content/findInPage.ts`, `app/act/[slug].tsx`, and
that same file a second time. Worse than the error itself: `make ios`/`make android` chain
through `tsc`, so a broken build silently produces **no build at all**, and the device keeps
running the previous version — which makes the fix look like it didn't work. Always check the
build's exit code, not just that the command finished.

**WebView properties whose type differs between platforms go through
`src/content/webviewProps.ts`.** `decelerationRate="normal"` gives iOS a Safari-like scroll
deceleration; on Android the same prop is generated as a number, so passing a string crashes
the app the instant the view is created (`ClassCastException: String cannot be cast to
Double`) — i.e. on **every** entry into a lesson or an act. `SCROLL_PROPS` supplies that
property only on iOS; add future platform mismatches like it there, not in individual screens.

**JavaScript is enabled in the lesson WebView on purpose** — without it, there's no way to
restore scroll position. The content is local and ours, and navigation is intercepted by the
router regardless.

**The interactive pistol diagram runs on our own script, not the course's.** The scraper strips
out `<script>` tags, so the widget from the firearm-anatomy lesson was dead on arrival: the
caption asked the reader to tap a part, and nothing happened. `src/content/schematicScript.ts`
rebuilds that behaviour from data that already survives in the content
(`<g class="pistol-part" data-part>` plus a hidden `span.pistol-part-data` carrying the name and
description). The script **strips `tabindex` from the parts**: Android's WebView draws its own
focus ring around a focused element, and on an SVG you can't remove it — not with
`outline: none` (Chromium ignores that for SVG), and not with `blur()` (that method doesn't
exist on `SVGElement` in this engine version). The course's own "point to a part" quiz is
stripped out along with the inviting sentence that framed it — it only worked embedded in the
course site, and the app has its own quizzing anyway.

**Reading position is stored as a fraction, not a pixel offset.** Content height changes with
font scale, so a pixel offset would point at a different place after a settings change.

**External links go through `expo-web-browser`, not `Linking.openURL`** — the latter crashed on
iOS with "Unable to open URL". The one exception is the `mailto:` link on the "Aplikacja" card:
a browser has no way to open an address that isn't a web page, so that one still uses `Linking`.
The rejection **has to be handled**, because a phone with no mail account configured silently
declines that request — the address is copied to the clipboard instead, with a message, so the
tap doesn't just do nothing.

**The version line in Settings carries a `+` suffix when the build has uncommitted changes**
(`sourceCommit()` in `app.config.js`). The app's code is public, so this line exists to let
someone diff the running build against the repository — without the suffix, a build made from a
workshop checkout would claim to be exactly a public commit, which is a lie in precisely the one
place this line exists to prevent. The date shown is the **commit date, not the build date**:
the build date would give a different value on every rebuild of the exact same code.

**Icons are compiled into the native project.** `expo prebuild` copies the icon from
`app.json` into `ios/…/AppIcon.appiconset` only once; once `ios/` already exists, swapping
`assets/icon.png` alone does nothing and the build keeps shipping the old icon. That's why the
`ios` target in the `Makefile` depends on `prebuild`. The same trap applies to any change to
`app.json`.

**expo-router route types are generated by `expo start`, not by `expo export`.** After adding a
file under `app/`, typecheck will complain about an unknown route until the dev server has been
started at least once, even briefly.

**The number of spaced-repetition levels is a setting, not a constant.** `DEFAULT_LEVELS` is 3
— two correct answers in a row to master a card — close to what the course itself recommends.
`DeckState` carries a `levels` field, and `createDeck` clamps a saved bucket down to the new top
when the user lowers the level count. Don't go back to a hardcoded `BUCKET_COUNT`.

**Answer letters are numbered by position on screen, not read from the content bundle**
(`src/content/answers.ts`). Answer order is shuffled, and the letter recorded in the source
describes the variant's position in the course, not its position on screen — showing the
source letter produced sequences like "B, C, A", which reads like a data bug. Grading still
goes by the source letter. Wherever a single answer is shown without a list (a flashcard, the
question review screen, the exam summary), there is no letter at all — there's nothing on
screen for it to refer to.

**A question's legal basis is revealed only after the answer is given.** The act's abbreviation
alone gives the answer away — seeing "KK" next to "Handlowanie amunicją bez zezwolenia to…"
rules out a misdemeanour by itself. In the ABC quiz it appears once a choice is made; in
flashcards, once the card is flipped; in the read-only preview, immediately, because the answer
has already happened there. In the exam, it appears only in the summary. Don't "fix" this into
being permanently visible.

**Previewing an earlier question remembers the pick and the answer order** (the `picks` and
`orders` maps on the practice screen, kept in memory only — nothing is written to the database,
since the preview only ever looks at the current session). The `picked` state belongs to the
current question, so without these maps the preview showed only the correct answer. Order is
remembered, not sorted alphabetically: sorting was meant to avoid re-shuffling on re-render, but
then an answer picked as "A" came back labelled "B".

**Flashcard progress and ABC-quiz progress are tracked separately.** The `progress` table has a
composite key `(question_id, mode)`, because they measure two different skills: a flashcard
tests recall of the answer's content, the quiz tests recognising it among distractors. The
`migrateProgressToModes` migration duplicates old rows into both modes; the duplication is
deliberate — losing progress would be a worse failure than crediting a session twice.

**Flashcards, the ABC quiz and the exam are three independent progress tracks.** The exam used
to write into the `test` mode's bucket, since the ABC format is identical — but the exam is a
measurement, not practice, and a single attempt could knock a question mastered through practice
back down. The exam's only trace is a row in `exam_attempts`, and its mistakes are read from
there by `missedQuestionIds`. "Exam from my mistakes" is built **exclusively** from that source;
an earlier version, `weakFirst`, mixed in weak questions from practice mode and was removed
along with that mixing. The counter next to the button has to be sourced from the exact same
place as the question pool, or the button disappears for someone who has exam mistakes but
doesn't practise with the ABC quiz.

**The exam mistake pool only cares about the latest verdict, not the mere fact of a mistake**
(`latestMisses`). An earlier version collected mistakes across the last ten attempts, and the
pool never healed: a question answered correctly afterwards stayed in the pool until enough
newer attempts pushed it out. Under the rule "the latest answer wins", a window over the number
of attempts becomes unnecessary.

**Question classification in the set-review screen has to produce the same numbers as the
progress bar.** `src/engine/questionList.ts` (behind `app/questions/[mode]/[sets].tsx`) mirrors
the rules from the deck-progress logic — untouched means a zero `seen` count, not "still in the
first bucket" — and a test compares both sources against each other. A mismatch would look like
a counting bug, since both numbers sit on the same screen. Manually marking a question
"mastered" **must** push `seen` above zero, or the question counts simultaneously as mastered
and untouched, and "needs work" comes out negative.

**There are two ways into a set's review screen**: long-pressing a set on the practice list
(a menu offering review and reset), or tapping the footer progress bar inside an open set. There
is deliberately no separate button in the header — one existed and was removed as a second path
to the exact same place.

**The `moje-bledy` set is virtual** — it isn't in the content bundle, it's assembled from the
progress database (`weakQuestionIds`). The practice screen recognises this slug and loads its
questions asynchronously. Its "done" condition differs from a normal set: it clears once every
question has left the bottom bucket, since mastering all of them to the top level is work spread
across many sessions.

**The number strip in the exam is the only way to see gaps in the paper.** The exam lets you
move on without answering, and "Finish" only appears on the last question — a skipped question
was otherwise unfindable: the warning said how many were unanswered, not which ones.
`src/components/ExamStrip.tsx` shows the whole paper's state and lets you jump, and the warning
names the actual numbers via `unansweredNumbers` and offers to jump to the first gap.

**There is one card component for an attempt's questions** (`src/components/AttemptAnswerCard.tsx`),
covering both the "Mistakes" and "Correct" sections, in the post-exam summary and in attempt
history alike. It used to exist as two copies, one per screen, and they drifted apart on every
change. Both sections must look identical — the only difference is the line showing your own
answer, which there's no reason to show when you got it right.

**An exam built from the weak-question pool goes through `buildPool`**, because `drawExam`
requires four critical questions and ten in total — and there may be fewer mistakes than that,
none of them critical. Without topping the pool up from the database, the screen would throw.

**Search matches from the start of a word, not anywhere inside it.** A plain `includes` made
"bron" (gun) match inside "obrona" (defence). `findAtWordStart` gets the same effect without a
lookbehind — deliberately, because the Hermes engine's regex lookbehind support has been
unreliable.

**A search result is one entry per act, the same way it's one entry per lesson.** A version with
one entry per matched article was written and thrown away: a common search term produced
hundreds of cards, impossible to scroll through to reach the questions. Opening an act launches
it with in-page search already active and scrolled to the first hit — after that, navigation is
by the same next/previous arrows used inside a lesson.

**Act text is stripped of markup once and memoized** (a `WeakMap` in `src/content/actSearch.ts`),
and the search screen does this warm-up right after mounting. All the acts together add up to
nearly 700 KB, so re-assembling Polish diacritics on every keystroke was visible as keyboard
lag. This is also why `search.ts` has `excerptAt` alongside `excerptAround`: the latter
assembles the whole text itself to find a position, while for acts the position is already
known.

**A unit smaller than an article stays on the same line as its text** in the act stylesheet
(`app/act/[slug].tsx`). A line break before a bare "§ 1." thinned an act out until a screen held
only a few words. Articles and chapters remain block-level, since they structure the document.
The rule **must** carry `:not(.unit)`: nested units share the same `pro-text` class as ordinary
body paragraphs, so without that exclusion the points inside a paragraph merge into one block.

**Acts are not sorted by hit count**, unlike lessons. The Kodeks karny (Penal Code) is five
times longer than the firearms act and would win on sheer length alone; the order that ships in
the bundle instead follows how close an act is to the course itself.

**A release build takes minutes, not seconds, and R8 is why.** Measured on the same machine and
the same tree: a release build with minification switched off finishes in **28 seconds**, with
it on in **7–11 minutes**. R8 processes the whole program at once, and the keep rules in
`app.config.js` widen what it has to chew through. Nothing is stuck — don't go looking for a
hung Gradle daemon, and budget for it before an AAB upload. Debug builds are unaffected.

The keep rules themselves are the other half of this: R8 removes whatever it can't see a
reference to, it can't see reflection, and **the build succeeds either way**. Two breakages
found this way, both silent, both invisible to `make check`: view-manager props stopped reaching
native views (blank WebView), and Fresco's image pipeline was gutted (every `<Image>` blank).
The rules and the symptom that identifies each one live in `KEEP_RULES` in `app.config.js`. The
way to pin such a thing down is a control build with `-Pandroid.enableMinifyInReleaseBuilds=false`
and the same screen side by side; R8's own reports (`android/app/build/outputs/mapping/release/`,
especially `usage.txt` and `configuration.txt`) then say what was dropped and which rules applied.

**Android release signing lives in `app.config.js`, not in `build.gradle`.** The React Native
template sets `release { signingConfig signingConfigs.debug }`, i.e. it signs the release build
with a key that ships in every checkout of the template on earth — Google Play rejects a file
signed with it. Patching the generated `android/app/build.gradle` directly **looks** like it
works, because `prebuild` patches an existing directory in place and the change survives on that
one machine; it does not survive `make clean-native`, a fresh clone, or someone else's machine,
and the build still succeeds either way. The `withReleaseSigning` plugin does the patching
instead. Two things matter inside it: it **must be idempotent** (the mod receives a file already
patched by the previous run, so without a guard on `PATENT_UPLOAD_STORE_FILE` a second
`make android` fails on a block it doesn't recognise), and the keystore password comes from an
**environment variable** backed by the macOS keychain, never from a file — `make android-aab`
pulls it, `make android` deliberately doesn't, since a weekly build to a personal phone has no
reason to prompt for the keychain.

**Text size has exactly one source of truth: the system setting.** There is, and should be, no
font-size slider inside the app. React Native's `Text` multiplies `fontSize` by the system scale
on its own, so the whole interface scales without any code of ours; the one exception is the
WebView, which receives pre-computed pixels from `contentBaseSize(systemScale)`
(`src/engine/settingsValues.ts`) through `lessonCss(theme, contentSize)`.

A separate in-app setting for this existed and **was removed**. It was built back when the
WebView didn't follow the system setting; once it did, it became a second control over the same
thing, covering only half the screen — picking a larger value grew the content while the chrome
around it stayed put. Don't bring it back without a reason that doesn't reproduce that same
inconsistency.

The whole thing works **together with** `textZoom: 100` for Android in `src/content/webviewProps.ts`.
Android's WebView scales HTML text to match the system setting on its own, so without that
property the enlargement would apply twice — and only on Android, since iOS doesn't do this.
Verified on the emulator at a system scale of 1.3.

The one place that limits scaling is the number strip in the exam
(`maxFontSizeMultiplier={1.3}` in `ExamStrip`): ten circles have to fit in a single row.
Nowhere else has `allowFontScaling={false}`, and it shouldn't be added anywhere else.

**A verdict in the ABC quiz has to carry a shape, not just a colour.** A green and a red
background are the same rectangle under deuteranopia, which affects close to 8% of men — a
group that sits this exact exam. After answering, the letter gives way to `✓` or `✗`; the
options with no verdict keep their letters. Don't revert to bare letters "for consistency".

**`hitSlop` must never overlap a sibling or a parent.** A handful of touch targets are
deliberately below platform guidelines, and each one says so on the spot: the circles in the
exam number strip are about 9 px apart, so their extra hit area only grows **vertically**; the
legal-basis link and the lesson links sit inside otherwise-tappable cards, where a nested
`Pressable` wins over its parent and every extra pixel is a tap stolen from the card. The rule:
never more than half the gap to the neighbour. This doesn't apply to scrolling — whether a
gesture counts as a tap is decided by a movement threshold, not by `hitSlop`.

**Icons are drawn by `assets/generate-icons.py`** — the artwork is original and deliberately
does not mirror the course's own logo. Don't try to recover their logo from `favicon.jpg`: it's
the course website's favicon, not a file in this repository, and at 170×169 px, against the
icon's required 1024×1024, there's nothing usable to recover from it either way.

## Tests

The spaced-repetition engine (`src/engine/leitner.ts`), the exam engine (`src/engine/exam.ts`),
the question-review logic (`src/engine/questionList.ts`), the link router
(`src/navigation/links.ts`), search (`src/content/search.ts`, `src/content/actSearch.ts`) and the
scripts injected into the WebView are all **free of React Native imports**, so they're tested
with plain vitest, without jest-expo and without running the app. Keep that boundary — inject
randomness through a `random` parameter so tests stay deterministic.

Test files import `describe`/`it` from `vitest`, but assertions from `node:assert/strict`.

The boundary is fragile in one direction: anything in `src/db/` that reaches into `expo-sqlite`
pulls in React Native's Flow syntax, which vitest can't parse. So `src/db/` **may** import from
`src/engine/` (that's how `missedQuestionIds` calls `latestMisses`), but never the other way
around. That's also why the reading-progress rules live in `src/engine/readingProgress.ts`, with
`src/db/reading.ts` only re-exporting them. Don't merge them back together — the tests will stop
running.

## Exam rules (reproduced from the course)

10 questions, 20 minutes, a 9/10 pass mark. The first 4 questions come from UoBiA and the safety
rules, and **must all be correct** — a mistake in that group of four fails the exam regardless
of the overall score. Question order and answer order are both shuffled. The local version does
not reproduce the course's server-side, shared attempt history stored under a "key".

Flashcards and the ABC quiz are different tools: a flashcard shows **only the correct answer**
(the goal is memorising its content), the quiz practises recognising it among distractors.

## Building for iPhone

The procedure, including the signing pitfalls, is in the README (the "Installing on an iPhone
without a laptop" section). Two things worth calling out: the build must use
`--configuration Release`, since a debug build would still pull JS from Metro, and Xcode's
suggested "Update to recommended settings" must be declined — `Enable User Script Sandboxing`
breaks the phase that embeds the JS bundle.

`ios/` is generated by `expo prebuild` from `app.json` and is not checked into the repo.
