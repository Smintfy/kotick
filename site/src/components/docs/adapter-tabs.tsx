'use client';

import { type ReactNode, useSyncExternalStore } from 'react';
import { barTab } from '@/components/docs/bar-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Adapter, adapters } from '@/content/adapters';

// One choice for the whole site, so each tab group and each demo shows the adapter that the reader selected last.
const storageKey = 'konat-docs:adapter';
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

function AdapterList() {
  return (
    <TabsList aria-label="Adapter" activateOnFocus className="gap-px bg-transparent p-0">
      {adapters.map(({ id, label }) => (
        <TabsTrigger key={id} value={id} className={barTab}>
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/** The tabs alone, for a bar whose content changes with the adapter. */
export function AdapterSwitch() {
  const [adapter, setAdapter] = useAdapter();

  return (
    <Tabs value={adapter} onValueChange={setAdapter}>
      <AdapterList />
    </Tabs>
  );
}

/** The docs text of each adapter, in an `<AdapterTab>` for each one. */
export function AdapterTabs({ children }: { children: ReactNode }) {
  const [adapter, setAdapter] = useAdapter();

  return (
    <Tabs value={adapter} onValueChange={setAdapter} className="gap-3">
      <AdapterList />
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
