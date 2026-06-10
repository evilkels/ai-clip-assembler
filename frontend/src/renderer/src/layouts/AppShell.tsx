import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-workspace">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}
