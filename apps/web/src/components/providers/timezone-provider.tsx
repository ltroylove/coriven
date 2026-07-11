'use client'

import { createContext, useContext } from 'react'

const TimezoneContext = createContext<string>('America/Chicago')

export function TimezoneProvider({
  timezone,
  children,
}: {
  timezone: string
  children: React.ReactNode
}) {
  return <TimezoneContext.Provider value={timezone}>{children}</TimezoneContext.Provider>
}

export function useTimezone(): string {
  return useContext(TimezoneContext)
}
