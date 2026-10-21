"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check as CheckIcon, Copy, X } from "@phosphor-icons/react";
import type { CheckStatus } from "@contract/types";

export type Tone = "neutral" | "ok" | "bad" | "warn" | "info" | "solid";

export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-dim",
  ok: "bg-green",
  bad: "bg-red",
  warn: "bg-yellow",
  info: "bg-blue",
  solid: "bg-primary-fg",
};

export const STATUS_TONE: Record<CheckStatus, Tone> = { pass: "ok", fail: "bad", warn: "warn", na: "neutral" };
export const STATUS_LABEL: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", warn: "Warn", na: "N/A" };

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-white/25";

export function tile(active: boolean) {
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-tile transition-colors ${FOCUS_RING} ${
    active ? "bg-primary text-primary-fg shadow-soft" : "bg-raised text-muted hover:bg-hover hover:text-fg"
  }`;
}

export function Dot({ tone = "neutral", className = "" }: { tone?: Tone; className?: string }) {
  return <span aria-hidden className={`inline-block size-1.5 flex-none rounded-full ${TONE_DOT[tone]} ${className}`} />;
}

const CHIP_TONES: Record<Tone, string> = {
  neutral: "bg-raised text-muted",
  ok: "bg-raised text-text",
  bad: "bg-raised text-text",
  warn: "bg-raised text-text",
  info: "bg-raised text-text",
  solid: "bg-primary text-primary-fg",
};

export function Chip({
  children,
  tone = "neutral",
  dot = false,
  title,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-chip px-2 text-[12.5px] ${CHIP_TONES[tone]} ${className}`}
    >
      {dot && <Dot tone={tone} />}
      {children}
    </span>
  );
}

const BUTTON_VARIANTS = {
  primary: "rounded-tile bg-primary text-primary-fg shadow-soft hover:bg-white",
  accent: "rounded-chip bg-mint text-primary-fg hover:bg-[#a7f3c4]",
  secondary: "rounded-tile bg-raised text-fg hover:bg-hover",
  ghost: "rounded-tile text-muted hover:bg-hover hover:text-fg",
} as const;

