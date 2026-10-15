#!/usr/bin/env node
// Generates design/generated/{globals.css,tokens.ts} from design/tokens.json.
// Run: node scripts/build-tokens.mjs
// Zero dependencies. Node 18+.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const t = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8'));
const out = join(root, 'design/generated');
mkdirSync(out, { recursive: true });

const line = (k, v) => `  --${k}: ${v};`;

// ---------- globals.css (Tailwind v4 + shadcn/ui variable contract) ----------
const colorVars = Object.entries(t.color).map(([k, v]) => line(`color-brand-${k}`, v.value));
const spaceVars = Object.entries(t.spacing.semantic).map(([k, v]) => line(`space-${k}`, v.value));
const radiusVars = Object.entries(t.radius).map(([k, v]) => line(`radius-${k}`, v.value));
const shadowVars = Object.entries(t.elevation).map(([k, v]) => line(`shadow-${k}`, v.value));
const motionVars = Object.entries(t.motion).filter(([k]) => k !== 'rule').map(([k, v]) => line(k, v.value));
const leadingVars = Object.entries(t.typography.leading ?? {}).map(([k, v]) => line(`leading-${k}`, v.value));
const typeVars = Object.entries(t.typography.scale).flatMap(([k, v]) => [
  line(`text-${k}`, v.size),
  line(`text-${k}--line-height`, v.lineHeight),
  line(`text-${k}--font-weight`, String(v.weight)),
  line(`text-${k}--letter-spacing`, v.tracking),
]);

const css = `/* GENERATED from design/tokens.json by scripts/build-tokens.mjs — edit the JSON, not this file.
   Imported by app/globals.css, which owns the Tailwind imports, base layer and legacy aliases. */

/* 1. Brand tokens → Tailwind v4 theme (bg-brand-canvas, text-brand-ink, text-brand-accent-ink, rounded-md, shadow-overlay …). Brand colours are prefixed brand- so they never collide with shadcn's accent/secondary roles. */
@theme {
  --font-heading: var(--font-space-grotesk), ${t.typography.fonts.heading.family};
  --font-body: var(--font-inter), ${t.typography.fonts.body.family};
  --font-mono: var(--font-jetbrains-mono), ${t.typography.fonts.mono.family};

${colorVars.join('\n')}

${typeVars.join('\n')}

${leadingVars.join('\n')}

${spaceVars.join('\n')}
  --container-page: ${t.layout.container.value};
  --container-narrow: ${t.layout['container-narrow'].value};

  --radius-none: ${t.radius.none.value};
${radiusVars.filter((l) => !l.includes('--radius-none')).join('\n')}

${shadowVars.join('\n')}

${motionVars.join('\n')}
  --ease-standard: ${t.motion.easing.value};
}

/* 2. shadcn/ui variable contract, mapped onto the brand tokens.
      Keep these names: shadcn components read them. Change values only via tokens.json. */
:root {
  --radius: ${t.radius.md.value};
  --background: var(--color-brand-canvas);
  --foreground: var(--color-brand-ink);
  --card: var(--color-brand-surface);
  --card-foreground: var(--color-brand-ink);
  --popover: var(--color-brand-surface);
  --popover-foreground: var(--color-brand-ink);
  --primary: var(--color-brand-surface-ink);
  --primary-foreground: var(--color-brand-canvas-on-ink);
  --secondary: var(--color-brand-canvas-2);
  --secondary-foreground: var(--color-brand-ink);
  --muted: var(--color-brand-canvas-2);
  --muted-foreground: var(--color-brand-ink-muted);
  --accent: var(--color-brand-accent-soft);
  --accent-foreground: var(--color-brand-accent-ink);
  --destructive: var(--color-brand-danger);
  --border: var(--color-brand-hairline);
  --input: var(--color-brand-border-control);
  --ring: var(--color-brand-focus);
  --chart-1: var(--color-brand-accent);
  --chart-2: var(--color-brand-secondary);
  --chart-3: var(--color-brand-ink-2);
  --chart-4: var(--color-brand-success);
  --chart-5: var(--color-brand-warning);
}

/* Dark mode is intentionally not shipped in Phase 1 (photography-first marketing site). Add a .dark block here when needed. */

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 4px);
  --radius-xl: calc(var(--radius) + 8px);
}

/* 4. Type utilities (one class per scale step) */
@layer utilities {
${Object.entries(t.typography.scale).map(([k, v]) => `  .type-${k} { font-family: var(--font-${v.font}); font-size: var(--text-${k}); line-height: var(--text-${k}--line-height); font-weight: var(--text-${k}--font-weight); letter-spacing: var(--text-${k}--letter-spacing);${v.transform ? ` text-transform: ${v.transform};` : ''}${v.features ? ` font-feature-settings: ${v.features};` : ''} }`).join('\n')}
  .container-page { max-width: var(--container-page); margin-inline: auto; padding-inline: var(--space-gutter); }
  @media (min-width: 1024px) { .container-page { padding-inline: var(--space-gutter-lg); } }
  .container-narrow { max-width: var(--container-narrow); margin-inline: auto; padding-inline: var(--space-gutter); }
  .section { padding-block: var(--space-section); }
  .hairline { border-color: var(--color-brand-hairline); }
}
`;
writeFileSync(join(out, 'tokens.css'), css);

// ---------- tokens.ts ----------
const ts = `// GENERATED from design/tokens.json by scripts/build-tokens.mjs — do not edit.
export const tokens = ${JSON.stringify(t, null, 2)} as const;
export type ColorToken = keyof typeof tokens.color;
export type TypeStyle = keyof typeof tokens.typography.scale;
export const color = Object.fromEntries(Object.entries(tokens.color).map(([k, v]) => [k, v.value])) as Record<ColorToken, string>;
`;
writeFileSync(join(out, 'tokens.ts'), ts);

console.log('wrote design/generated/tokens.css and design/generated/tokens.ts');
