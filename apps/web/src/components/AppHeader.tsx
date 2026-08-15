export function AppHeader() {
  return (
    <header className="app-header">
      <h1>Basket Lab</h1>
      <div className="app-header-meta">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.href).catch(() => {});
          }}
        >
          Share
        </button>
        <p className="status-line">Local</p>
      </div>
    </header>
  );
}
