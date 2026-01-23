"use client";

import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      className={[
        "rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_24px_48px_-28px_rgba(0,0,0,0.8)] backdrop-blur-2xl",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}
