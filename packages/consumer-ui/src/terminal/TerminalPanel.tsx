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
    <section className={`overflow-hidden rounded-[7px] border border-t-line bg-t-panel shadow-[0_8px_24px_rgba(22,26,21,0.08)] ${className}`}>
      {title && (
        <div className="border-b border-t-line bg-t-panel-2 px-4 py-3 font-term text-[11px] font-semibold uppercase text-t-bone-dim">
          <span>{title}</span>
        </div>
      )}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
