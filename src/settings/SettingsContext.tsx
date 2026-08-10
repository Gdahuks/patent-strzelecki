import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { DEFAULT_LEVELS } from '../engine/leitner';
import { contentBaseSize } from '../engine/settingsValues';
import { loadSettings, saveLevels } from '../db/settings';

interface SettingsValue {
  /**
   * The content paragraph size in the WebView, in pixels — computed from the system
   * setting.
   *
   * This isn't an app setting and has no row in the database: the only control over text
   * size is the system's "Text Size". The rest of the interface follows it on its own,
   * because React Native's `Text` multiplies the size by that scale; the WebView doesn't
   * do that, so it gets pre-computed pixels from here instead.
   */
  contentSize: number;
  levels: number;
  setLevels: (levels: number) => void;
  loaded: boolean;
}

/**
 * A missing provider is an error, not a state — hence `null` instead of a default value.
 *
 * A dummy value used to sit here, with `loaded: false` permanently and setters that did
 * nothing. A screen used outside the provider then neither crashed nor warned: the app
 * just hung on "Przygotowuję materiały…", because `loaded` never became true. The
 * exception is now caught by `ErrorBoundary`, which shows it plainly.
 */
const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [levels, setLevelsState] = useState<number>(DEFAULT_LEVELS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadSettings()
      .then((settings) => {
        if (cancelled) return;
        setLevelsState(settings.levels);
      })
      // `catch` is needed here despite the `finally`: without it, a rejection carries on
      // as unhandled, i.e. a yellow-screen crash in dev mode over something we deliberately
      // treat as harmless. A failed settings read just means we fall back to the defaults —
      // and those are the initial state anyway.
      .catch(() => undefined)
      .finally(() => {
        // A failed settings read must not block startup.
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The write is optimistic: the interface shows the new value right away, because
  // reverting a choice under the user's finger would be worse than a brief mismatch with
  // the database. The rejection is swallowed deliberately — otherwise it stays unhandled.
  // A failed write has exactly one consequence: the setting reverts to the previous value
  // on the next start.
  const setLevels = useCallback((next: number) => {
    setLevelsState(next);
    saveLevels(next).catch(() => undefined);
  }, []);

  // `useWindowDimensions` is the only source here that **refreshes itself**: a change to
  // the system's text size goes through the dimensions event, so lessons re-render without
  // an app restart. `PixelRatio.getFontScale()` would give the same number, but only once.
  const { fontScale: systemScale } = useWindowDimensions();
  const contentSize = contentBaseSize(systemScale);

  return (
    <SettingsContext.Provider value={{ contentSize, levels, setLevels, loaded }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (value === null) {
    throw new Error('useSettings użyte poza SettingsProvider');
  }
  return value;
}
