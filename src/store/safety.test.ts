import { describe, expect, it } from 'vitest';
import { isIosBrowserTab, noteBackup, noteEdit, shouldNudgeBackup, shouldShowIosTip, snoozeBackup, type SafetyState } from './safety';
import { newVersionAvailable } from './update';

const DAY = 24 * 60 * 60 * 1000;
const edits = (n: number, s: SafetyState = { editsSinceBackup: 0 }, now = 0) => {
  for (let i = 0; i < n; i++) s = noteEdit(s, now);
  return s;
};

describe('keeping plans safe', () => {
  it('suggests a first backup after a real amount of work', () => {
    expect(shouldNudgeBackup(edits(39), 0)).toBe(false);
    expect(shouldNudgeBackup(edits(40), 0)).toBe(true);
  });

  it('after a backup, waits for both new work and two weeks', () => {
    const backed = noteBackup(edits(50), 0);
    expect(backed.editsSinceBackup).toBe(0);
    expect(shouldNudgeBackup(edits(30, backed), 13 * DAY)).toBe(false);
    expect(shouldNudgeBackup(edits(30, backed), 15 * DAY)).toBe(true);
    expect(shouldNudgeBackup(edits(10, backed), 30 * DAY)).toBe(false);
  });

  it('"Later" snoozes for a week', () => {
    const s = snoozeBackup(edits(60), 0);
    expect(shouldNudgeBackup(s, 6 * DAY)).toBe(false);
    expect(shouldNudgeBackup(s, 8 * DAY)).toBe(true);
  });

  it('shows the iPhone tip once, in a Safari tab, after some work', () => {
    expect(shouldShowIosTip(edits(4), true)).toBe(false);
    expect(shouldShowIosTip(edits(5), true)).toBe(true);
    expect(shouldShowIosTip(edits(5), false)).toBe(false);
    expect(shouldShowIosTip({ ...edits(9), iosTipDone: true }, true)).toBe(false);
  });

  it('knows an iPhone tab from the Home Screen app and from other phones', () => {
    const nav = (userAgent: string, extra = {}) => ({ userAgent, platform: 'iPhone', maxTouchPoints: 5, ...extra }) as unknown as Navigator;
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
    expect(isIosBrowserTab(nav(iphone), false)).toBe(true);
    expect(isIosBrowserTab(nav(iphone, { standalone: true }), false)).toBe(false);
    expect(isIosBrowserTab(nav(iphone), true)).toBe(false);
    expect(isIosBrowserTab(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131 Mobile', { platform: 'Linux' }), false)).toBe(false);
  });
});

describe('new version check', () => {
  const reply = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  it('compares the published build with this one', async () => {
    expect(await newVersionAvailable(reply({ build: 'abc' }), 'abc')).toBe(false);
    expect(await newVersionAvailable(reply({ build: 'def' }), 'abc')).toBe(true);
    expect(await newVersionAvailable(reply({}, false), 'abc')).toBe(false);
    expect(await newVersionAvailable((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'abc')).toBe(false);
  });
});
