# Product catalog and launch scope

Authoritative for **which products exist, which are sellable, and what the
customer may choose**. Prices and their derivation live here too, because a
price is a catalog fact; the arithmetic that applies them is
`modules/pricing` (docs/UNIT_ECONOMICS.md).

Source of truth: `config/products.ts`. This document explains it; it does not
duplicate it.

---

## 1. Launch scope is a field, not a convention

```ts
Product.launchEnabled: boolean
```

`false` means the product is **not sellable and not publicly rendered**. It is
enforced in exactly one place — `lib/commerce/catalog.ts`, the facade every
catalog read outside `config/products.ts` goes through — and that single lever
is what makes a disabled product unreachable everywhere at once:

| Surface | Effect |
| --- | --- |
| `/products/[slug]` | 404 (`getCatalogProduct` returns null) |
| `/products`, homepage, landing pages | absent |
| `sitemap.xml`, `generateStaticParams` | absent |
| AI tools (`searchProducts`, `getProductDetails`) | absent |
| Cart / `/api/checkout` | `Unknown product` — rejected |
| `requiredMerchandiseKeys()` | excluded, so no Shopify variant is demanded |

`listAllCatalogProducts()` is the ONE deliberate exception: cost-model
validation must see every entry that exists in the file, or a cost entry for a
disabled product would look like a cost entry for a product that does not
exist. It is never a customer-facing read.

**A product carrying demo or unconfirmed production data MUST be
`launchEnabled: false`.** The three seed products are kept — they are the shape
future products take — and every one of them still carries `pricingStatus:
"DEMO"`, which is exactly why none may be reachable.

---

## 2. Product #1 — Custom Insulated Takeout Bag

The only launch-enabled product.

| | |
| --- | --- |
| id / slug | `p-custom-takeout` / `custom-insulated-takeout-bags` |
| Construction (FIXED) | PP laminated outer · non-woven fabric middle · aluminium foil inner |
| Sizes | Large 26 × 26 × 17 cm · Extra Large 30 × 30 × 20 cm (W × H × side gusset) |
| Colors | Black · White |
| Printing | Custom logo/artwork, artwork REQUIRED |
| MOQ | 5,000 pieces per design |
| Orderable quantities | 5,000 · 10,000 |
| Prices (product subtotals) | Large $950 / $1,500 · XL $1,150 / $1,900 |
| Shipping | Flat $100 per ORDER, US only |
| Lead time | 15–30 days after digital-proof approval |
| Market | United States |

### What is a SPECIFICATION, and why

`Product.specifications` renders construction facts the customer cannot
change. The three-layer stack is fixed by the factory, so a material picker
would advertise a capability that does not exist. There is also no GSM,
thickness or insulation-structure selector, and no handle option — none is
factory-confirmed, and an empty `handles` list is the honest state.

`materials` holds ONE entry. It exists because the construction is a real
product fact that must travel onto the order line and the Shopify line, and
because merchandise identity is `product|size|material|color` everywhere in
the system. The configurator renders no material control when there is only
one.

### Why there is no print-colour-count selector

Real factory printing cost depends on production colour separation, which is
determined during internal production review of the uploaded artwork. Asking
the customer to pick "1 colour / 2 colours / 3 colours" would ask them to
price something neither they nor this codebase can determine at configure
time. So there is one print option, the customer uploads artwork, and the
digital proof is where the actual separation is confirmed.

---

## 3. How the four prices are produced

No new pricing concept was introduced. `SizeOption.priceDeltaCents` feeds the
existing per-unit option delta:

```
unit price = tier(quantity) + size delta + material delta + print delta
```

| | tier 5,000 → 19¢ | tier 10,000 → 15¢ |
| --- | --- | --- |
| Large (delta 0¢) | 19¢ → **$950** | 15¢ → **$1,500** |
| Extra Large (delta +4¢) | 23¢ → **$1,150** | 19¢ → **$1,900** |

Every value is a whole number of cents, at every tier, for every size.

### The $0.185 decision

The supplier's own historic XL job sold 10,000 bags for $1,850 ex-shipping —
$0.185/bag. BagDirect's money model is integer cents per unit end to end (the
engine, the cart, the order rows, the Shopify `priceOverride`), and fractional
cents are rejected by cost validation on purpose. Rather than introduce a
fractional-cent monetary authority for one launch price, the MVP sells at
$0.19/bag = $1,900. Revisiting it is a price decision, not a code change.

---

## 4. Quote boundaries

Enforced in `modules/pricing → requiresCustomQuote`, which both the
configurator and `/api/checkout` call — so a hand-crafted request cannot buy
one either:

- below the product MOQ
- above the largest published quantity
- any quantity that is not one of `quantityPresets`, when
  `allowCustomQuantity: false`
- custom dimensions (the factory supports them; the same 5,000-piece minimum
  applies, and the price is not a published number)
- a colour marked `custom`

`allowCustomQuantity: false` additionally removes the free-text quantity input
from the configurator, so the UI does not offer what the engine will refuse.

---

## 5. Shipping is a customer charge, once per order

`config/shipping.ts → FLAT_US_SHIPPING_CENTS` is what the customer PAYS, not
what freight costs. It rides the Shopify draft order as a single
`shippingLine` on the ORDER (docs/SHOPIFY_PRODUCTION.md §10), is verified on
read-back, and is displayed separately from the product subtotal on the
product page, in the cart and at checkout. It is never tax and never duty, and
it is never written into supplier freight cost.

---

## 6. Persisted configurations outlive the catalog

A `product_configurations` row written under an older catalog can name options
the product no longer offers. Read back verbatim, that puts the storefront in
a state it cannot render honestly: the configurator finds no matching option,
silently stops enforcing that option's rules (artwork stops being required, a
delta stops being priced), and Add to cart still looks available.

`reconcileConfiguration(product, stored)` (lib/configuration/validation.ts)
therefore falls back to the catalog DEFAULT for any field whose id is no
longer legal, and reports which fields moved. It runs on the read path
(`resolveCurrentConfiguration`) and on the patch path
(`applyConfigurationPatchForSession`), so a patch cannot preserve a retired
option in the fields it does not touch. Nothing is invented — the fallback is
the same value a first-time visitor sees. Artwork is preserved; it belongs to
the customer, not to the catalog.

---

## 7. Adding or re-enabling a product

1. Add the entry to `config/products.ts` with `launchEnabled: false`.
2. Fill real sizes (with `unit`), colours, specifications, MOQ, quantity
   presets and tiers. Keep `pricingStatus: "DEMO"` until the prices are
   owner-confirmed.
3. Add a cost entry in `config/costs.ts` — `null` placeholders are fine and
   never block a sale, but the key must exist or validation errors.
4. Flip `launchEnabled: true`. `requiredMerchandiseKeys()` immediately demands
   its Shopify variants, and `/admin/launch-readiness` blocks until they are
   mapped. That is the intended order: the requirement follows the catalog, it
   is never a hand-maintained list.
