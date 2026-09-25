import type { ReactNode } from "react";
import { cn } from "cn";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TutorialButton } from "@/components/TutorialPanel";
import type { TutorialPlace } from "@/lib/tutorials";
import type { DeviceKind } from "@/lib/syncRules";

/**
 * Top bar shared by every whole-pane view: sidebar toggle, title, then any
 * controls, then the view's Tutorials behind a "?" (PLAN §22.1).
 */
export function ViewHeader({ title, icon, children, className, tutorials, deviceKind }: { title?: ReactNode; icon?: ReactNode; children?: ReactNode; className?: string; tutorials?: TutorialPlace; deviceKind?: DeviceKind }) {
  return (
    <header className={cn("flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3", className)}>
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
      {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      {title && <h1 className="min-w-0 truncate text-sm font-semibold">{title}</h1>}
      {children}
      {tutorials && <TutorialButton place={tutorials} deviceKind={deviceKind} className={children ? undefined : "ml-auto"} />}
    </header>
  );
}
