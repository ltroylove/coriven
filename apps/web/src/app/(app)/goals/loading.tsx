export default function GoalsLoading() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-6 w-16 bg-gray-800 rounded animate-pulse" />
        <div className="h-4 w-48 bg-gray-800 rounded animate-pulse mt-1" />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {[1, 2, 3].map((col) => (
          <div key={col} className="flex-shrink-0 w-72">
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 w-24 bg-gray-800 rounded animate-pulse" />
              <div className="h-3 w-4 bg-gray-800 rounded animate-pulse" />
            </div>
            <div className="space-y-2">
              {[1, 2].map((card) => (
                <div
                  key={card}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-4"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="h-4 w-32 bg-gray-800 rounded animate-pulse" />
                    <div className="h-4 w-16 bg-gray-800 rounded animate-pulse" />
                  </div>
                  <div className="h-3 w-full bg-gray-800 rounded animate-pulse mb-1" />
                  <div className="h-3 w-3/4 bg-gray-800 rounded animate-pulse mb-3" />
                  <div className="h-3 w-12 bg-gray-800 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
