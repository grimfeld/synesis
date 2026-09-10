import type { ReactNode } from "react";
import { cn } from "cn";

/** Small uppercase heading used for panel sections and form labels. */
export function PanelTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold tracking-wider text-muted-foreground uppercase", className)}>{children}</div>;
}

/** A labelled form control. Wraps the control in a <label> so clicking the caption focuses it. */
export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
