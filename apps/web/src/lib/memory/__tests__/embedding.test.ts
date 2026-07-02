import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Top-level factory — vi.mock is hoisted, so we capture the mock create fn here
// and reassign its implementation per-test.
const mockCreate = vi.fn()

vi.mock('openai', () => {
  return {
    default: function MockOpenAI() {
      return { embeddings: { create: mockCreate } }
    },
  }
})

describe('generateEmbedding', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockReset()
    process.env.OPENAI_API_KEY = 'test-key'
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalKey
    }
  })

  it('returns a 1536-element array on success', async () => {
    const mockEmbedding = new Array(1536).fill(0.1)
    mockCreate.mockResolvedValue({ data: [{ embedding: mockEmbedding, index: 0 }] })
    const { generateEmbedding } = await import('../embedding')
    const result = await generateEmbedding('hello world')
    expect(result).toHaveLength(1536)
  })

  it('returns zero vector for empty string', async () => {
    const { generateEmbedding } = await import('../embedding')
    const result = await generateEmbedding('')
    expect(result).toHaveLength(1536)
    expect(result.every(v => v === 0)).toBe(true)
  })

  it('throws EmbeddingError on API failure', async () => {
    mockCreate.mockRejectedValue(new Error('API down'))
    const { generateEmbedding, EmbeddingError } = await import('../embedding')
    await expect(generateEmbedding('test')).rejects.toThrow(EmbeddingError)
  })

  it('throws EmbeddingError when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY
    const { generateEmbedding, EmbeddingError } = await import('../embedding')
    await expect(generateEmbedding('test')).rejects.toThrow(EmbeddingError)
  })

  it('generateEmbeddings returns parallel arrays for batch', async () => {
    const mockEmbedding = new Array(1536).fill(0.2)
    mockCreate.mockResolvedValue({
      data: [
        { embedding: mockEmbedding, index: 0 },
        { embedding: mockEmbedding, index: 1 },
      ],
    })
    const { generateEmbeddings } = await import('../embedding')
    const result = await generateEmbeddings(['hello', 'world'])
    expect(result).toHaveLength(2)
    expect(result[0]).toHaveLength(1536)
  })
})
