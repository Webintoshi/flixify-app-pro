import React, { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SegmentedOtpInput } from "./segmented-otp-input";

let root: Root, container: HTMLElement;
const changed = vi.fn(), inputRef = createRef<HTMLInputElement>();
const settle = async (action = () => {}) => { await act(async () => { action(); }); };
function input() { return container.querySelector<HTMLInputElement>("#phone-otp")!; }
function props() { const key = Object.keys(input()).find(key => key.startsWith("__reactProps"))!; return (input() as any)[key]; }
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><label htmlFor="phone-otp">Doğrulama kodu</label><SegmentedOtpInput ref={inputRef} id="phone-otp" value={value} onValueChange={next => { changed(next); setValue(next); }} required aria-describedby="otp-time" aria-invalid={false}/><p id="otp-time">Kodun geçerlilik süresi 5:00</p></>;
}
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.HTMLInputElement.prototype.setSelectionRange = function (start: number, end: number) { Object.defineProperty(this, "selectionStart", { configurable: true, value: start }); Object.defineProperty(this, "selectionEnd", { configurable: true, value: end }); };
  changed.mockReset(); container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });
async function render(initial = "") { await settle(() => root.render(<Harness initial={initial}/>)); }
async function edit(value: string, start = value.length, end = start) { await settle(() => { input().value = value; input().setSelectionRange(start, end); props().onChange({ currentTarget: input(), target: input() }); }); }
async function focus() { await settle(() => props().onFocus({ currentTarget: input() })); }

it("exposes one labelled native OTP input and hides its six visual cells from assistive technology", async () => {
  await render(); expect(container.querySelectorAll("input")).toHaveLength(1);
  expect(inputRef.current).toBe(input()); expect(props().autoComplete).toBe("one-time-code");
  expect(props().inputMode).toBe("numeric"); expect(props().maxLength).toBe(6); expect(props().required).toBe(true);
  expect(input().getAttribute("aria-describedby")).toBe("otp-time"); expect(input().getAttribute("aria-invalid")).toBe("false");
  expect(container.querySelectorAll('[aria-hidden="true"] [data-otp-cell]')).toHaveLength(6);
  expect(container.querySelectorAll("[data-otp-group]")).toHaveLength(2);
});

it("accepts a complete pasted code, including a space or dash, without requiring six separate fields", async () => {
  await render(); await focus(); const preventDefault = vi.fn();
  await settle(() => props().onPaste({ currentTarget: input(), clipboardData: { getData: () => "123 - 456" }, preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce(); expect(changed).toHaveBeenLastCalledWith("123456"); expect(input().value).toBe("123456");
  expect(Array.from(container.querySelectorAll("[data-otp-cell]")).map(cell => cell.textContent).join("")).toBe("123456");
});

it.each(["12", "123456"])("replaces the whole existing code %s when a complete new six-digit code is pasted", async initial => {
  await render(initial); await focus(); input().setSelectionRange(initial.length, initial.length);
  await settle(() => props().onPaste({ currentTarget: input(), clipboardData: { getData: () => "987654" }, preventDefault: vi.fn() }));
  expect(input().value).toBe("987654"); expect(input().selectionStart).toBe(6);
});

it("sanitizes typed characters and native autofill while retaining the caret beside the edited digits", async () => {
  await render(); await focus(); await edit("1a2", 3);
  expect(input().value).toBe("12"); expect(input().selectionStart).toBe(2);
  await edit("123456"); expect(changed).toHaveBeenLastCalledWith("123456");
  expect(container.querySelector('[data-otp-cell="5"]')?.getAttribute("data-active")).toBe("true");
});

it("tracks native arrow-key selection and supports replacing selected digits with a paste", async () => {
  await render("123456"); await focus();
  await settle(() => { input().setSelectionRange(2, 4); props().onSelect({ currentTarget: input() }); });
  expect(container.querySelector('[data-otp-cell="2"]')?.getAttribute("data-selected")).toBe("true");
  expect(container.querySelector('[data-otp-cell="3"]')?.getAttribute("data-selected")).toBe("true");
  await settle(() => props().onPaste({ currentTarget: input(), clipboardData: { getData: () => "90" }, preventDefault: vi.fn() }));
  expect(input().value).toBe("129056"); expect(input().selectionStart).toBe(4);
});

it("keeps native Backspace editing and updates its active cell without trapping navigation keys", async () => {
  await render("123456"); await focus(); const preventDefault = vi.fn();
  await settle(() => { input().setSelectionRange(3, 3); props().onKeyUp?.({ currentTarget: input(), key: "ArrowLeft", preventDefault }); });
  expect(preventDefault).not.toHaveBeenCalled();
  await edit("12456", 2);
  expect(changed).toHaveBeenLastCalledWith("12456"); expect(input().selectionStart).toBe(2);
  expect(container.querySelector('[data-otp-cell="2"]')?.getAttribute("data-active")).toBe("true");
  await settle(() => props().onBlur({ currentTarget: input() }));
  expect(container.querySelector('[data-active="true"]')).toBeNull();
});
