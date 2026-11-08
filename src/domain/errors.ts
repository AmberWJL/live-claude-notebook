export type NotebookErrorCode =
  | 'empty'
  | 'too-large'
  | 'not-found'
  | 'storage'
  | 'malformed'
  | 'invalid'
  | 'conflict'
  | 'busy'

export class NotebookError extends Error {
  constructor(
    readonly code: NotebookErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'NotebookError'
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}
