import { useState } from 'react';
import type { SyncState } from '../sync/engine';
import type { SyncStatus } from '../sync/useSync';
import { Sheet } from './Sheet';

interface Props {
  state: SyncState | undefined;
  status: SyncStatus;
  /** A code from a sync link: offer to join it. */
  linkCode?: string;
  onTurnOn: () => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onSyncNow: () => void;
  onTurnOff: () => void;
  onForget: () => void;
  onClose: () => void;
}

/** "3 minutes ago", "just now". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return new Date(at).toLocaleDateString();
}

export const syncLink = (code: string) => `${location.origin}${location.pathname}#sync=${code}`;

/**
 * Sync with your other devices: turn on (shows the code), join with a code, or, once on,
 * the code, the last sync, Sync now, Turn off and Delete cloud copy.
 */
export function SyncSheet({ state, status, linkCode, onTurnOn, onJoin, onSyncNow, onTurnOff, onForget, onClose }: Props) {
  const [code, setCode] = useState(linkCode ?? '');
  const [joining, setJoining] = useState(!!linkCode);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState('');

  const join = async () => {
    setError('');
    setWorking(true);
    try {
      await onJoin(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setWorking(false);
    }
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('');
      setError('Could not copy here: select the code and copy it by hand.');
    }
  };

  if (state) {
    return (
      <Sheet title="Sync with your other devices" onClose={onClose} className="sync-sheet">
        <p className="sync-status" role="status">
          {status.busy
            ? 'Syncing…'
            : status.error
              ? `Could not sync: ${status.error}`
              : state.lastSyncAt
                ? `Synced ${ago(state.lastSyncAt)}. Changes go across a few seconds after you make them.`
                : 'Not synced yet.'}
        </p>
        <p className="sync-label">Your sync code</p>
        <p className="sync-code" aria-label="Your sync code">
          {state.code}
        </p>
        <div className="row sync-actions">
          <button type="button" onClick={() => void copy(state.code, 'code')}>
            {copied === 'code' ? '✓ Copied' : 'Copy code'}
          </button>
          <button type="button" onClick={() => void copy(syncLink(state.code), 'link')}>
            {copied === 'link' ? '✓ Copied' : 'Copy link'}
          </button>
          <button type="button" className="primary" disabled={status.busy} onClick={onSyncNow}>
            Sync now
          </button>
        </div>
        {error && <p className="sync-error">{error}</p>}
        <p className="muted small">
          On your other device, open this app, then <b>⋯ → Sync with other devices → I have a code</b>, and type the code. Or open the link there. Keep the code private: anyone with it can see and change your plans.
        </p>
        <div className="row sync-off">
          <button type="button" onClick={onTurnOff}>
            Turn off on this device
          </button>
          <button type="button" className="danger" onClick={onForget}>
            Delete the cloud copy
          </button>
        </div>
        <p className="muted small">Turning off keeps your plans here. Deleting the cloud copy keeps the plans on every device; turn sync off on the others too, or they will upload theirs again.</p>
      </Sheet>
    );
  }

  return (
    <Sheet title="Sync with your other devices" onClose={onClose} className="sync-sheet">
      {!joining ? (
        <>
          <p>Keep the same plans and photos on your laptop and phone. Turn sync on here, then type the code on your other device.</p>
          <p className="muted small">
            Everything is scrambled on this device before it is sent, with your sync code as the key. The server only keeps the scrambled copy and cannot read it. There is no account and no password: the code is the key, so keep it private.
          </p>
          <div className="row sync-actions">
            <button
              type="button"
              className="primary"
              disabled={working}
              onClick={() => {
                setWorking(true);
                void onTurnOn().finally(() => setWorking(false));
              }}
            >
              Turn on sync
            </button>
            <button type="button" onClick={() => setJoining(true)}>
              I have a code
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <p>{linkCode ? 'Join the plans from this sync link?' : 'Type the sync code from your other device (⋯ → Sync with other devices).'}</p>
          <label className="field">
            <span>Sync code</span>
            <input
              aria-label="Sync code"
              value={code}
              autoFocus={!linkCode}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
            />
          </label>
          {error && <p className="sync-error">{error}</p>}
          <p className="muted small">
            Plans already on this device are added to the synced ones; nothing is deleted.{linkCode ? ' Only join a link you made yourself.' : ''}
          </p>
          <div className="row sync-actions">
            <button type="submit" className="primary" disabled={working || !code.trim()}>
              {working ? 'Joining…' : 'Join'}
            </button>
            <button
              type="button"
              onClick={() => {
                setJoining(false);
                setError('');
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
