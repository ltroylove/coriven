// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { validatePayload } from '../payload-validator'

describe('validatePayload — unknown action type', () => {
  it('rejects an unknown action type', () => {
    const result = validatePayload('delete_everything', { to: 'a@b.com' })
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatch(/Unknown action type/)
  })
})

describe('validatePayload — send_email', () => {
  it('accepts a valid send_email payload', () => {
    const result = validatePayload('send_email', {
      to: 'alice@example.com',
      subject: 'Hello',
      body: 'Hi there!',
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects when "to" is missing', () => {
    const result = validatePayload('send_email', { subject: 'Hello', body: 'Hi' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('"to"'))).toBe(true)
  })

  it('rejects when "subject" is missing', () => {
    const result = validatePayload('send_email', { to: 'a@b.com', body: 'Hi' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('"subject"'))).toBe(true)
  })

  it('rejects when "body" is missing', () => {
    const result = validatePayload('send_email', { to: 'a@b.com', subject: 'Hello' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('"body"'))).toBe(true)
  })

  it('rejects when payload is not an object', () => {
    const result = validatePayload('send_email', 'not an object')
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('non-null object'))).toBe(true)
  })

  it('rejects when payload is null', () => {
    const result = validatePayload('send_email', null)
    expect(result.valid).toBe(false)
  })

  it('rejects when payload is an array', () => {
    const result = validatePayload('send_email', [])
    expect(result.valid).toBe(false)
  })

  it('reports multiple missing fields', () => {
    const result = validatePayload('send_email', {})
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('validatePayload — create_calendar_event', () => {
  it('accepts a valid create_calendar_event payload', () => {
    const result = validatePayload('create_calendar_event', {
      title: 'Team sync',
      start: '2026-07-05T10:00:00Z',
      end: '2026-07-05T11:00:00Z',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects when "title" is missing', () => {
    const result = validatePayload('create_calendar_event', {
      start: '2026-07-05T10:00:00Z',
      end: '2026-07-05T11:00:00Z',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('"title"'))).toBe(true)
  })

  it('rejects when "start" is missing', () => {
    const result = validatePayload('create_calendar_event', {
      title: 'Meeting',
      end: '2026-07-05T11:00:00Z',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('"start"'))).toBe(true)
  })

  it('rejects when "end" is missing', () => {
    const result = validatePayload('create_calendar_event', {
      title: 'Meeting',
      start: '2026-07-05T10:00:00Z',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('"end"'))).toBe(true)
  })
})

describe('validatePayload — update_calendar_event', () => {
  it('accepts a valid update_calendar_event payload', () => {
    const result = validatePayload('update_calendar_event', {
      event_id: 'evt-123',
      title: 'Updated title',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects when "event_id" is missing', () => {
    const result = validatePayload('update_calendar_event', { title: 'New title' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('"event_id"'))).toBe(true)
  })

  it('rejects when no update fields are provided', () => {
    const result = validatePayload('update_calendar_event', { event_id: 'evt-123' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('at least one field'))).toBe(true)
  })
})
