import { describe, it, expect, vi } from 'vitest';
import { callApi, ApiError, classifyHtml } from './api';

const URL = 'https://script.google.com/macros/s/abc/exec';

function mockFetch(status: number, body: string) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => body })) as unknown as typeof fetch;
}

describe('callApi', () => {
  it('POST + text/plain + redirect follow + credentials omit; başka başlık yok', async () => {
    const f = mockFetch(200, JSON.stringify({ ok: true, app: 'aile', schemaVersion: 1, serverTime: 'x' }));
    const res = await callApi(URL, { action: 'health' }, { fetchImpl: f });
    expect(res.ok).toBe(true);
    const [, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain;charset=utf-8' });
    expect(init.redirect).toBe('follow');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'health' });
  });
  it('adres yoksa config hatası', async () => {
    await expect(callApi('', { action: 'health' })).rejects.toMatchObject({ code: 'config', retryable: false });
  });
  it('ok:false → ApiError kodu; busy yeniden denenebilir, not_found denenemez', async () => {
    await expect(callApi(URL, { action: 'health' }, { fetchImpl: mockFetch(200, JSON.stringify({ ok: false, error: 'busy' })) })).rejects.toMatchObject({ code: 'busy', retryable: true });
    await expect(callApi(URL, { action: 'health' }, { fetchImpl: mockFetch(200, JSON.stringify({ ok: false, error: 'not_found' })) })).rejects.toMatchObject({ code: 'not_found', retryable: false });
  });
  it('HTML yanıtı sınıflandırılır', async () => {
    await expect(callApi(URL, { action: 'health' }, { fetchImpl: mockFetch(200, '<html><body><a href="https://accounts.google.com/ServiceLogin">x</a></body></html>') })).rejects.toMatchObject({ code: 'config' });
    await expect(callApi(URL, { action: 'health' }, { fetchImpl: mockFetch(200, '<!DOCTYPE html><html>Sorry, unable to open the file at this time.</html>') })).rejects.toMatchObject({ code: 'html', retryable: true });
    expect(classifyHtml('<html>Script function not found: doPost</html>').code).toBe('config');
  });
  it('ağ hatası retryable network', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(callApi(URL, { action: 'health' }, { fetchImpl: f })).rejects.toBeInstanceOf(ApiError);
    await expect(callApi(URL, { action: 'health' }, { fetchImpl: f })).rejects.toMatchObject({ code: 'network', retryable: true });
  });
});
