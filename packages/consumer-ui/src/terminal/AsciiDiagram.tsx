interface AsciiDiagramProps {
  label: string;
  children: string;
  className?: string;
}

export function AsciiDiagram({ label, children, className = "" }: AsciiDiagramProps) {
  return (
    <pre className={`t-ascii ${className}`} role="img" aria-label={label}>
      {children}
    </pre>
  );
}
