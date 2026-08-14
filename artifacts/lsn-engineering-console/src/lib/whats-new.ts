/**
 * Once-per-version desktop "What's New" acknowledgment.
 *
 * The acknowledged version is stored under its own localStorage key,
 * deliberately independent of the optional engineering-state persistence
 * setting, so clearing or disabling engineering persistence never causes the
 * dialog to reappear (or to be lost) unexpectedly.
 */

export const WHATS_NEW_STORAGE_KEY = 'lsn-whats-new-acknowledged-version';

/** Pure decision: show only when the installed version is newly unacknowledged. */
export function shouldShowWhatsNew(
  acknowledgedVersion: string | null,
  currentVersion: string,
  isPackagedDesktop: boolean,
): boolean {
  if (!isPackagedDesktop) return false;
  return acknowledgedVersion !== currentVersion;
}

export function getAcknowledgedWhatsNewVersion(storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    return storage.getItem(WHATS_NEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function acknowledgeWhatsNew(
  version: string,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(WHATS_NEW_STORAGE_KEY, version);
  } catch {
    // Storage unavailable: the dialog may reappear next launch, which is the
    // safe failure mode (never silently suppress release information).
  }
}
