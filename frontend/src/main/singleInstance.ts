export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): void;
}

export interface FocusableWindow {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

export interface WindowRegistry {
  getAllWindows(): FocusableWindow[];
}

export function installSingleInstanceGuard(app: SingleInstanceApp, windows: WindowRegistry): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => {
    const [win] = windows.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  return true;
}
