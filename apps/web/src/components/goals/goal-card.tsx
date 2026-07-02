import Link from 'next/link'

interface GoalCardProps {
  id: string
  title: string
  whyItMatters?: string | null
  momentum: 'improving' | 'stable' | 'declining' | null
  linkedTaskCount: number
  href: string
}

function MomentumBadge({ momentum }: { momentum: GoalCardProps['momentum'] }) {
  if (momentum === null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-500">
        calculating
      </span>
    )
  }

  const styles = {
    improving: 'bg-green-500/20 text-green-400',
    stable: 'bg-gray-500/20 text-gray-400',
    declining: 'bg-amber-500/20 text-amber-400',
  } as const

  const labels = {
    improving: 'improving',
    stable: 'stable',
    declining: 'declining',
  } as const

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[momentum]}`}>
      {labels[momentum]}
    </span>
  )
}

export function GoalCard({ id, title, whyItMatters, momentum, linkedTaskCount, href }: GoalCardProps) {
  const momentumLabel = momentum ?? 'calculating'
  const ariaLabel = `${title}, momentum: ${momentumLabel}, ${linkedTaskCount} linked task${linkedTaskCount !== 1 ? 's' : ''}`

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="block rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-gray-700 hover:bg-gray-850 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950 motion-safe:transition-colors"
      tabIndex={0}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-white leading-snug">{title}</h3>
        <MomentumBadge momentum={momentum} />
      </div>
      {whyItMatters && (
        <p className="text-xs text-gray-400 line-clamp-2 mb-3">{whyItMatters}</p>
      )}
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <span>{linkedTaskCount} task{linkedTaskCount !== 1 ? 's' : ''}</span>
      </div>
    </Link>
  )
}
