import { useSyncExternalStore } from 'react';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Registered at import time: the browser fires `beforeinstallprompt` once, possibly before React mounts.
let deferred: InstallEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallEvent;
  emit();
});
addEventListener('appinstalled', () => {
  deferred = null;
  installed = true;
  emit();
});

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export type InstallState =
  | { kind: 'installed' }
  | { kind: 'prompt'; install: () => Promise<void> }
  | { kind: 'ios' }
  | { kind: 'unavailable' };

let cached: InstallState = { kind: 'unavailable' };
let cachedKey = '';

function snapshot(): InstallState {
  const key = installed || isStandalone() ? 'installed' : deferred ? 'prompt' : isIos() ? 'ios' : 'unavailable';
  if (key !== cachedKey) {
    cachedKey = key;
    cached =
      key === 'prompt'
        ? {
            kind: 'prompt',
            install: async () => {
              const evt = deferred!;
              await evt.prompt();
              await evt.userChoice;
              // A prompt event can be used only once.
              deferred = null;
              emit();
            },
          }
        : ({ kind: key } as InstallState);
  }
  return cached;
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    snapshot,
  );
}
