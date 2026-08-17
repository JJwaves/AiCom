# Artwork Storage

**Authoritative for: artwork upload, validation, storage, access, database
association, order linkage, privacy and retention.**
Implemented in Production Launch Session 02 (2026-08-16).

Companion: [SHOPIFY_PRODUCTION.md](SHOPIFY_PRODUCTION.md),
[DATABASE_SCHEMA.md](DATABASE_SCHEMA.md).

---

## 1. What changed and why

Before this session, "uploading" a logo meant:

```ts
url: URL.createObjectURL(file)   // components/product/ArtworkUploader.tsx
```

The file **never left the browser**. The reference died with the tab. A
customer could configure a 1-color print, pay, and BagDirect would hold an
order line pointing at a `blob:` URL nobody could ever open. The `artworks`
table stored metadata only — filename, type, size — and `storage_url` was
always null.

For a business whose product is *printing the customer's logo on a bag*, that
is not a missing feature; it is the order being unfulfillable.

Artwork is now uploaded to durable object storage, verified server-side, and
linked to a specific order **line**.

---

## 2. Upload flow

```
 Browser selects a file
        │  client-side validation (fast feedback only)
        ▼
 POST /api/artwork/upload
        │  server validates the REQUEST: type, size, extension, SVG policy
        │  server mints the artwork id  →  server derives the object KEY
        │  server chooses the Content-Type  →  SIGNS it
        │  row created: status = pending_upload           ← not usable yet
        ▼
 PUT <signed url>   browser → object storage, direct
        │  (the bytes never pass through the Next.js server)
        ▼
 POST /api/artwork/{id}/complete
        │  server HEADs the object: exists? size within limit? non-empty?
        │  server reads the first 16 bytes: do they match the extension?
        │  pass → status = uploaded          ← now usable by commerce
        │  fail → object DELETED, status = rejected
        ▼
 ArtworkRef { artworkId, fileName, fileType, fileSizeBytes }
        ▼
 Configuration → Cart → /api/checkout → Order line → artworks.order_line_id
```

### Why the browser uploads directly

Artwork is up to 25 MB. Routing it through a route handler would hit
serverless request-body limits (4.5 MB on Vercel) and burn function time
proportional to file size.

The server keeps authority over everything that matters anyway — see §4.

---

## 3. Validation (§24)

Both the browser and the server validate. **Only the server's answer counts.**

| check | where |
|---|---|
| extension in `{png, jpg, jpeg, pdf, ai, eps}` | client + server |
| declared MIME consistent with that set | client + server |
| size ≤ 25 MB, > 0 | client + server (request) |
| SVG rejected | client + server |
| **actual stored byte length** | server, at completion |
| **actual file format, from magic bytes** | server, at completion |
| filename sanitized | server |

### Magic-byte verification

The browser's declared MIME type and the filename extension are both
attacker-controlled. At completion the server reads the first 16 bytes and
identifies the real format:

| format | signature |
|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| PDF | `%PDF-` |
| PostScript / EPS | `%!PS`, or the DOS EPS wrapper `C5 D0 D3 C6` |

`.ai` accepts PDF **or** PostScript, because modern Illustrator writes
PDF-based `.ai` files. A file whose contents contradict its extension is
deleted and rejected — an SVG renamed to `.png` does not survive.

### Filename safety

`safeArtworkFileName` strips directory components (`../../etc/passwd.png` →
`passwd.png`), control characters, quotes and anything non-portable, caps the
stem at 80 characters, and never returns empty. The result is **cosmetic** —
object identity is the artwork id, so a filename collision cannot overwrite
anything.

---

## 4. Server authority over the upload (§58)

Even though the bytes go browser → storage:

- **the object key is server-derived**: `artwork/{artworkId}/{safeFileName}`,
  where `artworkId` is minted server-side. The upload request schema is
  `.strict()`, so a client sending `storageKey` gets a 422. Two customers
  uploading `logo.png` get different keys and cannot collide.
