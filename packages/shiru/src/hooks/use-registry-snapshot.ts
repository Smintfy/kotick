import { useSyncExternalStore } from 'react';
import type { Registry, RegistrySnapshot } from '../types';

export function useRegistrySnapshot(registry: Registry): RegistrySnapshot {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
}
