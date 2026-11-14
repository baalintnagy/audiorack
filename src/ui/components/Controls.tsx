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
    options: { value: T; label: string }[];
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
                        className={option.value === value ? 'on' : ''}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
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

export function ControlRow({ children }: { children: ReactNode }) {
    return <div className="control-row">{children}</div>;
}

export function ControlGroup({ title, children }: { title?: string; children: ReactNode }) {
    return (
        <div className="control-group">
            {title && <div className="control-group-title">{title}</div>}
            <div className="control-group-body">{children}</div>
        </div>
    );
}
