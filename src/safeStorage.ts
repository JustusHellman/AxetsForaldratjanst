// localStorage / sessionStorage can throw (private mode, blocked site data, some in-app browsers).
// These helpers never throw: reads fall back to null, writes are silently skipped.
type StoreName = 'localStorage' | 'sessionStorage';

function store(name: StoreName): Storage | null {
  try {
    return typeof window !== 'undefined' ? window[name] : null;
  } catch {
    return null;
  }
}

export function safeGet(key: string, name: StoreName = 'localStorage'): string | null {
  try {
    return store(name)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(key: string, value: string, name: StoreName = 'localStorage'): void {
  try {
    store(name)?.setItem(key, value);
  } catch {
    /* ignore */
  }
}
