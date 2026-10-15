import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

/** Input — 44px, surface fill, 3:1 control border, 2px ring at 2px offset (DESIGN.md §4). 16px text so iOS never zooms. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-sm border border-brand-border-control bg-brand-surface px-3.5 py-2 font-body text-base text-brand-ink transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-brand-ink placeholder:text-brand-ink-muted hover:border-brand-ink-muted focus-visible:border-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-brand-danger",
        className
      )}
      {...props}
    />
  )
}

export { Input }
