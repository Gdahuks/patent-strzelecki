/**
 * Interactive pistol diagram from the firearm-anatomy lesson.
 *
 * The course asks the reader to tap a part to see its name and description. That logic
 * lived in the page's own script, and the scraper strips scripts out — so in the app the
 * diagram was a plain drawing, and the caption asked for something that couldn't be done.
 * The content still carries everything needed: every part is a
 * `<g class="pistol-part" data-part="…">` with a `<title>`, and next to it sits a hidden
 * `<span class="pistol-part-data">` carrying the name and description.
 *
 * The course's own "point to a part" quiz is not here — the scraper strips its button. It
 * only worked embedded in the course site, and we have our own quizzing over the whole
 * question bank anyway.
 *
 * The script runs on every lesson and bails out immediately when there's no diagram in it.
 */
export function schematicScript(): string {
  return `(function () {
  var svg = document.getElementById('pistol-svg');
  if (!svg) return;

  var info = document.getElementById('pistol-info');
  var groups = svg.querySelectorAll('.pistol-part');
  if (!groups.length) return;

  // The caption under the diagram changes when a part is tapped, and a screen reader has
  // no way to know anything changed at all — marking it a live region makes it announce the
  // new content.
  if (info) info.setAttribute('aria-live', 'polite');

  // Part names and descriptions. The hidden spans take priority, since they also carry
  // a description; the SVG's <title> is a fallback for if the course ever stops adding them.
  var described = {};
  var dataNodes = document.querySelectorAll('.pistol-part-data');
  for (var d = 0; d < dataNodes.length; d++) {
    var node = dataNodes[d];
    described[node.getAttribute('data-part')] = {
      name: node.getAttribute('data-name') || '',
      desc: node.getAttribute('data-desc') || ''
    };
  }

  for (var g = 0; g < groups.length; g++) {
    // The course gives parts a tabindex for its own keyboard quiz. That quiz doesn't exist
    // here, and Android's WebView draws its own focus ring around a focused element — one
    // that can't be removed on an SVG, not with a style (Chromium ignores outline there) and
    // not with blur() (SVGElement doesn't have that method in this engine version). The only
    // option left is to strip focusability.
    groups[g].removeAttribute('tabindex');

    var key = groups[g].getAttribute('data-part');
    var title = groups[g].querySelector('title');
    if (!described[key]) described[key] = { name: title ? title.textContent : key, desc: '' };
    else if (!described[key].name && title) described[key].name = title.textContent;
  }

  function nameOf(key) { return (described[key] && described[key].name) || key; }

  // Name and role for the screen reader. In a separate loop, because only now is the
  // description map complete — the previous loop is what fills it in.
  //
  // Role and label alone are enough: a screen reader walks the accessibility tree, not tab
  // order, so a part with no tabindex attribute is still reachable for it. That's exactly
  // why focusability could be stripped (Android WebView's focus ring) while still keeping
  // the diagram accessible. Don't bring tabindex back here — the ring comes back with it.
  for (var a = 0; a < groups.length; a++) {
    groups[a].setAttribute('role', 'button');
    groups[a].setAttribute('aria-label', nameOf(groups[a].getAttribute('data-part')));
  }

  function clearMarks() {
    for (var i = 0; i < groups.length; i++) groups[i].setAttribute('data-state', '');
  }

  /**
   * Caption under the diagram: the name in bold, then the description.
   *
   * Built from DOM nodes, not an HTML string, because the name and description come from
   * attributes in the course content — an angle bracket in the description would break
   * rendering.
   */
  function show(name, desc) {
    if (!info) return;
    info.textContent = '';
    var strong = document.createElement('strong');
    strong.textContent = name;
    info.appendChild(strong);
    if (desc) info.appendChild(document.createTextNode(' — ' + desc));
  }

  for (var p = 0; p < groups.length; p++) {
    groups[p].addEventListener('click', function () {
      var key = this.getAttribute('data-part');
      clearMarks();
      this.setAttribute('data-state', 'active');
      show(nameOf(key), (described[key] || {}).desc);
    });
  }
})();
true;`;
}
