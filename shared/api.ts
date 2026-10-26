// Uygulama ↔ Apps Script sözleşmesi. Tüm istekler POST, gövde JSON (Content-Type: text/plain).
import type { Item, Setting } from './schema.ts';
import type { Rec } from './convert.ts';

export type Table = 'kalemler' | 'ayarlar';

export interface ReadRequest { action: 'read'; key?: string; fingerprint?: string }
export interface HealthRequest { action: 'health' }

export interface UpsertOp {
  op: 'upsert';
  table: Table;
  id: string;
  opId: string;
  baseVersion?: number;
  patch: Rec;
}
export interface DeleteOp { op: 'delete' | 'restore'; table: Table; id: string; opId: string }
export type Op = UpsertOp | DeleteOp;

export interface BatchRequest { action: 'batch'; key?: string; actor: string; ops: Op[] }
export type ApiRequest = ReadRequest | HealthRequest | BatchRequest;

export interface ReadFull {
  ok: true;
  notModified?: false;
  fingerprint: string;
  serverTime: string;
  schemaVersion: number;
  items: Item[];
  settings: Setting[];
}
export interface ReadNotModified { ok: true; notModified: true; fingerprint: string; serverTime: string; schemaVersion: number }
export type ReadResponse = ReadFull | ReadNotModified;

export interface Conflict { keys: string[]; serverValues: Rec; serverVersion: number; updatedBy?: string; updatedAt?: string }

export interface OpResult {
  ok: boolean;
  id: string;
  row?: Rec;
  duplicate?: boolean;
  conflict?: Conflict;
  error?: ApiErrorCode;
  message?: string;
}

export interface BatchResponse {
  ok: boolean;
  results: OpResult[];
  doneCount: number;
  fingerprint: string;
  serverTime: string;
  error?: ApiErrorCode;
  message?: string;
}

export interface HealthResponse {
  ok: true;
  app: 'aile';
  schemaVersion: number;
  serverTime: string;
  fingerprint?: string;
  triggers?: string[];
  warnings?: string[];
}

export type ApiErrorCode = 'unauthorized' | 'busy' | 'schema' | 'bad_request' | 'not_found' | 'invalid_enum' | 'internal';

export interface ErrorResponse {
  ok: false;
  error: ApiErrorCode;
  message?: string;
  missing?: string[];
  field?: string;
  allowed?: string[];
  retryAfterMs?: number;
}

export type ApiResponse = ReadResponse | BatchResponse | HealthResponse | ErrorResponse;
