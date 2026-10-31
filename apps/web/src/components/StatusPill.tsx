type Tone = "accent" | "warn" | "add" | "del" | "soft";

const tones: Readonly<Record<Tone, string>> = {
  accent: "bg-accent/10 text-accent",
  warn: "bg-warn/10 text-warn",
  add: "bg-add/10 text-add",
  del: "bg-del/10 text-del",
  soft: "bg-raised text-soft",
};

export const StatusPill = ({ tone, children }: { tone: Tone; children: string }) => (
  <span
    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
  >
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
    {children}
  </span>
);
