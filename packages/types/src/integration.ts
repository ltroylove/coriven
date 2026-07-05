export type IntegrationProvider =
  | 'gmail'
  | 'outlook'
  | 'google_calendar'
  | 'outlook_calendar'

export interface Integration {
  id: string
  user_id: string
  provider: IntegrationProvider
  nango_connection_id: string
  scopes: string[]
  connected_at: string
  updated_at: string
}