const BUTTON_SIZES = {
  xs: "h-7 px-2.5 text-[12.5px]",
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-4 text-[14px]",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_VARIANTS; size?: keyof typeof BUTTON_SIZES }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors ${FOCUS_RING} disabled:pointer-events-none disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

const ICON_BUTTON_SIZES = { xs: "size-6 text-[12px]", sm: "size-8 text-[14px]", md: "size-9 text-[16px]" } as const;

export function IconButton({
  label,
  active = false,
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: keyof typeof ICON_BUTTON_SIZES }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`${tile(active)} flex-none disabled:pointer-events-none disabled:opacity-40 ${ICON_BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

export interface TabOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  label,
  idPrefix,
  className = "",
}: {
  value: T;
  options: TabOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  label: string;
  idPrefix?: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex items-center gap-1.5 ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${option.value}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${option.value}` : undefined}
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`${tile(active)} gap-1.5 ${size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-9 px-4 text-[13px]"}`}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Panel({
  label,
  aside,
  dot,
  titleAbove = false,
  inset = false,
  glow = false,
  children,
  className = "",
  bodyClassName = "",
}: {
  label?: ReactNode;
  aside?: ReactNode;
  dot?: Tone;
  titleAbove?: boolean;
  inset?: boolean;
  glow?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const header = label != null && (
    <header className={`flex items-center gap-2 text-[14px] ${titleAbove ? "px-1 pb-2.5" : "px-4 pt-3.5 pb-2.5"}`}>
      <span className={`size-1.5 flex-none rounded-full ${dot && dot !== "neutral" ? TONE_DOT[dot] : "bg-fg"}`} />
      <span className="truncate font-medium text-fg">{label}</span>
      {aside != null && <span className="ml-auto flex items-center gap-2 whitespace-nowrap text-[12.5px] text-dim">{aside}</span>}
    </header>
  );
  const body = inset ? (
    <div className={`m-2 mt-0 flex min-h-0 flex-1 flex-col rounded-inner border border-border bg-inner-grad ${bodyClassName}`}>{children}</div>
  ) : (
    <div className={`flex min-h-0 flex-1 flex-col ${bodyClassName}`}>{children}</div>
  );
  const card = `flex min-h-0 min-w-0 flex-col rounded-card border border-border bg-card-grad shadow-soft ${glow ? "glow-top" : ""}`;
  if (titleAbove) {
    return (
      <section className={`flex min-h-0 min-w-0 flex-col ${className}`}>
        {header}
        <div className={`flex-1 ${card}`}>{body}</div>
      </section>
    );
  }
  return (
    <section className={`${card} ${className}`}>
      {header}
      {body}
    </section>
  );
}

export function Inner({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-inner border border-border bg-inner-grad ${className}`}>{children}</div>;
}

export function InnerHeader({ icon, children, aside }: { icon: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[14px] text-text">
      <span className="flex-none text-[16px] text-muted">{icon}</span>
      <span className="truncate">{children}</span>
      {aside != null && <span className="ml-auto flex items-center gap-2 text-[12.5px] text-dim">{aside}</span>}
    </div>
  );
}

const FIELD =
  "border border-border text-[13px] text-[#f0f0f2] outline-none transition-colors placeholder:text-dim hover:border-border-strong focus:border-white/25";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} h-9 rounded-inner bg-field px-3 ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} resize-y rounded-inner bg-field px-3 py-2 ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`select-caret h-9 rounded-tile bg-inset pr-8 pl-3 text-[13px] text-[#f0f0f2] ${FOCUS_RING} ${className}`} {...props} />;
}

export function Meter({
  value,
  bad = false,
  className = "w-full",
  fillClassName = "",
}: {
  value: number;
  bad?: boolean;
  className?: string;
  fillClassName?: string;
}) {
  return (
    <i className={`block h-1.5 flex-none overflow-hidden rounded-full bg-[#151517] shadow-[inset_0_0_0_1px_var(--border)] ${className}`}>
      <b
        className={`block h-full rounded-full ${bad ? "bg-red" : "bg-[#d4d4d8]"} ${fillClassName}`}
        style={{ width: `${value <= 0 ? 0 : Math.max(2, Math.min(1, value) * 100)}%` }}
      />
    </i>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      size="xs"
      label={copied ? "Copied" : label}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? <CheckIcon /> : <Copy />}
    </IconButton>
  );
}

export function ExternalLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`link ${className}`}>
      {children}
    </a>
  );
}

export function Hint({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[12.5px] text-dim ${className}`}>{children}</p>;
}

export function StatusMark({ status }: { status: CheckStatus }) {
  return (
    <span className="inline-flex w-12 flex-none items-center gap-1.5 text-[12.5px] text-muted">
      <Dot tone={STATUS_TONE[status]} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <Inner className="flex flex-col gap-2 p-4">
      <InnerHeader icon={icon}>{title}</InnerHeader>
      {children && <div className="text-[13px] leading-relaxed text-body">{children}</div>}
    </Inner>
  );
}

export function LoadingLine({ children }: { children: ReactNode }) {
  return (
    <p className="loading-pulse flex items-center gap-2 text-[12.5px] text-dim" role="status">
      <Dot />
      {children}
    </p>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      aria-labelledby="drawer-title"
      className="drawer border border-border bg-card-grad text-fg shadow-float"
    >
      <div className="flex max-h-full min-h-0 flex-col">
        <header className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 text-[14px]">
          <span className="size-1.5 flex-none rounded-full bg-fg" />
          <h2 id="drawer-title" className="truncate font-medium">
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose} className="ml-auto" autoFocus>
            <X />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </dialog>
  );
}
