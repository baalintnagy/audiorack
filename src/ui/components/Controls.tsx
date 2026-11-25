import type { ReactNode } from 'react';

export function Toggle({
    active,
    onChange,
    children,
    title,
    color,
    className = '',
}: {
    active: boolean;
    onChange: (active: boolean) => void;
    children: ReactNode;
    title?: string;
    color?: string;
    className?: string;
}) {
    return (
        <button
            type="button"
            className={`toggle ${active ? 'on' : ''} ${className}`}
            aria-pressed={active}
            title={title}
            style={color ? { ['--toggle-color' as string]: color } : undefined}
            onClick={() => onChange(!active)}
        >
            {children}
        </button>
    );
}

export function Segmented<T extends string | number>({
    value,
    options,
    onChange,
    label,
    color,
    vertical = false,
}: {
    value: T;
    /** With an `icon`, the label becomes the accessible name and `title` the hover hint. */
    options: { value: T; label: string; icon?: ReactNode; title?: string }[];
    onChange: (value: T) => void;
    label?: string;
    color?: string;
    vertical?: boolean;
}) {
    return (
        <div
            className={`segmented ${vertical ? 'vertical' : ''}`}
            role="radiogroup"
            aria-label={label}
            style={color ? { ['--toggle-color' as string]: color } : undefined}
        >
            {label && <span className="segmented-label">{label}</span>}
            <div className="segmented-options">
                {options.map((option) => (
                    <button
                        type="button"
                        key={option.value}
                        role="radio"
                        aria-checked={option.value === value}
                        className={`${option.value === value ? 'on' : ''} ${option.icon ? 'icon' : ''}`}
                        onClick={() => onChange(option.value)}
                        title={option.title}
                        aria-label={option.icon ? option.label : undefined}
                    >
                        {option.icon ?? option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function PowerIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
                d="M8 1.5v6M4.4 3.6a5.5 5.5 0 1 0 7.2 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

/** A chevron pointing left, or right when `right` is set. */
export function ChevronIcon({ right = false }: { right?: boolean }) {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
                d={right ? 'M6 3l5 5-5 5' : 'M10 3 5 8l5 5'}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Two columns of dots, marking something that can be dragged to reorder it. */
export function GripIcon() {
    return (
        <svg viewBox="0 0 10 16" width="8" height="14" aria-hidden="true">
            {[3, 7].flatMap((x) =>
                [3, 8, 13].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />),
            )}
        </svg>
    );
}

/** A floppy disk, for saving a preset. */
export function SaveIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
                d="M2.5 2.5h8.5l2.5 2.5v8.5h-11zM5 2.5v3.5h5.5V2.5M5 13.5V9.5h6v4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** An arrow into a tray, for exporting to a file; `up` points it out of the tray, for importing. */
export function FileArrowIcon({ up = false }: { up?: boolean }) {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
                d={
                    up
                        ? 'M8 10.5V2M4.8 5.2 8 2l3.2 3.2M2.5 10v3.5h11V10'
                        : 'M8 2v8.5M4.8 7.3 8 10.5l3.2-3.2M2.5 10v3.5h11V10'
                }
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** The signal path detouring around an effect. */
export function BypassIcon() {
    return (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="5.5" y="9" width="5" height="5" rx="1" fill="currentColor" opacity="0.5" />
            <path
                d="M1 11.5h2.5C3.5 3.5 12.5 3.5 12.5 11.5H15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    );
}

export function PopOutIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
                d="M9 2h5v5M14 2 7.5 8.5M12 9.5V14H2V4h4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
            />
        </svg>
    );
}

/** A push pin; filled while pinned. */
export function PinIcon({ pinned }: { pinned: boolean }) {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
                d="M5.5 2h5l-.8 4 2.3 2.5H4L6.3 6z"
                fill={pinned ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
            <path d="M8 8.5V14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

/** A browser window with its side panel. */
export function SidePanelIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect
                x="1.8"
                y="2.8"
                width="12.4"
                height="10.4"
                rx="1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
            />
            <path d="M10 3v10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 3.5h3v9h-3z" fill="currentColor" opacity="0.45" />
        </svg>
    );
}

export function ControlRow({ children }: { children: ReactNode }) {
    return <div className="control-row">{children}</div>;
}

export function ControlGroup({
    title,
    className,
    children,
}: {
    title?: string;
    /** `subpanel` nests the group inside another one. */
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={className ? `control-group ${className}` : 'control-group'}>
            {title && <div className="control-group-title">{title}</div>}
            <div className="control-group-body">{children}</div>
        </div>
    );
}