- **the Content-Type is signed**, so the browser cannot store a file as
  something else without invalidating the URL.
- **the upload is not trusted until verified** — see §3.
- **the signed URL expires** (15 minutes) and grants access to exactly one
  key.

---

## 5. SVG policy (§25) — decision, not oversight

**SVG is REJECTED.**

SVG was accepted when "upload" meant a browser object URL that never left the
tab. Now artwork is durably stored and served back to staff through signed
links, and **an SVG is an executable document**: it can carry `<script>`,
external references and CSS. A stored SVG rendered inline is stored XSS
against whoever opens it.

The two real options were:

- **A. Reject** — costs a customer one "export as PDF" click.
- **B. Sanitize server-side** — a real, ongoing security commitment;
  sanitiser bypasses are a live research area, and it would have to be
  paired with a rendering policy.

For a launch selling four printable bag configurations, A removes the entire
risk class for near-zero cost. PDF, AI and EPS all carry vector artwork, so
nothing a printer needs is lost.

The customer sees: *"SVG files can't be accepted. Export your logo as a PDF,
AI, EPS or high-resolution PNG instead — any of those prints better anyway."*

Revisit only with a sanitiser **and** a rendering policy, together.

---

## 6. Storage backend (§21, §22)

**One backend: S3-compatible.** That single choice covers AWS S3, Cloudflare
R2, Backblaze B2, DigitalOcean Spaces and MinIO.

**No SDK, no dependency.** SigV4 query-string presigning is ~80 lines of
`node:crypto` (`lib/storage/s3.ts`). Pulling in an AWS SDK to build four URLs
would add tens of megabytes to the deploy for no capability we need. There is
also deliberately **no generic storage abstraction** — one backend, one
implementation, per CLAUDE.md's no-over-engineering rule. `ArtworkStorage` is
a narrow port, and its only reason to exist is that tests inject a fake.

### Configuration

All server-only. There is no `NEXT_PUBLIC_ARTWORK_*` variable; the browser
never learns the bucket, the endpoint or a key.

| variable | example |
|---|---|
| `ARTWORK_S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` |
| `ARTWORK_S3_REGION` | `auto` (R2) / `us-east-1` (S3) |
| `ARTWORK_S3_BUCKET` | `bagdirect-artwork` |
| `ARTWORK_S3_ACCESS_KEY_ID` | |
| `ARTWORK_S3_SECRET_ACCESS_KEY` | |
| `ARTWORK_S3_FORCE_PATH_STYLE` | `true` for MinIO-style addressing |

**Partial configuration throws in every environment** — same reasoning as the
commerce guard: half-set credentials always mean the backend was intended.

**Missing configuration never pretends to succeed.** With nothing configured,
`POST /api/artwork/upload` answers **503**:

> Logo uploads aren't available right now. Choose "No logo" to continue, or
> contact us to send artwork.

No artwork row is created, and nothing enters the cart. A printed
configuration then cannot be checked out, which is correct: the alternative is
taking money for a bag nobody can print.

---

## 7. Access (§26)

Objects are **private**. Nothing is publicly readable and nothing is
enumerable: keys embed a random artwork id, and the bucket is never listed.

Reads happen through short-lived signed GET URLs minted server-side
(`createDownloadUrl`, 10-minute TTL), with a `Content-Disposition: attachment`
override so a browser downloads rather than renders — belt and braces beside
the SVG rejection.

Storage credentials never leave the server. The bucket name and endpoint never
reach the client.

---

## 8. Database record (§27)

The existing `artworks` table, extended (migration `0009`):

| column | meaning |
|---|---|
| `id` | `art_…` — **THE** durable reference |
| `session_id` | who uploaded it (ownership check) |
| `customer_id` | set when identity becomes known |
| `order_id` | the order it is printed on |
| **`order_line_id`** | **the exact line** (new — see §9) |
| `quote_id` | set for quote-attached artwork |
| `file_name` | sanitized; redacted on customer deletion |
| `file_type` | server-chosen content type |
| `size_bytes` | **verified** size, not the declared one |
| **`storage_key`** | object key (new; not a URL, not a signed link) |
| **`storage_provider`** | `s3` |
| **`checksum`** | when the backend reports a verifiable digest |
| `storage_url` | legacy, never written any more |
| `status` | lifecycle, below |

