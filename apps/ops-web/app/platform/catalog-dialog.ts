import { useEffect, useRef, type RefObject, type MouseEvent } from "react";

/** Native top-layer dialogs own focus trapping and Escape; no second global focus manager. */
export function useCatalogDialog(open: boolean, panel: RefObject<HTMLDialogElement | null>, initialFocus: () => HTMLElement | null, onClose: () => void) {
  const initial = useRef(initialFocus);
  initial.current = initialFocus;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const element = panel.current;
    if (!element) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Search inputs otherwise consume the first Escape to clear their value before native cancel.
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    element.addEventListener("keydown", escape, true);
    if (!element.open) element.showModal();
    document.body.style.overflow = "hidden";
    const focus = initial.current();
    focus?.focus({ preventScroll: true });
    focus?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return () => {
      element.removeEventListener("keydown", escape, true);
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open, panel]);
}

export function clickedDialogBackdrop(event: MouseEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
}
