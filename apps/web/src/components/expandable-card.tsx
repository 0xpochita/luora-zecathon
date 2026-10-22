"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowsIn, ArrowsOut } from "@phosphor-icons/react";
import { IconButton } from "./ui";

const EXPAND_MS = 280;

function flip(from: DOMRect, to: DOMRect): string {
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface CardSwitch {
  node: ReactNode;
  full: boolean;
  onFullChange: (full: boolean) => void;
}

export function useExpand(initial = false) {
  const ref = useRef<HTMLElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const firstRect = useRef<DOMRect | null>(null);
  const closingAnimation = useRef<Animation | null>(null);
  const [expanded, setExpanded] = useState(initial);
  const [placeholderHeight, setPlaceholderHeight] = useState(0);

  const open = () => {
    const element = ref.current;
    if (!element) return;
    firstRect.current = element.getBoundingClientRect();
    setPlaceholderHeight(firstRect.current.height);
    setExpanded(true);
  };

  const close = useCallback(() => {
    const element = ref.current;
    const target = placeholderRef.current?.getBoundingClientRect();
    if (!element || !target || target.height === 0 || reducedMotion()) {
      setExpanded(false);
      return;
    }
    if (closingAnimation.current) return;
    const timing = { duration: EXPAND_MS, easing: "ease-out", fill: "forwards" as const };
    const animation = element.animate(
      [
        { transformOrigin: "top left", transform: "none" },
        { transformOrigin: "top left", transform: flip(target, element.getBoundingClientRect()) },
      ],
      timing,
    );
    scrimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    closingAnimation.current = animation;
    animation.onfinish = () => setExpanded(false);
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!expanded) {
      closingAnimation.current?.cancel();
      closingAnimation.current = null;
      return;
    }
    const first = firstRect.current;
    if (!element || !first || reducedMotion()) return;
    const timing = { duration: EXPAND_MS, easing: "ease-out" };
    element.animate(
      [
        { transformOrigin: "top left", transform: flip(first, element.getBoundingClientRect()) },
        { transformOrigin: "top left", transform: "none" },
      ],
      timing,
    );
    scrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, close]);

  return { ref, placeholderRef, scrimRef, expanded, placeholderHeight, open, close };
}

export function ExpandableCard({
  label,
  aside,
  toolbar,
  swap,
  children,
}: {
  label: string;
  aside?: ReactNode;
  toolbar?: ReactNode;
  swap?: CardSwitch;
  children: (full: boolean) => ReactNode;
}) {
  const { ref, placeholderRef, scrimRef, expanded, placeholderHeight, open, close } = useExpand(swap?.full ?? false);
  const onFullChange = swap?.onFullChange;
  useEffect(() => {
    onFullChange?.(expanded);
  }, [expanded, onFullChange]);
  return (
    <>
      {expanded && (
        <>
          <div ref={placeholderRef} aria-hidden style={{ height: placeholderHeight }} />
          <div ref={scrimRef} onClick={close} aria-hidden className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px]" />
        </>
      )}
      <section
        ref={ref}
        aria-label={label}
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded ? true : undefined}
        className={`flex min-w-0 flex-col rounded-card border border-border bg-card-grad shadow-soft ${
          expanded ? "fixed inset-0 z-40 overflow-y-auto rounded-none shadow-float sm:inset-4 sm:rounded-card" : ""
        }`}
      >
        <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-2.5 text-[14px]">
          <span className="size-1.5 flex-none rounded-full bg-fg" />
          <span className="font-medium text-fg">{label}</span>
          {aside != null && <span className="ml-auto truncate text-[12.5px] text-dim">{aside}</span>}
          {expanded && swap?.node}
          {toolbar}
          <IconButton label={expanded ? "Exit full screen" : "Full screen"} size="sm" onClick={expanded ? close : open} className={aside == null && !toolbar ? "ml-auto" : ""}>
            {expanded ? <ArrowsIn /> : <ArrowsOut />}
          </IconButton>
        </header>
        {children(expanded)}
      </section>
    </>
  );
}
