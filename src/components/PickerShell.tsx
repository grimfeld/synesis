import type { ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
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
 * Touch-sized in the phone Sheet, like the calendar's days; the Popover's
 * compact size from `md` up (the Sheet's breakpoint, `useIsMobile`). Every
 * control inside a picker takes it, as a least height so a long label wraps.
 * The two below are the same sizes for controls whose height is fixed;
 * Tailwind reads class names from the source, so each is written out whole.
 */
export const TOUCH_TARGET = "min-h-10 md:min-h-8";
/** `TOUCH_TARGET` as a fixed height, for a text Input. */
export const TOUCH_TARGET_INPUT = "h-10 md:h-8";
/** `TOUCH_TARGET` as a Select trigger's height, overriding its fixed one. */
export const TOUCH_TARGET_TRIGGER = "data-[size=default]:h-10 md:data-[size=default]:h-8";

/**
 * The button beside a text field that opens a picker, and what it opens in:
 * a Popover beside the field on a desktop, a bottom Sheet at phone width.
 * Shared by every picker (the Date picker, the calendar date picker); the
 * picker itself is `children`, the same in both.
 *
 * Test ids: the button is `${testId}-open` (a custom `trigger` brings its
 * own), the open picker `${testId}` with `data-shell="popover" | "sheet"`.
 */
export function PickerShell({
  label,
  icon,
  trigger: customTrigger,
  testId,
  open,
  onOpenChange,
  disabled,
  triggerless,
  className,
  children,
}: {
  /** Names the button for screen readers and titles the picker. */
  label: string;
  /** The button's icon. */
  icon?: ReactNode;
  /**
   * A button of the caller's own in place of the icon button (the Family
   * section's "Choose…", "Add child"): it opens the same Popover or Sheet.
   */
  trigger?: ReactNode;
  testId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  /**
   * No button: the picker is opened by something else (a menu, a Command)
   * and only `open` shows it. On a desktop it stands near the top of the
   * window, where a dialog would.
   */
  triggerless?: boolean;
  /** For the picker's content box. */
  className?: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const trigger = customTrigger ?? (
    <Button
      type="button"
      variant="ghost"
      size={mobile ? "icon" : "icon-sm"}
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
        {!triggerless && <SheetTrigger asChild>{trigger}</SheetTrigger>}
        <SheetContent
          side="bottom"
          data-testid={testId}
          data-shell="sheet"
          onFocusOutside={triggerless ? (e) => e.preventDefault() : undefined}
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
      {triggerless ? (
        <PopoverAnchor className="pointer-events-none fixed top-24 left-1/2 size-0" />
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent
        align={triggerless ? "center" : "end"}
        // Opened from a menu, whose closing hands focus back to its own
        // button: that is not the person leaving the picker.
        onFocusOutside={triggerless ? (e) => e.preventDefault() : undefined}
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
