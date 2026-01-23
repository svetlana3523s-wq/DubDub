"use client";

import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-fuchsia-500 via-purple-500 to-blue-500 text-white shadow-[0_12px_30px_-16px_rgba(99,102,241,0.8)]",
  secondary:
    "bg-white/10 text-white border border-white/15 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.7)]",
  danger:
    "bg-gradient-to-r from-rose-500 via-red-500 to-orange-500 text-white shadow-[0_12px_30px_-16px_rgba(244,63,94,0.7)]",
  ghost:
    "bg-transparent text-white/80 border border-white/10 hover:text-white hover:border-white/30",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-sm rounded-2xl",
  md: "px-5 py-3 text-base rounded-3xl",
  lg: "px-6 py-4 text-lg rounded-3xl",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 font-medium transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      ].join(" ")}
      disabled={isDisabled}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      )}
      {children}
    </button>
  );
}
