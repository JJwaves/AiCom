import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-28 w-full rounded-sm border border-brand-border-control bg-brand-surface px-3.5 py-3 font-body text-base text-brand-ink transition-colors outline-none placeholder:text-brand-ink-muted hover:border-brand-ink-muted focus-visible:border-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-brand-danger",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
