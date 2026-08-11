/**
 * Update notice contract shared by the main process, preload bridge and
 * renderer. `dismissed` and `unknown` both mean "show nothing" to the UI, but
 * are kept distinct so diagnostics can tell a silenced notice from a failed
 * check.
 */
export type UpdateStatus =
  | {
      state: 'update-available';
      currentVersion: string;
      latestVersion: string;
      releaseUrl: string;
    }
  | { state: 'up-to-date'; currentVersion: string; latestVersion: string }
  | { state: 'dismissed'; currentVersion: string; latestVersion: string }
  | { state: 'unknown'; currentVersion: string; detail: string };
