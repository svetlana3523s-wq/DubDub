"use client";

import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      className={[
        "w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/40",
        "focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-purple-500/30",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
