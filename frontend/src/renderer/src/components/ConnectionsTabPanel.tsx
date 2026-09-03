import { useCallback, useEffect, useState } from 'react';
import {
  connectMcpClient,
  detectMcpClients,
  type McpClientId,
  type McpClientStatus,
  type McpConnectResult,
} from '../api/client';

export function ConnectionsTabPanel() {
  const [clients, setClients] = useState<McpClientStatus[]>([]);
  const [connecting, setConnecting] = useState<McpClientId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<McpConnectResult | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    detectMcpClients()
      .then(setClients)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const connect = (clientId: McpClientId) => {
    setConnecting(clientId);
    setError(null);
    connectMcpClient(clientId)
      .then((result) => {
        setLastResult(result);
        refresh();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setConnecting(null));
  };

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <div className="settings-section-heading">
          <h3 className="settings-group-title">MCP desktop clients</h3>
          <span>Only desktop clients can inspect candidates and edit the open timeline.</span>
        </div>
        <p className="settings-hint">
          Connect an MCP-capable desktop client so it can inspect candidates and edit the open timeline.
        </p>

        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}

        <div className="mcp-client-list">
          {clients.map((client) => (
            <div key={client.id} className="mcp-client-row">
              <div>
                <div className="mcp-client-name">{client.name}</div>
                <div className="settings-muted">{client.configPath}</div>
              </div>
              <div className="mcp-client-actions">
                <span className={client.connected ? 'diagnostics-badge ok' : 'diagnostics-badge'}>
                  {client.detectError
                    ? 'Config unreadable'
                    : client.connected
                      ? 'Connected'
                      : client.installed
                        ? 'Detected'
                        : 'Not installed'}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => connect(client.id)}
                  disabled={connecting === client.id || !client.installed || Boolean(client.detectError)}
                >
                  {connecting === client.id ? 'Connecting...' : client.connected ? 'Reconnect' : 'Connect'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {lastResult && (
          <output className="mcp-connect-result">
            <p className="settings-saved">Connected. Restart {lastResult.name} to finish.</p>
            {lastResult.backupPath && (
              <p className="settings-muted">Backup created at {lastResult.backupPath}</p>
            )}
            <pre className="mcp-snippet">{lastResult.snippet}</pre>
          </output>
        )}
      </section>
    </div>
  );
}
