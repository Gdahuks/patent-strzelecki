import type { Theme } from '../theme';

/**
 * The stylesheet injected into lessons rendered in the WebView.
 *
 * The content arrives as the course's original HTML, stripped of its own stylesheet.
 * Without this, it would render in the browser's default typography: margins too narrow
 * and text too small.
 *
 * `base` is the paragraph size **in pixels**, computed from the system's "Text Size"
 * setting (`contentBaseSize`). The WebView is the one thing that doesn't scale itself, so
 * it gets a ready-made number; every other size in this stylesheet is given in `em`, so it
 * follows along without being asked. The argument is required on purpose: a default value
 * would mean that calling this without one silently cuts the content off from the system
 * setting.
 */
export function lessonCss(theme: Theme, base: number): string {
  return `
    :root { color-scheme: ${theme.dark ? 'dark' : 'light'}; }
    * { box-sizing: border-box; }
    html { -webkit-overflow-scrolling: touch; }
    body {
      margin: 0;
      padding: 16px 18px 48px;
      background: ${theme.bg};
      color: ${theme.text};
      font: ${base}px/1.62 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-text-size-adjust: 100%;
      overflow-wrap: anywhere;
    }
    p { margin: 0 0 1.05em; }
    h4, h5, h6 {
      margin: 1.9em 0 0.6em;
      line-height: 1.3;
      color: ${theme.text};
    }
    h4 { font-size: 1.28em; }
    h5 { font-size: 1.14em; }
    h6 { font-size: 1.02em; }
    a { color: ${theme.accent}; text-decoration: none; }
    strong { font-weight: 650; }
    center { display: block; margin: 1.4em 0 0.5em; font-weight: 650; color: ${theme.muted}; }
    ul, ol { padding-left: 1.35em; margin: 0 0 1.05em; }

    /* Interactive pistol diagram. The course has its own stylesheet for it, which we
       don't fetch — without these rules the parts don't look clickable, and the quiz
       button looks like a bare form element. States are set by schematicScript. */
    .pistol-part { cursor: pointer; }
    /* Parts carry a tabindex in the content, so after a tap the browser drew its own
       orange outline around them — next to our own highlight, it looked like a bug. Plain
       :focus wasn't enough: with a keyboard attached (which is the case on the emulator),
       the focus counts as keyboard focus and :focus-visible draws the outline. We already
       show selection with our own outline in the accent colour, so nothing is lost. */
    .pistol-part:focus, .pistol-part:focus-visible { outline: none; }
    .pistol-part[data-state="active"] * { stroke: ${theme.accent}; stroke-width: 6; }
    .pistol-part[data-state="ok"] * { stroke: ${theme.good}; stroke-width: 6; }
    .pistol-part[data-state="bad"] * { stroke: ${theme.bad}; stroke-width: 6; }
    .pistol-info {
      margin: 0.6em 0 1em;
      padding: 0.7em 0.9em;
      border-left: 3px solid ${theme.accent};
      background: ${theme.surface};
      border-radius: 0 8px 8px 0;
      line-height: 1.45;
    }
    button.button-primary {
      font: inherit;
      font-weight: 600;
      color: ${theme.onFill};
      background: ${theme.accent};
      border: 0;
      border-radius: 10px;
      padding: 0.7em 1.1em;
    }
    #pistol-quiz p { margin: 0 0 1em; }
    li { margin-bottom: 0.4em; }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 10px;
      display: block;
      margin: 1.2em auto;
      background: ${theme.surface};
    }
    blockquote {
      margin: 1.2em 0;
      padding: 0.1px 1em;
      border-left: 3px solid ${theme.border};
      color: ${theme.muted};
    }
    /* The course's grid is two-column — on a phone it has to collapse into one. */
    .row { display: block; }
    .one-half.column, .one-third.column, .two-thirds.column, .column { width: 100%; }
    table { width: 100%; border-collapse: collapse; display: block; overflow-x: auto; }
    /* Cells opt out of the breaking set on the body. Inherited, overflow-wrap: anywhere
       counts towards a cell's min-content width, so a column can be squeezed down to a
       single character — the course's finance table then reads vertically, digit under
       digit. It also keeps the table from ever growing past the screen, which is why the
       overflow-x above had nothing to scroll. Back on normal, a column is at least as wide
       as its longest word and a table too wide for the screen scrolls sideways instead. */
    td, th { border: 1px solid ${theme.border}; padding: 8px; overflow-wrap: normal; }

    /* Glossary abbreviations: marked, but without the look of a link — tapping shows
       the expansion right there, instead of opening a new screen. */
    abbr.skrot {
      text-decoration: none;
      border-bottom: 1px dashed ${theme.accent};
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    /* Search hits in the text: all of them on the same ground as a hit on a result card,
       the current one more strongly. */
    mark.psx {
      background: ${theme.mark};
      color: ${theme.text};
      border-radius: 3px;
      padding: 0 1px;
    }
    mark.psx-now {
      background: ${theme.dark ? '#d99a1a' : '#ffcc33'};
      color: #15181c;
      box-shadow: 0 0 0 2px ${theme.dark ? '#d99a1a' : '#ffcc33'};
    }
    .skrot-dymek {
      position: absolute;
      z-index: 10;
      box-sizing: border-box;
      max-width: calc(100vw - 24px);
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid ${theme.border};
      background: ${theme.surface};
      color: ${theme.text};
      font-size: 0.82em;
      line-height: 1.45;
      box-shadow: 0 6px 20px rgba(0, 0, 0, ${theme.dark ? '0.5' : '0.16'});
    }
  `;
}
