import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener: (type: 'release', fn: () => void) => void;
}

/**
 * Keep the screen on while `active` (install day: hands full, phone on a ladder). Browsers
 * drop the lock when the page is hidden, so it is asked for again when the page comes back.
 * Returns whether the screen is being kept on (false where the browser cannot).
 */
export function useWakeLock(active: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!active || !wl) return;
    let lock: WakeLockSentinelLike | undefined;
    let live = true;
    const ask = () => {
      if (document.visibilityState !== 'visible') return;
      wl.request('screen')
        .then((l) => {
          if (!live) return void l.release();
          lock = l;
          setOn(true);
          l.addEventListener('release', () => live && setOn(false));
        })
        .catch(() => setOn(false));
    };
    ask();
    document.addEventListener('visibilitychange', ask);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', ask);
      void lock?.release().catch(() => undefined);
      setOn(false);
    };
  }, [active]);
  return on;
}
