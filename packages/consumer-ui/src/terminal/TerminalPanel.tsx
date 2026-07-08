interface TerminalPanelProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function TerminalPanel({
  title,
  children,
  className = "",
  contentClassName = "p-6",
}: TerminalPanelProps) {
  return (
    <div className={`border border-t-line bg-t-panel ${className}`}>
      {title && (
        <div className="flex items-center gap-1.5 border-b border-t-line bg-t-panel px-3 py-2 font-term text-xs text-t-phos-dim">
          <span className="h-2 w-2 rounded-full bg-t-line" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-t-line" aria-hidden="true" />
          <span className="h-2 w-2 rounded-full bg-t-line" aria-hidden="true" />
          <span className="ml-1.5">{title}</span>
        </div>
      )}
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
