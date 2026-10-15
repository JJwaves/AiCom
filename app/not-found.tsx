import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="container-page py-24 text-center">
      <p className="eyebrow">404</p>
      <h1 className="type-h1 mt-3">That page isn&apos;t here.</h1>
      <p className="mx-auto mt-4 max-w-sm text-base text-brand-ink-2">The address may have changed. The products and pricing are one click away.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Button render={<Link href="/" />}>Homepage</Button>
        <Button variant="outline" render={<Link href="/products" />}>
          All products
        </Button>
      </div>
    </section>
  );
}
