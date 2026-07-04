export default function TodayLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i}>
          <div className="h-3 w-32 bg-gray-800 rounded mb-3" />
          <div className="space-y-2">
            <div className="h-8 w-full bg-gray-800 rounded" />
            <div className="h-8 w-4/5 bg-gray-800 rounded" />
            <div className="h-8 w-3/5 bg-gray-800 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
