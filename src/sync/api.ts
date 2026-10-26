// Apps Script'e TEK çıkış noktası. POST + text/plain (preflight yok), 302 izlenir, başka başlık YOK.
import type { ApiRequest, ApiResponse, ApiErrorCode } from '@shared/api';

export type ClientErrorCode = ApiErrorCode | 'network' | 'html' | 'config' | 'parse';

export class ApiError extends Error {
  code: ClientErrorCode;
  retryable: boolean;
  extra?: Record<string, unknown>;
  constructor(code: ClientErrorCode, message: string, retryable: boolean, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryable = retryable;
    this.extra = extra;
  }
}

export function classifyHtml(text: string): ApiError {
  const t = text.toLowerCase();
  if (t.includes('accounts.google.com') || t.includes('servicelogin')) {
    return new ApiError('config', 'Web uygulaması "Herkes" erişimiyle dağıtılmamış (Google giriş sayfası döndü).', false);
  }
  if (t.includes('script function not found') || t.includes('did not return anything')) {
    return new ApiError('config', 'Dağıtımda yeni sürüm yayınlanmamış (doPost bulunamadı).', false);
  }
  if (t.includes('unable to open') || t.includes('sorry') || t.includes('geçici') || t.includes('temporarily')) {
    return new ApiError('html', 'Google tarafında geçici sorun; yeniden denenecek.', true);
  }
  return new ApiError('html', 'Beklenmeyen HTML yanıtı; adres yanlış olabilir.', true);
}

export interface CallOptions { keepalive?: boolean; fetchImpl?: typeof fetch; signal?: AbortSignal }

export async function callApi<T extends ApiResponse = ApiResponse>(url: string, body: ApiRequest, opts: CallOptions = {}): Promise<T> {
  if (!url) throw new ApiError('config', 'API adresi ayarlanmamış (Ayarlar).', false);
  const f = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      credentials: 'omit',
      keepalive: opts.keepalive,
      signal: opts.signal,
    });
  } catch (e) {
    throw new ApiError('network', `Ağ hatası: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  if (!res.ok && !text.trim().startsWith('{')) throw new ApiError('network', `HTTP ${res.status}`, res.status >= 500 || res.status === 429);
  let parsed: ApiResponse;
  try { parsed = JSON.parse(text) as ApiResponse; } catch {
    if (/<\s*html|<!doctype/i.test(text)) throw classifyHtml(text);
    throw new ApiError('parse', 'Yanıt çözülemedi', true);
  }
  if (parsed.ok === false) {
    const code: ApiErrorCode = parsed.error ?? 'internal';
    const retryable = code === 'busy' || code === 'internal';
    throw new ApiError(code, parsed.message ?? code, retryable, { ...parsed });
  }
  return parsed as T;
}
