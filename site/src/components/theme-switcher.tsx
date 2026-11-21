'use client';

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

const themes = [
  { value: 'system', label: 'System', Icon: MonitorIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

const noChange = () => () => {};

/*
 * The shadcn RadioGroupItem always draws its own dot and ignores children, so it cannot hold an icon.
 * This uses the Base UI ToggleGroup with the TabsList and TabsTrigger styles, at a smaller size.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  // The server does not know the theme, so no item is pressed until the client renders.
  const mounted = useSyncExternalStore(noChange, () => true, () => false);

  return (
    <ToggleGroup
      aria-label="Theme"
      value={mounted && theme ? [theme] : []}
      onValueChange={([next]) => next && setTheme(next)}
      className="inline-flex h-7 w-fit items-center rounded-lg bg-accent p-[2px] text-muted-foreground"
    >
      {themes.map(({ value, label, Icon }) => (
        <Toggle
          key={value}
          value={value}
          aria-label={label}
          className="inline-flex size-6 items-center justify-center rounded-md border border-transparent text-foreground/60 transition-all outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-edge [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0"
        >
          <Icon />
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
