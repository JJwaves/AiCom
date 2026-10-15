#!/usr/bin/env node
// Static design-system lint for app/ and components/. Zero dependencies.
//   node scripts/lint-design.mjs [dir ...]   (default: app components src)
// Exit 1 when findings exist. Rules mirror DESIGN.md §7 and the brand-design-system skill.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['app', 'components', 'src'];
const exts = new Set(['.tsx', '.jsx', '.ts', '.css', '.mdx']);
const ignoreDirs = new Set(['node_modules', '.next', 'design', 'generated', 'ui']); // components/ui = shadcn primitives, owned by the CLI

const rules = [
  { id: 'raw-color', re: /#(?:[0-9a-f]{3}){1,2}\b|rgba?\(|hsla?\(|oklch\(/i, files: /\.(tsx|jsx|mdx)$/, msg: 'Raw colour value; use a brand-* token or CSS variable (DESIGN.md §2).' },
  { id: 'arbitrary-value', re: /\b(?:bg|text|border|p|px|py|m|mx|my|gap|w|h|rounded|shadow|tracking|leading)-\[[^\]]+\]/, files: /\.(tsx|jsx|mdx)$/, msg: 'Arbitrary Tailwind value; add a token instead (brand-design-system §1).' },
  { id: 'gradient', re: /\bbg-gradient-|linear-gradient\(|radial-gradient\(|conic-gradient\(/, files: /\.(tsx|jsx|css|mdx)$/, msg: 'Gradient; the system is flat except a hero scrim (DESIGN.md §6).' },
  { id: 'blur-glass', re: /\bbackdrop-blur|backdrop-filter/, files: /\.(tsx|jsx|css|mdx)$/, msg: 'Glassmorphism is not part of the system (DESIGN.md §7).' },
  { id: 'shadow', re: /\bshadow-(?!overlay\b|none\b)[a-z0-9]/, files: /\.(tsx|jsx|mdx)$/, msg: 'Only shadow-overlay is allowed, on floating layers (DESIGN.md §6).' },
  { id: 'entrance-animation', re: /\banimate-(?:in|fade|slide|bounce|pulse|ping|spin)\b|data-\[state=open\]:animate-/, files: /\.(tsx|jsx|mdx)$/, msg: 'Entrance/attention animation; remove or limit to shadcn overlay transitions (DESIGN.md §7).' },
  { id: 'bold-heading', re: /<h[1-4][^>]*className="[^"]*\bfont-(?:bold|extrabold|black)\b/, files: /\.(tsx|jsx|mdx)$/, msg: 'Headings are weight 500; bold is for a single number (DESIGN.md §3).' },
  { id: 'raw-img', re: /<img\b/, files: /\.(tsx|jsx|mdx)$/, msg: 'Use next/image with a declared aspect ratio and sizes (DESIGN.md §8).' },
  { id: 'missing-alt', re: /<(?:Image|img)\b(?![^>]*\balt=)[^>]*>/, files: /\.(tsx|jsx|mdx)$/, msg: 'Image without alt text.' },
  { id: 'purple', re: /\b(?:bg|text|border|from|to|via)-(?:purple|violet|indigo|fuchsia)-\d+/, files: /\.(tsx|jsx|mdx)$/, msg: 'Off-palette colour (DESIGN.md §7).' },
  { id: 'fake-proof', re: /trusted by \d|10,?000\+|★★★★★|lorem ipsum/i, files: /\.(tsx|jsx|mdx|ts)$/, msg: 'Possible fabricated social proof or placeholder copy; replace with a sourced fact or remove.' },
  { id: 'hover-only', re: /\bgroup-hover:(?:block|flex|opacity-100)\b/, files: /\.(tsx|jsx|mdx)$/, msg: 'Information revealed on hover only is invisible on touch; make it visible or tappable (DESIGN.md §8).' },
];

const findings = [];
function lintFile(p) {
  const name = p.split('/').pop();
  if (!exts.has(extname(name))) return;
  const text = readFileSync(p, 'utf8');
  const lines = text.split('\n');
  for (const r of rules) {
    if (!r.files.test(name)) continue;
    lines.forEach((l, i) => { if (r.re.test(l)) findings.push({ file: relative(process.cwd(), p), line: i + 1, id: r.id, msg: r.msg, src: l.trim().slice(0, 100) }); });
  }
}
function walk(dir) {
  if (!existsSync(dir)) return;
  if (statSync(dir).isFile()) { lintFile(dir); return; }
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!ignoreDirs.has(name)) walk(p); continue; }
    lintFile(p);
  }
}
roots.forEach(walk);

if (!findings.length) { console.log('lint-design: no findings'); process.exit(0); }
const bySeverity = { 'raw-color': 2, 'arbitrary-value': 2, gradient: 1, 'blur-glass': 1, shadow: 2, 'entrance-animation': 2, 'bold-heading': 3, 'raw-img': 2, 'missing-alt': 1, purple: 1, 'fake-proof': 1, 'hover-only': 2 };
findings.sort((a, b) => (bySeverity[a.id] ?? 3) - (bySeverity[b.id] ?? 3));
for (const f of findings) console.log(`${f.file}:${f.line}  [${f.id}]  ${f.msg}\n    ${f.src}`);
console.log(`\nlint-design: ${findings.length} finding(s)`);
process.exit(1);
