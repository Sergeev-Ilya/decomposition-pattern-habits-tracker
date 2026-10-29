export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string>) { super(message); }
}
export const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт снова');
export const unavailable = () => new HttpError(503, 'SERVICE_UNAVAILABLE', 'Сервис временно недоступен. Попробуйте ещё раз');
export async function database<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { if (error instanceof HttpError) throw error; throw unavailable(); }
}
