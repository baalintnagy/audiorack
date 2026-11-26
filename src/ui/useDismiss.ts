import { useEffect, useRef, type RefObject } from 'react';

/**
 * Closes an open popover, such as a menu, when the mouse is pressed outside `ref` or Escape is
 * pressed.
 */
export function useDismiss(
    open: boolean,
    ref: RefObject<HTMLElement | null>,
    onDismiss: () => void,
) {
    // The latest callback, so the listeners need not be replaced on every render.
    const dismiss = useRef(onDismiss);
    dismiss.current = onDismiss;
    useEffect(() => {
        if (!open) {
            return;
        }
        const outside = (event: MouseEvent) => {
            if (!ref.current?.contains(event.target as Node)) {
                dismiss.current();
            }
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                dismiss.current();
            }
        };
        window.addEventListener('mousedown', outside);
        window.addEventListener('keydown', escape);
        return () => {
            window.removeEventListener('mousedown', outside);
            window.removeEventListener('keydown', escape);
        };
    }, [open, ref]);
}