### Lifecycle

```
pending_upload → uploaded → review_required → proof_created → proof_sent
                     ↓            → approved / revision_requested
                  rejected                   → production_ready
                     ↓
                 abandoned
```

`pending_upload` is **not usable by commerce**. `isArtworkUsableForSession`
gates checkout on a verified status *and* session ownership, so an artwork id
copied from elsewhere cannot put someone else's logo on a bag.

---

## 9. Artwork → order line (§28)

Fulfilment staff must be able to answer *"what artwork belongs to this order
line?"* deterministically.

`order_id` alone cannot: a multi-line order can carry different artwork per
line. So `artworks.order_line_id` is set explicitly, inside the order
persistence path, from the artwork id embedded in that line's configuration.

The association is **never** inferred from customer email, filename, browser
session or free-form line-item text.

Two copies exist and their roles are distinct:

- `artworks.order_line_id` — **authoritative**
- `order_lines.config_json.artwork.artworkId` — the immutable snapshot of what
  was configured at purchase time
- `_bd_artwork_id` on the Shopify line — a convenience copy for humans reading
  the Shopify admin, **never** authoritative

---

## 10. Legacy `blob:` references

A cart saved in `localStorage` before this session carries an artwork ref with
a dead `blob:` URL and no `artworkId`.

- `url` is **stripped at the API boundary** by the checkout schema — it is
  never persisted onto an order line
- a printed line with no `artworkId` is **refused** at checkout: *"Please
  re-upload your logo for '1-color print' — the earlier file is no longer
  available"*
- a structural test asserts `createObjectURL` appears nowhere in `app/` or
  `components/`

---

## 11. Privacy (§27, Session 03.5 semantics preserved)

Customer deletion redacts, and now covers the new column:

| field | on customer deletion |
|---|---|
| `file_name` | → `[deleted]` |
| `storage_key` | → `null` (it embeds the filename) |
| `storage_url` | → `null` |
| `notes` | → `null` |
| `file_type`, `size_bytes`, `status` | **kept** — "an artwork existed for this order" is a commerce fact |
| the row itself | **kept** — commerce records survive detached |

**The stored object is not deleted by this path.** Object deletion is
retention work (§12), tracked as deferred rather than silently assumed.

Session deletion cascades as before.

---

## 12. Retention and cleanup (§29)

`listAbandonedArtwork(olderThanDays = 30)` identifies uploads that are
`pending_upload` or `uploaded`, attached to **no** order and **no** quote, and
older than the cutoff.

This is a **query, not a worker**. Deleting stored bytes on a schedule is
**deferred**; what launch requires is that abandoned data be *identifiable*
rather than invisible, so retention can be executed deliberately instead of
discovered later.

`artworkStatusCounts()` gives operational visibility.

**Deferred:** a scheduled cleanup job, object deletion on customer deletion, a
storage lifecycle rule, and proof/approval workflow automation.

---

## 13. Quotes (§30)

`/api/quote` still accepts a multipart file and records artwork **metadata**
only (`recordArtwork`, no `storage_key`). Quote artwork is **not** yet routed
through durable storage.

This is a stated limitation, not an oversight: the quote form is a single
multipart POST to a webhook-delivering endpoint, and converting it to the
two-step signed-upload flow means changing a working form, its webhook payload
and its tests — scope this session deliberately did not take on, because
quotes are the *secondary* conversion path and the primary one (purchase) was
the blocker.

The infrastructure is ready: the same `/api/artwork/upload` +
`/api/artwork/{id}/complete` pair works for quotes, and `artworks.quote_id`
already exists. **There is no second file-storage system**, and none should be
built.

---

## 14. Testing (§56)

