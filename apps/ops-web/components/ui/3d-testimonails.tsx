"use client";

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import s from "./3d-testimonails.module.css";

type MarqueeProps = ComponentPropsWithoutRef<"div"> & {
  children: ReactNode;
  reverse?: boolean;
  pauseOnHover?: boolean;
  paused?: boolean;
  vertical?: boolean;
  repeat?: number;
  durationSeconds?: number;
};

export function Marquee({ children, className = "", reverse = false, pauseOnHover = false, paused = false, vertical = false, repeat = 2, durationSeconds = 80, style, ...props }: MarqueeProps) {
  const copies = Math.min(4, Math.max(2, Math.floor(repeat)));
  return <div {...props} className={`${s.marquee} ${className}`} data-slot="marquee" data-vertical={vertical} data-paused={paused} data-hover-pause={pauseOnHover} style={{ ...style, "--marquee-duration": `${durationSeconds}s` } as CSSProperties}>
    {Array.from({ length: copies }, (_, index) => <div key={index} className={s.group} data-reverse={reverse} aria-hidden={index > 0 ? true : undefined}>{children}</div>)}
  </div>;
}
