import type { ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * The button beside a text field that opens a picker, and what it opens in:
 * a Popover beside the field on a desktop, a bottom Sheet at phone width.
 * Shared by every picker (the Date picker, the calendar date picker); the
 * picker itself is `children`, the same in both.
 *
 * Test ids: the button is `${testId}-open`, the open picker `${testId}` with
 * `data-shell="popover" | "sheet"`.
 */
export function PickerShell({
  label,
  icon,
  testId,
  open,
  onOpenChange,
  disabled,
  className,
  children,
}: {
  /** Names the button for screen readers and titles the picker. */
  label: string;
  /** The button's icon. */
  icon: ReactNode;
  testId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  /** For the picker's content box. */
  className?: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size={mobile ? "icon" : "icon-xs"}
      className="shrink-0"
      aria-label={label}
      title={label}
      disabled={disabled}
      data-testid={`${testId}-open`}
    >
      {icon}
    </Button>
  );
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          data-testid={testId}
          data-shell="sheet"
          className={cn("gap-2 px-4 pb-6", className)}
        >
          <SheetHeader className="min-w-0 px-0 pb-0">
            <SheetTitle>{label}</SheetTitle>
            <SheetDescription className="sr-only">{label}</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        data-testid={testId}
        data-shell="popover"
        className={cn("w-80 max-w-[calc(100vw-2rem)]", className)}
      >
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        {children}
      </PopoverContent>
    </Popover>
  );
}
