import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/**
 * Button — DESIGN.md §4. Three real variants:
 *   primary  ink fill (the default action everywhere)
 *   outline  1px ink border
 *   accent   terracotta fill — ONE per page, reserved for "Request a quote"
 * plus ghost/link for navigation. Heights 44px (default) / 52px (lg) are the touch targets.
 * Labels: sentence case, Inter 500. No icons inside buttons except a trailing arrow.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-body font-medium whitespace-nowrap transition-colors duration-(--duration-fast) outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-brand-surface-ink text-brand-canvas-on-ink hover:bg-brand-surface-ink-hover",
        outline: "border-brand-ink bg-transparent text-brand-ink hover:bg-brand-canvas-2",
        accent: "bg-brand-accent-ink text-white hover:bg-brand-accent-ink-hover",
        secondary: "bg-brand-canvas-2 text-brand-ink hover:bg-brand-hairline",
        ghost: "bg-transparent text-brand-ink-2 hover:bg-brand-canvas-2 hover:text-brand-ink",
        destructive: "bg-brand-danger text-white hover:bg-brand-danger-hover",
        link: "h-auto rounded-none border-0 px-0 text-brand-accent-ink underline decoration-1 underline-offset-3 hover:text-brand-ink",
        /* Light-on-dark pair for the ink band / footer. */
        inverse: "border-brand-canvas-on-ink bg-transparent text-brand-canvas-on-ink hover:bg-white/10",
      },
      size: {
        default: "h-11 px-5 text-base",
        sm: "h-9 px-3.5 text-sm",
        lg: "h-13 px-7 text-base",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
