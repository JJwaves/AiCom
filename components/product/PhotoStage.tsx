import Image from "next/image";
import { BagIllustration } from "./BagIllustration";

/**
 * Photography stage — DESIGN.md §4 "Cards" / §8 "Images".
 *
 * Every product picture on the site sits on one of two stages (warm canvas-2 or kraft) at a
 * declared aspect ratio, so the grid stays consistent now and swaps to real photography
 * with NO layout change: pass `image` once a `src` exists and the illustration + shot
 * label disappear. While a slot is empty it is rendered as a designed placeholder — the
 * SVG bag in the configured colour plus a small shot description — never a fake photo.
 *
 * Shot list for the owner: BUSINESS_CONFIG_TODO → "Product #1".
 */
export type StageRatio = "4/5" | "1/1" | "16/9" | "3/4";

const RATIO_CLASS: Record<StageRatio, string> = {
  "4/5": "aspect-[4/5]",
  "1/1": "aspect-square",
  "16/9": "aspect-video",
  "3/4": "aspect-[3/4]",
};

export function PhotoStage({
  image,
  ratio = "4/5",
  tone = "canvas",
  bagColor,
  showLogo = false,
  label,
  priority = false,
  sizes = "(min-width: 1024px) 50vw, 100vw",
  className = "",
  illustrationClassName = "w-3/5",
  caption = true,
}: {
  /** A real photograph. `src: null` renders the placeholder. */
  image?: { src: string | null; alt: string } | null;
  ratio?: StageRatio;
  tone?: "canvas" | "kraft";
  /** CSS colour of the illustrated bag body (from the catalog swatch). */
  bagColor?: string;
  showLogo?: boolean;
  /** Short description of the real shot that will replace the placeholder. */
  label?: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
  illustrationClassName?: string;
  /** Hide the "Photo to come" caption on small tiles where it cannot fit. */
  caption?: boolean;
}) {
  const stage = tone === "kraft" ? "stage-kraft" : "stage";
  if (image?.src) {
    return (
      <figure className={`relative overflow-hidden ${stage} ${RATIO_CLASS[ratio]} ${className}`}>
        <Image src={image.src} alt={image.alt} fill sizes={sizes} priority={priority} className="object-cover" />
      </figure>
    );
  }
  return (
    <figure
      className={`relative flex items-center justify-center overflow-hidden ${stage} ${RATIO_CLASS[ratio]} ${className}`}
      aria-label={image?.alt ?? label ?? "Product photo placeholder"}
    >
      <BagIllustration
        bodyColor={bagColor}
        showLogo={showLogo}
        className={illustrationClassName}
        title={image?.alt ?? label ?? "Insulated takeout bag"}
      />
      {caption && (label || image?.alt) && (
        <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-2 px-4 py-3 text-xs text-brand-ink-muted">
          <span className="eyebrow">Photo to come</span>
          <span className="truncate">{label ?? image?.alt}</span>
        </figcaption>
      )}
    </figure>
  );
}
