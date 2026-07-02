import OpenAI from 'openai'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new EmbeddingError('OPENAI_API_KEY is not set')
  return new OpenAI({ apiKey })
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) return new Array(EMBEDDING_DIMENSIONS).fill(0)
  try {
    const client = getClient()
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    })
    return response.data[0].embedding
  } catch (err) {
    console.error('[embedding] Failed to generate embedding', {
      model: EMBEDDING_MODEL,
      inputLength: text.length,
      error: err,
    })
    throw new EmbeddingError('Failed to generate embedding', err)
  }
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const nonEmpty = texts.map(t => t.trim() || ' ')
  try {
    const client = getClient()
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: nonEmpty,
    })
    return response.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding)
  } catch (err) {
    console.error('[embedding] Failed to generate batch embeddings', {
      model: EMBEDDING_MODEL,
      count: texts.length,
      error: err,
    })
    throw new EmbeddingError('Failed to generate batch embeddings', err)
  }
}
