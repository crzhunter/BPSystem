import { useEffect, useState, type ReactNode } from 'react';
import { Popover } from './MotionControls';
import { api, failure } from './api';

export function StudioHeader({
  title,
  description,
  stat,
  children,
}: {
  title: string;
  description: string;
  stat?: string;
  children?: ReactNode;
}) {
  return (
    <header className="studio-header">
      <div>
        <div className="studio-heading">
          <h1>{title}</h1>
          {stat && <small>{stat}</small>}
        </div>
        <p>{description}</p>
      </div>
      {children && <div className="studio-actions">{children}</div>}
    </header>
  );
}
export function StudioDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Popover label={title} close={close} className="studio-overlay">
      <header>
        <h2>{title}</h2>
        <button onClick={close} aria-label="关闭浮层">
          关闭
        </button>
      </header>
      {children}
    </Popover>
  );
}
export function useStudioData<T>(path: string | null, revision: unknown = 0) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string }>();
  useEffect(() => {
    if (!path) return;
    const abort = new AbortController();
    api<T>(path, 'GET', undefined, abort.signal).then(
      (data) => {
        if (!abort.signal.aborted) setResult({ path, data });
      },
      (e) => {
        if (!abort.signal.aborted) setResult({ path, error: failure(e) });
      },
    );
    return () => abort.abort();
  }, [path, revision]);
  return result?.path === path ? result : undefined;
}
