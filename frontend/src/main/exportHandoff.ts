import { isAbsolute } from 'node:path';

export interface RevealExportDependencies<TEvent = unknown> {
  assertSender: (event: TEvent) => void;
  showItemInFolder: (filePath: string) => void;
}

/** Validate renderer input before handing a path to Electron's shell API. */
export function validateRevealExportPath(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || !isAbsolute(value)) {
    throw new Error('A non-empty absolute export file path is required');
  }
  return value;
}

/** Keep sender validation and shell access injectable for a narrow IPC contract. */
export async function handleRevealExportFile<TEvent>(
  event: TEvent,
  value: unknown,
  dependencies: RevealExportDependencies<TEvent>,
): Promise<{ revealed: true }> {
  dependencies.assertSender(event);
  const filePath = validateRevealExportPath(value);
  dependencies.showItemInFolder(filePath);
  return { revealed: true };
}
