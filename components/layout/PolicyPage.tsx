/** Shared policy-page shell. Content blocks are plain data — editable per page. */
export function PolicyPage({
  title,
  intro,
  sections,
  reviewed = false,
}: {
  title: string;
  intro: string;
  sections: { h: string; body: string[] }[];
  reviewed?: boolean;
}) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl" style={{ fontWeight: 600 }}>
        {title}
      </h1>
      {!reviewed && (
        <p className="mt-4 rounded-sm bg-error-soft px-4 py-3 text-sm text-error">
          Draft policy — this text must be reviewed by the business owner and a legal advisor before launch. See
          BUSINESS_CONFIG_TODO.md.
        </p>
      )}
      <p className="mt-4 text-ink-2">{intro}</p>
      {sections.map((s) => (
        <div key={s.h} className="mt-8">
          <h2 className="text-lg" style={{ fontWeight: 600 }}>
            {s.h}
          </h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-2 text-sm leading-relaxed text-ink-2">
              {p}
            </p>
          ))}
        </div>
      ))}
    </section>
  );
}
