import { Component, type ErrorInfo, type ReactNode } from 'react';

/** One failing page never blanks the site: the error is shown in place, with the way back, and logged with the build it came from. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`fox ${__BUILD__.commit}: page error`, error, info.componentStack); }
  componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel" role="alert" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>העמוד לא נטען</h1>
        <div className="muted">אירעה שגיאה בהצגת העמוד. שאר האתר זמין.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="chip" onClick={() => location.reload()}>טעינה מחדש</button>
          <a className="chip" href="/">דף הבית</a>
        </div>
        <div className="muted num" style={{ fontSize: 11 }}>{this.state.error.message} · {__BUILD__.commit}</div>
      </div>
    );
  }
}
