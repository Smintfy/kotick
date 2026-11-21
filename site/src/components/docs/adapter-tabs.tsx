'use client';

import { ChevronDownIcon } from 'lucide-react';
import { type ComponentType, createContext, type ReactNode, use, useSyncExternalStore } from 'react';
import { ReactLogo } from '@/components/logo/react';
import { StatelyLogo } from '@/components/logo/stately';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Adapter, adapters } from '@/content/adapters';

const logos: Record<Adapter, ComponentType<{ className?: string }>> = {
  xstate: StatelyLogo,
  reducer: ReactLogo,
};

// One choice for the whole site, so each tab group and each demo shows the adapter that the reader selected last.
const storageKey = 'shiru-docs:adapter';
const listeners = new Set<() => void>();
let chosen: Adapter | undefined;

function stored(): Adapter {
  try {
    const value = localStorage.getItem(storageKey);

    return adapters.find(({ id }) => id === value)?.id ?? adapters[0].id;
  } catch {
    return adapters[0].id;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function current(): Adapter {
  chosen ??= stored();

  return chosen;
}

const first = (): Adapter => adapters[0].id;

function choose(adapter: Adapter): void {
  chosen = adapter;

  try {
    localStorage.setItem(storageKey, adapter);
  } catch {
    // Without storage, the choice stays until the page reloads.
  }

  for (const listener of listeners) listener();
}

export function useAdapter(): [Adapter, (adapter: Adapter) => void] {
  return [useSyncExternalStore(subscribe, current, first), choose];
}

const PageTabs = createContext(false);

/** Tell the content of a page whether it has adapter tabs. With the tabs, the blocks of the page have no adapter menus. */
export function PageAdapterTabsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <PageTabs value={enabled}>{children}</PageTabs>;
}

/** Whether a block shows its own adapter menu: only on a page without adapter tabs. */
export function useInlineSwitch(): boolean {
  return !use(PageTabs);
}

// The underline of the active tab sits on this divider, which spans the content column.
const tabBar = 'border-b border-input pb-0.5';

function AdapterTabList() {
  return (
    <TabsList variant="line" aria-label="Adapter" className="gap-5">
      {adapters.map(({ id, label }) => {
        const Logo = logos[id];

        return (
          <TabsTrigger key={id} value={id} className="px-0">
            <Logo className="size-4" />
            {label}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}

/** The adapter tabs of a page. Put them after the introduction of the page. */
export function PageAdapterTabs() {
  const [adapter, setAdapter] = useAdapter();

  return (
    <Tabs value={adapter} onValueChange={setAdapter} className={`my-8 [&+:is(h2,h3)]:mt-0 ${tabBar}`}>
      <AdapterTabList />
    </Tabs>
  );
}

/** The adapter menu alone, for a box whose content changes with the adapter. */
export function AdapterSwitch() {
  const [adapter, setAdapter] = useAdapter();
  const { label } = adapters.find(({ id }) => id === adapter) ?? adapters[0];
  const Logo = logos[adapter];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="pr-1.5 pl-2 font-normal" />}>
        <span className="sr-only">Adapter: </span>
        <Logo className="size-4" />
        {label}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-(--anchor-width)">
        <DropdownMenuRadioGroup value={adapter} onValueChange={setAdapter}>
          {adapters.map(({ id, label }) => {
            const ItemLogo = logos[id];

            return (
              <DropdownMenuRadioItem key={id} value={id} closeOnClick>
                <ItemLogo className="size-4" />
                {label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The docs text of each adapter, in an `<AdapterTab>` for each one. Without page tabs, the section has tabs of its own. */
export function AdapterTabs({ children }: { children: ReactNode }) {
  const [adapter, setAdapter] = useAdapter();
  const inline = useInlineSwitch();

  return (
    <Tabs value={adapter} onValueChange={setAdapter} className={inline ? 'my-8 gap-8' : 'gap-3'}>
      {inline && (
        <div className={tabBar}>
          <AdapterTabList />
        </div>
      )}
      {children}
    </Tabs>
  );
}

export function AdapterTab({ adapter, children }: { adapter: Adapter; children: ReactNode }) {
  return (
    <TabsContent value={adapter} keepMounted>
      {children}
    </TabsContent>
  );
}
