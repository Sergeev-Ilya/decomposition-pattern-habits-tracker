import type { ErrorEnvelope } from './types';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId = '', public details?: Record<string,string>) { super(message); this.name = 'ApiError'; }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new ApiError(0, 'NETWORK_ERROR', 'Не удалось связаться с сервером. Проверьте соединение и повторите.'); }
  if (!response.ok) {
    let body: ErrorEnvelope | undefined;
    try { body = await response.json(); } catch { /* A failed proxy may have no JSON body. */ }
    throw new ApiError(response.status, body?.error?.code || 'SERVICE_UNAVAILABLE', body?.error?.message || 'Сервис временно недоступен. Повторите попытку.', body?.requestId, body?.error?.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const json = (method: string, data?: unknown): RequestInit => ({ method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
export const isCancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
