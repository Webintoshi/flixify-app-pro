"use client";

import { forwardRef, useImperativeHandle, useRef, useState, type ComponentPropsWithoutRef } from "react";
import s from "./segmented-otp-input.module.css";

type Props = Omit<ComponentPropsWithoutRef<"input">, "value" | "onChange" | "type" | "maxLength" | "minLength" | "inputMode" | "autoComplete"> & {
  value: string;
  onValueChange: (value: string) => void;
};
const numericCode = (value: string) => value.replace(/\D/g, "").slice(0, 6);

export const SegmentedOtpInput = forwardRef<HTMLInputElement, Props>(function SegmentedOtpInput({ value, onValueChange, onFocus, onBlur, onSelect, onKeyUp, onClick, onPaste, className, ...props }, forwardedRef) {
  const input = useRef<HTMLInputElement>(null), cells = useRef<Array<HTMLSpanElement | null>>([]);
  const [focused, setFocused] = useState(false), [selection, setSelection] = useState({ start: 0, end: 0 });
  useImperativeHandle(forwardedRef, () => input.current!, []);
  const digits = numericCode(value), active = Math.min(selection.start, digits.length, 5);

  function readSelection(target: HTMLInputElement) {
    setSelection({ start: target.selectionStart ?? digits.length, end: target.selectionEnd ?? digits.length });
  }
  function write(next: string, start: number, end = start) {
    const target = input.current;
    if (!target) return;
    target.value = next;
    target.setSelectionRange(start, end);
    setSelection({ start, end });
    onValueChange(next);
  }

  return <div className={s.root} data-disabled={props.disabled || undefined}>
    <div className={s.visual} aria-hidden="true">
      {[0, 1].map(group => <div key={group} className={s.group} data-otp-group={group}>
        {[0, 1, 2].map(position => {
          const index = group * 3 + position;
          return <span key={index} ref={element => { cells.current[index] = element; }} className={s.cell} data-otp-cell={index} data-active={focused && index === active} data-selected={focused && index < digits.length && index >= selection.start && index < selection.end} data-empty={!digits[index]}>{digits[index] ?? ""}</span>;
        })}
      </div>)}
      <span className={s.separator}>−</span>
    </div>
    <input {...props} ref={input} className={`${s.input}${className ? ` ${className}` : ""}`} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} minLength={6} pattern="[0-9]{6}" value={digits}
      onChange={event => {
        const target = event.currentTarget, raw = target.value, next = numericCode(raw);
        const start = Math.min(numericCode(raw.slice(0, target.selectionStart ?? raw.length)).length, next.length);
        const end = Math.min(numericCode(raw.slice(0, target.selectionEnd ?? raw.length)).length, next.length);
        write(next, start, end);
      }}
      onFocus={event => { setFocused(true); readSelection(event.currentTarget); onFocus?.(event); }}
      onBlur={event => { setFocused(false); onBlur?.(event); }}
      onSelect={event => { readSelection(event.currentTarget); onSelect?.(event); }}
      onKeyUp={event => { readSelection(event.currentTarget); onKeyUp?.(event); }}
      onClick={event => {
        onClick?.(event);
        const target = event.currentTarget;
        if (event.defaultPrevented || target.selectionStart !== target.selectionEnd) return;
        const bounds = cells.current.map(cell => cell?.getBoundingClientRect());
        if (!bounds[0]?.width) return;
        const nearest = bounds.reduce((best, rect, index) => rect && Math.abs(event.clientX - (rect.left + rect.width / 2)) < best.distance ? { index, distance: Math.abs(event.clientX - (rect.left + rect.width / 2)) } : best, { index: 0, distance: Infinity }).index;
        const start = Math.min(nearest, digits.length), end = Math.min(start + 1, digits.length);
        target.setSelectionRange(start, end); setSelection({ start, end });
      }}
      onPaste={event => {
        onPaste?.(event); if (event.defaultPrevented) return;
        event.preventDefault();
        const pasted = numericCode(event.clipboardData.getData("text")); if (!pasted) return;
        const target = event.currentTarget, start = target.selectionStart ?? digits.length, end = target.selectionEnd ?? digits.length;
        const next = pasted.length === 6 ? pasted : numericCode(digits.slice(0, start) + pasted + digits.slice(end));
        write(next, pasted.length === 6 ? 6 : Math.min(start + pasted.length, next.length));
      }}/>
  </div>;
});
