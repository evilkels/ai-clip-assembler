export function ImportPage() {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Import</h1>
          <p>Drop drone footage here. Backend ingestion lands with #2 / #3.</p>
        </div>
      </div>
      <div className="page-body">
        <div className="empty-state">
          <div>
            <p style={{ fontSize: 14, marginBottom: 6 }}>No videos imported yet.</p>
            <p style={{ color: 'var(--text-muted)' }}>
              The Review tab is wired to mock clip data so you can iterate on the
              review workflow before backend analysis is available.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
