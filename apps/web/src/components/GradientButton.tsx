"use client";

import type { ButtonHTMLAttributes } from "react";

type GradientButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function GradientButton({ className = "", ...props }: GradientButtonProps) {
  return <button className={`btn-gradient ${className}`} {...props} />;
}
