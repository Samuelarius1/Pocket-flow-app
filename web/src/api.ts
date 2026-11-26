import { Capacitor } from '@capacitor/core'

const API_BASE_URL = Capacitor.isNativePlatform()
  ? 'http://localhost:8765'
  : ''

export function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string' && input.startsWith('/api/')
      ? `${API_BASE_URL}${input}`
      : input

  return fetch(url, init)
}
