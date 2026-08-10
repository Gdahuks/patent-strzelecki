import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs, useRouter } from 'expo-router';

import { HeaderIcon } from '../../src/components/HeaderIcon';
import { useTheme } from '../../src/theme';

/**
 * Tab icon — vector, not emoji, and filled once selected.
 *
 * Emoji had two flaws here, both verifiable on a device. They render in their own colours, so
 * `tabBarActiveTintColor` didn't touch them and the label's colour was the only sign of the
 * active tab — colour alone, unreadable under a colour-vision deficiency. Second: a screen
 * reader announces the emoji's name before the tab's name ("open book, Nauka").
 *
 * The filled variant for the selected tab adds a second signal alongside colour — shape.
 * Same argument as behind `HeaderIcon`: icons in this app are vector-based.
 */
function icon(name: keyof typeof Ionicons.glyphMap, active: keyof typeof Ionicons.glyphMap) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? active : name} size={22} color={color} />
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        // Android left-aligns the title by default (Material convention), iOS centres it —
        // so the same screen looks different on each platform, and on Android the title
        // sticks to "Ustawienia" despite having an action on both sides. Forcing centre on
        // both. Tab titles are short, so there's nothing to get truncated.
        headerTitleAlign: 'center',
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        sceneStyle: { backgroundColor: theme.bg },
        // The colour in headers has to be explicit — without it the text gets the default
        // black and disappears on a dark background.
        //
        // Navigation, not `push`: two quick taps stacked two identical screens, so going
        // back required two back taps. `navigate` returns to the one already open.
        headerLeft: () => (
          <HeaderIcon
            name="settings-outline"
            label="Ustawienia"
            onPress={() => router.navigate('/settings')}
          />
        ),
        headerRight: () => (
          <HeaderIcon name="search" label="Szukaj" onPress={() => router.navigate('/search')} />
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Nauka', tabBarIcon: icon('book-outline', 'book') }}
      />
      <Tabs.Screen
        name="practice"
        options={{ title: 'Ćwiczenia', tabBarIcon: icon('albums-outline', 'albums') }}
      />
      <Tabs.Screen
        name="exam"
        options={{ title: 'Egzamin', tabBarIcon: icon('clipboard-outline', 'clipboard') }}
      />
    </Tabs>
  );
}
