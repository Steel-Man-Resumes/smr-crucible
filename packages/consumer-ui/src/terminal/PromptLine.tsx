interface PromptLineProps {
  command: string;
  cursor?: boolean;
  className?: string;
}

export function PromptLine({ command, cursor = true, className = "" }: PromptLineProps) {
  return (
    <div className={`rounded-[5px] border border-[#3b4039] bg-[#10110f] px-4 py-3 font-term text-[#a7cf98] ${className}`}>
      <span className="text-[#d7b86e]" aria-hidden="true">{"$ "}</span>
      {command}
      {cursor && <span className="t-cursor" aria-hidden="true" />}
    </div>
  );
}
