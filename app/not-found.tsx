import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
      <p className="label-mono">404</p>
      <h1 className="mt-2 text-3xl" style={{ fontWeight: 600 }}>
        That page isn&apos;t here
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-ink-3">
        The address may have changed. The products and pricing are one click away.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/" className="btn btn--primary">
          Homepage
        </Link>
        <Link href="/products" className="btn btn--secondary">
          All products
        </Link>
      </div>
    </section>
  );
}
