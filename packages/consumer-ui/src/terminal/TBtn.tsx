import Link from "next/link";

interface TBtnProps {
  href?: string;
  onClick?: () => void;
  variant?: "solid" | "ghost";
  size?: "md" | "sm";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}

const BASE =
  "inline-flex items-center justify-center gap-0 min-h-[44px] font-term text-sm font-bold " +
  "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-t-white focus-visible:outline-offset-2 " +
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none";

const VARIANT = {
  solid: "bg-t-amber text-[#14100a] shadow-[3px_3px_0_#000] hover:bg-t-amber-bright",
  ghost: "bg-transparent text-t-amber-bright border border-t-amber hover:bg-t-amber/10",
};

const SIZE = {
  md: "px-5 py-3",
  sm: "px-4 py-2",
};

function isExternalHref(href: string) {
  return /^(https?:|tel:|sms:|mailto:)/.test(href);
}

export function TBtn({
  href,
  onClick,
  variant = "solid",
  size = "md",
  type = "button",
  disabled = false,
  className = "",
  children,
  ariaLabel,
}: TBtnProps) {
  const classes = `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`;
  const content = (
    <>
      <span aria-hidden="true">{"> "}</span>
      {children}
      <span aria-hidden="true">_</span>
    </>
  );

  // A disabled button must never navigate, so it always renders as a real
  // <button disabled> even when an href was passed (href+disabled is a valid
  // combo across this app's forms -- e.g. an action link gated on validation).
  if (disabled) {
    return (
      <button type={type} disabled className={classes} aria-label={ariaLabel}>
        {content}
      </button>
    );
  }

  if (href) {
    if (isExternalHref(href)) {
      return (
        <a href={href} className={classes} aria-label={ariaLabel} onClick={onClick}>
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} aria-label={ariaLabel} onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} className={classes} aria-label={ariaLabel}>
      {content}
    </button>
  );
}
