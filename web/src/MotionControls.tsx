import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { LiquidGlass } from './LiquidGlass';

export const spring = { type: 'spring', stiffness: 460, damping: 34, mass: 0.75 } as const;
type Value = string | number;
export function SegmentedControl<T extends Value>({
  label,
  options,
  value,
  onChange,
  className = '',
  disabled = false,
}: {
  label: string;
  options: readonly { value: T; label: ReactNode; href?: string }[];
  value: T;
  onChange?: (v: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div className={'segments ' + className} role="group" aria-label={label}>
        {options.map((o) => {
          const active = o.value === value;
          const content = (
            <>
              {active && <motion.div layoutId="droplet" className="droplet" transition={spring} />}
              <span className="segment-label">{o.label}</span>
            </>
          );
          return o.href ? (
            <a key={o.value} href={o.href} aria-current={active ? 'page' : undefined}>
              {content}
            </a>
          ) : (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange?.(o.value)}
            >
              {content}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          exit={{ height: 0 }}
          transition={spring}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export function Popover({
  children,
  close,
  label,
  className = '',
}: {
  children: ReactNode;
  close: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const reduced = useReducedMotion();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus({ preventScroll: true });
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className={'overlay ' + className}>
      <div className="outside" onClick={close} />
      <motion.div
        className="popover-frame"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={ref}
        tabIndex={-1}
        initial={{ scale: reduced ? 1 : 0.95, y: reduced ? 0 : -5 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: reduced ? 1 : 0.95, y: reduced ? 0 : -5 }}
        transition={spring}
      >
        <LiquidGlass regular>
          <div className="popover-body">{children}</div>
        </LiquidGlass>
      </motion.div>
    </div>
  );
}
