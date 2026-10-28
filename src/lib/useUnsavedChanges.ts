import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/** Data-router transitions and full-document exits need separate guards. */
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const blocker = useBlocker(useCallback(() => {
    if (!dirty && !busy) return false;
    const active = document.activeElement as HTMLElement | null;
    if (!active?.closest('[data-navigation-prompt]')) previousFocus.current = active;
    return true;
  }, [dirty, busy]));

  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  useEffect(() => {
    if (blocker.state === 'blocked') stayButton.current?.focus();
  }, [blocker.state]);

  function stay() {
    if (blocker.state !== 'blocked') return;
    blocker.reset();
    previousFocus.current?.focus();
  }
  function leave() {
    if (!busy && blocker.state === 'blocked') blocker.proceed();
  }
  return { blocked: blocker.state === 'blocked', stayButton, stay, leave };
}