`tests/artwork-storage.test.ts` — 42 tests, **no network call**. The storage
backend is a fake that records what the server asked it to do, which is what
makes "the browser cannot choose the key" and "the server verifies the bytes"
testable rather than asserted:

format acceptance · SVG rejection · size and empty-file limits · MIME
mismatch · filename traversal and control characters · magic-byte sniffing ·
extension/content contradiction · server-derived keys · signed content type ·
key collisions · strict schema · storage-not-configured 503 · rate limiting ·
completion verification (missing / oversize / empty / wrong format) ·
idempotent completion · cross-session refusal · usability gating ·
artwork→order-line linkage · abandoned-upload identification · privacy
redaction · SigV4 URL shape and determinism.

---

## 15. Known limitations

- **Quote artwork is metadata-only** (§13).
- **Object deletion is deferred** — privacy redaction nulls the key but leaves
  the object (§11, §12).
- ~~Size is enforced after upload, not during.~~ **Closed in Production Launch
  Session 03 (§18):** the signed PUT now signs `Content-Length` as well as the
  key and content type, so a URL issued for a 40 KB logo cannot upload 25 MB.
  Content-Length is a forbidden header name in `fetch`, so the browser sets it
  from the body — which is what makes it a binding the caller cannot forge.
  The post-upload HEAD and magic-byte check remain as defence in depth.
- **No virus scanning.** Format verification is not malware detection.
- **No image dimension or DPI check.** Whether a logo is print-quality is a
  human proof-review step, and the proof workflow is not automated.
- **No thumbnail or preview generation** — the uploader shows a filename, not
  a rendered preview, since this session removed the object URL that used to
  provide one.


---

## 16. Upload allowances and durability (Production Launch Session 03)

### Per-session allowance (§19)

Rate limiting bounds how FAST a caller can mint signed upload URLs. It does
not bound how MANY objects one anonymous session can create over a day — a
patient script staying under every per-minute limit could still fill a bucket.
So there is a separate total allowance:

```bash
ARTWORK_MAX_UPLOADS_PER_SESSION=25   # default
ARTWORK_UPLOAD_WINDOW_HOURS=24       # default
```

Every artwork row counts, including `rejected` and `abandoned` ones: they
consumed a signed URL and may have put bytes in the bucket.

Deliberately generous. The default is sized from real B2B behaviour — a
multi-line order with a logo per line, plus re-exports, plus failed attempts —
and then multiplied. A blocked customer is a lost order; an over-uploading one
costs fractions of a cent per file. Exceeding it returns
`UPLOAD_LIMIT_REACHED` with copy that tells the customer to email the rest of
their artwork, not a blank failure.

If the allowance check itself fails (a database problem), it is logged and
treated as "unknown" rather than blocking a paying customer — the rate limiter
and the bucket's own policy still apply.

### Rate limiting (§15)

| Route | Class | Session | Network |
| --- | --- | --- | --- |
| `/api/artwork/upload` | PUBLIC_EXTERNAL_COST | 10/min | 30/min |
| `/api/artwork/[id]/complete` | PUBLIC_LOW_COST | 60/min | 180/min |

Minting a signed URL is minting a capability, so it is the tighter of the two.
Verification is a HEAD plus a 16-byte ranged GET.

### Durability — OWNER VERIFICATION REQUIRED (§52)

**S3-compatible storage being durable does not automatically satisfy a
business backup policy, and BagDirect cannot query your bucket's settings.**

For soft launch, durable object storage is enough. What the owner should
confirm and record:

- **Versioning enabled** on the bucket, so an accidental overwrite or delete
  is recoverable.
- **Lifecycle rules** consistent with the retention decision in §12.
- **Cross-region replication is DEFERRED**, explicitly. It is a real cost and
  a real decision, not an oversight — a single-region bucket losing a region
  would lose in-flight artwork for unfulfilled orders. Revisit when order
  volume makes that loss material.

Launch readiness reports this as `ARTWORK_DURABILITY`, owner-verified, and it
never self-resolves.
