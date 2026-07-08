interface PromptLineProps {
  command: string;
  cursor?: boolean;
  className?: string;
}

export function PromptLine({ command, cursor = true, className = "" }: PromptLineProps) {
  return (
    <div className={`font-term text-t-phos-dim ${className}`}>
      <span aria-hidden="true">{"$ "}</span>
      {command}
      {cursor && <span className="t-cursor" aria-hidden="true" />}
    </div>
  );
}
