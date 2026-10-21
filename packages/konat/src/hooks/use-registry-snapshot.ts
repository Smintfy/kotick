import * as React from 'react';
import type { Registry, RegistrySnapshot } from '../types';

export function useRegistrySnapshot(registry: Registry): RegistrySnapshot {
  return React.useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}
