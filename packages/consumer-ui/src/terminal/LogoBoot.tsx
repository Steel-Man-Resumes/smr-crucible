"use client";

import { useEffect } from "react";

interface LogoBootProps {
  className?: string;
  imgClassName?: string;
  onDone?: () => void;
}

export function LogoBoot({ className = "", imgClassName = "w-40 sm:w-56", onDone }: LogoBootProps) {
  useEffect(() => {
    onDone?.();
  }, [onDone]);

  return (
    <div className={`inline-block ${className}`}>
      <img src="/logo-mark.svg" alt="Steel Man Resumes" className={imgClassName} />
    </div>
  );
}
