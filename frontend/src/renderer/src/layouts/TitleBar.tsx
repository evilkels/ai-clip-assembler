export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="titlebar-traffic" aria-hidden="true">
        <span className="traffic-light traffic-light-red" />
        <span className="traffic-light traffic-light-yellow" />
        <span className="traffic-light traffic-light-green" />
      </div>
      <div className="titlebar-title">
        <span className="titlebar-product">AI Clip Assembler</span>
        <span className="titlebar-project">sunset-drone-footage</span>
      </div>
      <button className="command-button" type="button" aria-label="Command palette placeholder" disabled>
        <span>Search commands</span>
        <kbd>⌘K</kbd>
      </button>
    </header>
  );
}
