import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
type Size = 'sm' | 'md' | 'lg';

/** Bouton du design system ; `icon` seul (sans enfant) donne un bouton carré. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  block,
  className,
  children,
  type = 'button',
  ...props
}: {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const iconOnly = icon && !children;
  const classes = [
    'btn',
    `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    iconOnly && 'btn-icon',
    block && 'btn-block',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const iconSize = size === 'sm' ? 15 : 17;
  return (
    <button type={type} className={classes} {...props}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}

/** Champ de formulaire : libellé, contrôle, aide ou erreur. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: le contrôle est passé en enfant
    <label className={['field', className].filter(Boolean).join(' ')}>
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </label>
  );
}

export function Badge({
  tone,
  children,
  icon,
}: {
  tone?: 'primary' | 'success' | 'warning' | 'danger' | undefined;
  children: ReactNode;
  icon?: IconName | undefined;
}) {
  return (
    <span className={`badge${tone ? ` badge-${tone}` : ''}`}>
      {icon && <Icon name={icon} size={12} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

const AVATAR_COLORS = [
  '#4f46e5',
  '#0891b2',
  '#059669',
  '#d97706',
  '#db2777',
  '#7c3aed',
  '#2563eb',
  '#dc2626',
];

/** Couleur stable dérivée d'un texte (nom, identifiant). */
export function colorFor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}

/** Initiales d'un nom : « Lucas Joblin » → « LJ ». */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0]}${parts.at(-1)?.[0]}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({
  name,
  color,
  size = 'md',
  title,
}: {
  name: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}) {
  return (
    <span
      className={`avatar${size !== 'md' ? ` avatar-${size}` : ''}`}
      style={{ background: color ?? colorFor(name) }}
      title={title ?? name}
    >
      {initials(name)}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Chargement" />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Fenêtre modale : Échap ou clic à l'extérieur la ferment. */
export function Modal({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: fond cliquable, Échap pour le clavier
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <Button variant="ghost" size="sm" icon="x" aria-label="Fermer" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Menu déroulant attaché à un bouton ; se ferme au clic extérieur ou sur une entrée. */
export function Menu({
  trigger,
  children,
  align = 'end',
  placement = 'below',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  placement?: 'below' | 'above';
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setAnchor(null);
    };
    const close = () => setAnchor(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    // Position fixe : le menu se ferme si la page défile ou change de taille.
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  const toggle = () =>
    setAnchor((current) => (current ? null : (ref.current?.getBoundingClientRect() ?? null)));
  return (
    <div ref={ref} style={{ display: 'inline-flex' }}>
      {trigger({ onClick: toggle, 'aria-expanded': open })}
      {anchor &&
        createPortal(
          // biome-ignore lint/a11y/useKeyWithClickEvents: les entrées sont des boutons et des liens
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            style={{
              position: 'fixed',
              ...(align === 'end'
                ? { right: window.innerWidth - anchor.right }
                : { left: anchor.left }),
              ...(placement === 'below'
                ? { top: anchor.bottom + 6 }
                : { bottom: window.innerHeight - anchor.top + 6 }),
            }}
            onClick={() => setAnchor(null)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  href,
  danger,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const content = (
    <>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </>
  );
  const className = `menu-item${danger ? ' danger' : ''}`;
  return href ? (
    <a role="menuitem" className={className} href={href}>
      {content}
    </a>
  ) : (
    <button type="button" role="menuitem" className={className} onClick={onClick}>
      {content}
    </button>
  );
}

// ---------------------------------------------------------------- toasts

type Toast = { id: number; message: string; icon?: IconName | undefined };
let toasts: Toast[] = [];
let nextToast = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Message bref en bas de l'écran (copie d'un lien, action terminée…). */
export function toast(message: string, icon?: IconName): void {
  const id = nextToast++;
  toasts = [...toasts, { id, message, icon }];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((item) => item.id !== id);
    emit();
  }, 3200);
}

export function ToastRegion() {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const items = useSyncExternalStore(subscribe, () => toasts);
  return createPortal(
    <div className="toast-region" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className="toast">
          {item.icon && <Icon name={item.icon} size={16} />}
          {item.message}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Copie un texte dans le presse-papiers et le signale. */
export async function copyText(text: string, confirmation: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(confirmation, 'check');
  } catch {
    toast('Copie impossible : sélectionnez le texte manuellement');
  }
}
