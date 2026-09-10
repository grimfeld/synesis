import type { ReactNode } from "react";
import { cn } from "cn";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Top bar shared by every whole-pane view: sidebar toggle, title, then any controls. */
export function ViewHeader({ title, icon, children, className }: { title?: ReactNode; icon?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3", className)}>
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
      {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      {title && <h1 className="truncate text-sm font-semibold">{title}</h1>}
      {children}
    </header>
  );
}
