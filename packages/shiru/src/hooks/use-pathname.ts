import { useSyncExternalStore } from 'react';

/**
 * The page's path, such as `/checkout`, or '' on the server.
 * Client routers change it with pushState(), which fires no event, so the Navigation API's currententrychange is the
 * source where the browser has it. popstate covers Back and Forward in the other browsers.
 */
export function usePathname(): string {
  return useSyncExternalStore(subscribeToLocation, readPathname, () => '');
}

function readPathname(): string {
  return window.location.pathname;
}

function subscribeToLocation(onChange: () => void): () => void {
  const navigation = 'navigation' in window ? window.navigation : undefined;

  // The Next.js App Router calls pushState() in an insertion effect, and Chrome fires currententrychange in that call.
  // React must not get an update while it runs insertion effects, so it gets the change after the commit.
  const onLocationChange = () => queueMicrotask(onChange);

  window.addEventListener('popstate', onLocationChange);
  navigation?.addEventListener('currententrychange', onLocationChange);

  return () => {
    window.removeEventListener('popstate', onLocationChange);
    navigation?.removeEventListener('currententrychange', onLocationChange);
  };
}
