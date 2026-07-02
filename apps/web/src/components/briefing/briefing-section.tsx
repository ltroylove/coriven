interface BriefingSectionProps {
  title: string
  items: React.ReactNode[]
  emptyMessage?: string
}

export function BriefingSection({ title, items, emptyMessage }: BriefingSectionProps) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
        {title}
      </h2>
      {items.length === 0 ? (
        emptyMessage ? (
          <p className="text-sm text-gray-600">{emptyMessage}</p>
        ) : null
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
