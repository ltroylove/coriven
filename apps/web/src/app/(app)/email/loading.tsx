export default function EmailLoading() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-6 w-16 bg-gray-800 rounded animate-pulse" />
        <div className="h-4 w-56 bg-gray-800 rounded animate-pulse mt-1" />
      </div>

      <div className="space-y-8 max-w-3xl">
        {[1, 2].map((section) => (
          <div key={section}>
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 w-28 bg-gray-800 rounded animate-pulse" />
              <div className="h-3 w-4 bg-gray-800 rounded animate-pulse" />
            </div>

            <div className="space-y-1.5">
              {[1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="flex items-start gap-3 rounded-lg border border-gray-800 px-4 py-3"
                >
                  <div className="mt-1.5 w-2 h-2 rounded-full bg-gray-800 animate-pulse flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="h-4 w-32 bg-gray-800 rounded animate-pulse" />
                      <div className="h-3 w-10 bg-gray-800 rounded animate-pulse" />
                    </div>
                    <div className="h-3 w-48 bg-gray-800 rounded animate-pulse mb-1" />
                    <div className="h-3 w-full bg-gray-800 rounded animate-pulse" />
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
                    <div className="h-4 w-14 bg-gray-800 rounded animate-pulse" />
                    <div className="h-3 w-12 bg-gray-800 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
