'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const themes = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Theme" className="text-secondary-foreground" />}
      >
        {/* The class on <html> selects the icon, so the server render needs no theme. */}
        <SunIcon className="dark:hidden" />
        <MoonIcon className="not-dark:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-32">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          {themes.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick className="text-[13px]">
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
