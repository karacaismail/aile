// Otomatik üretildi: pnpm gas:build — elle düzenlemeyin.
"use strict";
var __aile = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // gas/src/main.ts
  var main_exports = {};
  __export(main_exports, {
    doGet: () => doGet,
    doPost: () => doPost,
    healthCheck: () => healthCheck,
    onEditInstallable: () => onEditInstallable,
    setup: () => setup
  });

  // shared/schema.ts
  var SHEETS = { items: "app_kalemler", settings: "app_ayarlar", cash: "app_nakit" };
  var BUDGET_SHEETS = { plan: "Giderler Planlanan", actual: "Giderler Ger\xE7ekle\u015Fen", pano: "Pano" };
  var SCHEMA_VERSION = 2;
  var TIP = ["satinalma", "aydinlatma", "tadilat", "yerlesim", "usta", "kontrol", "sahne", "kilometre"];
  var ODA = ["salon", "cocuk", "ebeveyn", "calisma", "mutfak", "banyo", "wc", "hol", "balkon1", "balkon2", "genel"];
  var KATEGORI = [
    "mobilya",
    "tekstil",
    "beyaz_esya",
    "mutfak",
    "aydinlatma_akilli",
    "aydinlatma_led",
    "elektrik",
    "iscilik",
    "boya",
    "guvenlik",
    "kopek",
    "bebek",
    "masraf",
    "hizmet",
    "idari",
    "diger"
  ];
  var FAZ = ["1", "2", "3"];
  var DURUM = ["fikir", "arastirma", "karar", "siparis", "teslim", "kuruldu", "iptal"];
  var BIRIM = ["adet", "m", "rulo", "set"];
  var FIYAT_GUVEN = ["dogrulandi", "tahmini", "varsayim"];
  var KATMAN_TUR = ["ana", "ikincil", "ucuncul", "gorev", "gece", "dekoratif"];
  var LUX_DUZLEM = ["yatay", "dikey", "yer"];
  var CCT_MOD = ["sabit", "secmeli", "ayarli", "rgb"];
  var FLICKER = ["ff", "bilinmiyor", "kabul"];
  var KONTROL_CIHAZ = ["hue_dimmer", "hue_button", "hue_motion", "hue_wall_module", "duvar_anahtari", "lamba_dugmesi", "smart_plug"];
  var ADIM = ["kesif", "elektrik", "boya", "profil", "ampul", "akilli", "mobilya", "ince_ayar"];
  var KIM = ["E", "B", "M", "K"];
  var IS_KIM = ["elektrikci", "boyaci", "marangoz", "nakliye", "klimaci", "internet", "ev_sahibi", "idari", "ben"];
  var IZIN_DURUMU = ["gerekmez", "istenecek", "istendi", "alindi", "reddedildi"];
  var MESLEK = ["elektrik", "boya", "marangoz", "nakliye", "klima", "internet", "diger"];
  var KONTROL_TUR = ["sartname", "kabul", "izin", "ev_secimi"];
  var TETIK = ["dugme", "dimmer", "sensor", "zaman", "plug"];
  var SENARYO = ["A", "B", "C", "hepsi"];
  var KILOMETRE_TUR = ["tarih", "bant", "hedef", "siparis"];
  var DUVAR = ["K", "G", "D", "B"];
  var c = (key, label, type, group, en) => ({ key, label, type, group, enum: en });
  var ITEM_COLUMNS = [
    // Kimlik
    c("id", "Kimlik", "metin", "kimlik"),
    c("tip", "Tip", "enum", "kimlik", TIP),
    c("kod", "Kod", "metin", "kimlik"),
    // Ortak
    c("ad", "Ad", "metin", "ortak"),
    c("oda", "Oda", "enum", "ortak", ODA),
    c("kategori", "Kategori", "enum", "ortak", KATEGORI),
    c("faz", "Faz", "enum", "ortak", FAZ),
    c("durum", "Durum", "enum", "ortak", DURUM),
    c("karar_bekliyor", "Karar bekliyor", "bool", "ortak"),
    c("oncelik", "\xD6ncelik", "sayi", "ortak"),
    c("adet", "Adet", "sayi", "ortak"),
    c("birim", "Birim", "enum", "ortak", BIRIM),
    c("tahmini_tl_min", "Tahmini TL (min)", "sayi", "ortak"),
    c("tahmini_tl_max", "Tahmini TL (max)", "sayi", "ortak"),
    c("gercek_tl", "Ger\xE7ek TL", "sayi", "ortak"),
    c("fiyat_guven", "Fiyat g\xFCveni", "enum", "ortak", FIYAT_GUVEN),
    c("linkler", "Linkler", "liste", "ortak"),
    c("not", "Not", "uzunmetin", "ortak"),
    c("mevcut", "Mevcut (elimizde)", "bool", "ortak"),
    c("bagli_idler", "Ba\u011Fl\u0131 kalemler", "liste", "ortak"),
    // Satınalma
    c("nereden", "Nereden", "metin", "satinalma"),
    c("siparis_son_tarih", "Sipari\u015F son tarih", "tarih", "satinalma"),
    c("teslim_suresi_gun", "Teslim s\xFCresi (g\xFCn)", "sayi", "satinalma"),
    c("teslim_tarihi", "Teslim tarihi", "tarih", "satinalma"),
    c("odeme_tarihi", "\xD6deme tarihi", "tarih", "satinalma"),
    // Aydınlatma
    c("katman_tur", "Katman t\xFCr\xFC", "enum", "aydinlatma", KATMAN_TUR),
    c("katman_ad", "Katman ad\u0131", "metin", "aydinlatma"),
    c("amac", "Ama\xE7", "metin", "aydinlatma"),
    c("lux_min", "Lux min", "sayi", "aydinlatma"),
    c("lux_max", "Lux max", "sayi", "aydinlatma"),
    c("lux_duzlem", "Lux d\xFCzlemi", "enum", "aydinlatma", LUX_DUZLEM),
    c("cct_mod", "CCT modu", "enum", "aydinlatma", CCT_MOD),
    c("cct_min", "CCT min (K)", "sayi", "aydinlatma"),
    c("cct_max", "CCT max (K)", "sayi", "aydinlatma"),
    c("dim_min_pct", "Dim min (%)", "sayi", "aydinlatma"),
    c("cri_min", "CRI min", "sayi", "aydinlatma"),
    c("r9_min", "R9 min", "sayi", "aydinlatma"),
    c("flicker", "Flicker", "enum", "aydinlatma", FLICKER),
    c("kontrol_cihaz", "Kontrol cihaz\u0131", "enum", "aydinlatma", KONTROL_CIHAZ),
    c("urun_sinifi", "\xDCr\xFCn s\u0131n\u0131f\u0131", "metin", "aydinlatma"),
    c("uzunluk_m", "Uzunluk (m)", "sayi", "aydinlatma"),
    c("w_per_m", "W/m", "sayi", "aydinlatma"),
    c("surucu_model", "S\xFCr\xFCc\xFC modeli", "metin", "aydinlatma"),
    c("surucu_w", "S\xFCr\xFCc\xFC (W)", "sayi", "aydinlatma"),
    c("montaj_yukseklik_cm", "Montaj y\xFCksekli\u011Fi (cm)", "sayi", "aydinlatma"),
    c("acikta", "A\xE7\u0131kta", "bool", "aydinlatma"),
    c("adim", "Ad\u0131m", "enum", "aydinlatma", ADIM),
    c("kim", "Kim (E/B/M/K)", "enumliste", "aydinlatma", KIM),
    // Tadilat / usta / kontrol / sahne / kilometre
    c("is_kim", "\u0130\u015Fi yapan", "enumliste", "tadilat", IS_KIM),
    c("planlanan_tarih", "Planlanan tarih", "tarih", "tadilat"),
    c("bitis_tarihi", "Biti\u015F tarihi", "tarih", "tadilat"),
    c("sure_gun", "S\xFCre (g\xFCn)", "sayi", "tadilat"),
    c("bagimlilik", "Ba\u011F\u0131ml\u0131l\u0131k (kodlar)", "liste", "tadilat"),
    c("izin_gerekli", "\u0130zin gerekli", "bool", "tadilat"),
    c("izin_durumu", "\u0130zin durumu", "enum", "tadilat", IZIN_DURUMU),
    c("sartname", "\u015Eartname", "uzunmetin", "tadilat"),
    c("meslek", "Meslek", "enum", "usta", MESLEK),
    c("telefon", "Telefon", "metin", "usta"),
    c("myk_no", "MYK no", "metin", "usta"),
    c("myk_dogrulandi", "MYK do\u011Fruland\u0131", "bool", "usta"),
    c("teklif_tl", "Teklif (TL)", "sayi", "usta"),
    c("teklif_sure_gun", "Teklif s\xFCresi (g\xFCn)", "sayi", "usta"),
    c("garanti_ay", "Garanti (ay)", "sayi", "usta"),
    c("uyum_pct", "\u015Eartname uyumu (%)", "sayi", "usta"),
    c("kontrol_tur", "Kontrol t\xFCr\xFC", "enum", "kontrol", KONTROL_TUR),
    c("olcum_deger", "\xD6l\xE7\xFCm de\u011Feri", "sayi", "kontrol"),
    c("olcum_birim", "\xD6l\xE7\xFCm birimi", "metin", "kontrol"),
    c("esik", "E\u015Fik", "metin", "kontrol"),
    c("tamam", "Tamam", "bool", "kontrol"),
    c("tetik", "Tetik", "enum", "sahne", TETIK),
    c("seviyeler", "Seviyeler (katman:pct:cct)", "liste", "sahne"),
    c("senaryo", "Senaryo", "enum", "kilometre", SENARYO),
    c("kilometre_tur", "Kilometre ta\u015F\u0131 t\xFCr\xFC", "enum", "kilometre", KILOMETRE_TUR),
    // Yerleşim
    c("en_cm", "En (cm)", "sayi", "yerlesim"),
    c("boy_cm", "Boy (cm)", "sayi", "yerlesim"),
    c("yuk_cm", "Y\xFCkseklik (cm)", "sayi", "yerlesim"),
    c("duvar", "Duvar", "enum", "yerlesim", DUVAR),
    c("x_cm", "X (cm)", "sayi", "yerlesim"),
    c("y_cm", "Y (cm)", "sayi", "yerlesim"),
    c("donus", "D\xF6n\xFC\u015F", "sayi", "yerlesim"),
    c("priz_ihtiyaci", "Priz ihtiyac\u0131", "sayi", "yerlesim"),
    c("isik_ihtiyaci", "I\u015F\u0131k ihtiyac\u0131", "metin", "yerlesim"),
    c("kanal_m", "Kanal (m)", "sayi", "yerlesim"),
    // Meta
    c("created_at", "Olu\u015Fturma", "tarihsaat", "meta"),
    c("updated_at", "G\xFCncelleme", "tarihsaat", "meta"),
    c("deleted_at", "Silinme", "tarihsaat", "meta"),
    c("updated_by", "G\xFCncelleyen", "metin", "meta"),
    c("version", "S\xFCr\xFCm", "sayi", "meta"),
    c("son_op_id", "Son i\u015Flem", "metin", "meta"),
    c("son_degisen_alanlar", "Son de\u011Fi\u015Fen alanlar", "liste", "meta")
  ];
  var SETTING_COLUMNS = [
    c("id", "Kimlik", "metin", "kimlik"),
    c("tip", "Tip", "enum", "kimlik", ["oda", "tarih", "liste", "ayar", "kolon"]),
    c("anahtar", "Anahtar", "metin", "kimlik"),
    c("deger", "De\u011Fer", "uzunmetin", "ortak"),
    c("etiket", "Etiket", "metin", "ortak"),
    c("sira", "S\u0131ra", "sayi", "ortak"),
    c("not", "Not", "uzunmetin", "ortak"),
    c("created_at", "Olu\u015Fturma", "tarihsaat", "meta"),
    c("updated_at", "G\xFCncelleme", "tarihsaat", "meta"),
    c("deleted_at", "Silinme", "tarihsaat", "meta"),
    c("updated_by", "G\xFCncelleyen", "metin", "meta"),
    c("version", "S\xFCr\xFCm", "sayi", "meta"),
    c("son_op_id", "Son i\u015Flem", "metin", "meta"),
    c("son_degisen_alanlar", "Son de\u011Fi\u015Fen alanlar", "liste", "meta")
  ];
  var CASH_COLUMNS = [
    c("id", "Kimlik", "metin", "kimlik"),
    c("tarih", "Tarih", "tarih", "ortak"),
    c("tutar", "Tutar (TL)", "sayi", "ortak"),
    c("kalem", "B\xFCt\xE7e kalemi", "metin", "ortak"),
    c("not", "Not", "metin", "ortak"),
    c("kalem_id", "Ba\u011Fl\u0131 sat\u0131nalma", "metin", "ortak"),
    c("created_at", "Olu\u015Fturma", "tarihsaat", "meta"),
    c("updated_at", "G\xFCncelleme", "tarihsaat", "meta"),
    c("deleted_at", "Silinme", "tarihsaat", "meta"),
    c("updated_by", "G\xFCncelleyen", "metin", "meta"),
    c("version", "S\xFCr\xFCm", "sayi", "meta"),
    c("son_op_id", "Son i\u015Flem", "metin", "meta"),
    c("son_degisen_alanlar", "Son de\u011Fi\u015Fen alanlar", "liste", "meta")
  ];
  var ITEM_HEADERS = ITEM_COLUMNS.map((x) => x.key);
  var CASH_HEADERS = CASH_COLUMNS.map((x) => x.key);
  var SETTING_HEADERS = SETTING_COLUMNS.map((x) => x.key);
  var META_KEYS = ["created_at", "updated_at", "deleted_at", "updated_by", "version", "son_op_id", "son_degisen_alanlar"];
  var REQUIRED_ITEM_HEADERS = ["id", "tip", "ad", "updated_at", "version"];
  var REQUIRED_SETTING_HEADERS = ["id", "tip", "anahtar", "deger", "updated_at", "version"];
  var REQUIRED_CASH_HEADERS = ["id", "tarih", "tutar", "kalem", "updated_at", "version"];
  function columnByKey(columns) {
    return new Map(columns.map((col) => [col.key, col]));
  }
  var ITEM_COLUMN_MAP = columnByKey(ITEM_COLUMNS);
  var SETTING_COLUMN_MAP = columnByKey(SETTING_COLUMNS);
  var CASH_COLUMN_MAP = columnByKey(CASH_COLUMNS);

  // shared/convert.ts
  var pad2 = (n) => n < 10 ? `0${n}` : String(n);
  function formatDateLocal(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function parseNumberTr(raw) {
    const s = raw.replace(/\s+/g, "");
    if (s === "" || s === "-") return void 0;
    if (!/^-?[\d.,]+$/.test(s)) return void 0;
    let norm;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
      norm = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      norm = s.replace(/\./g, "").replace(",", ".");
    } else {
      norm = s;
    }
    const n = Number(norm);
    return Number.isFinite(n) ? n : void 0;
  }
  function cellToValue(type, cell) {
    if (cell === null || cell === void 0) return void 0;
    switch (type) {
      case "sayi": {
        if (typeof cell === "number") return Number.isFinite(cell) ? cell : void 0;
        if (typeof cell === "boolean") return cell ? 1 : 0;
        if (cell instanceof Date) return void 0;
        return parseNumberTr(String(cell));
      }
      case "bool": {
        if (typeof cell === "boolean") return cell;
        const s = String(cell).trim().toLowerCase();
        if (s === "") return void 0;
        if (["true", "1", "evet", "x", "do\u011Fru"].includes(s)) return true;
        if (["false", "0", "hay\u0131r", "hayir", "yanl\u0131\u015F"].includes(s)) return false;
        return void 0;
      }
      case "liste":
      case "enumliste": {
        if (Array.isArray(cell)) return cell.map(String).map((x) => x.trim()).filter(Boolean);
        const s = String(cell);
        const parts = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        return parts.length ? parts : void 0;
      }
      case "tarih": {
        if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? void 0 : formatDateLocal(cell);
        const s = String(cell).trim();
        if (s === "") return void 0;
        return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
      }
      case "tarihsaat": {
        if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? void 0 : cell.toISOString();
        const s = String(cell).trim();
        return s === "" ? void 0 : s;
      }
      case "enum":
      case "metin":
      case "uzunmetin":
      default: {
        if (cell instanceof Date) return cell.toISOString();
        const s = String(cell);
        return s.trim() === "" ? void 0 : s;
      }
    }
  }
  function valueToCell(type, value) {
    if (value === null || value === void 0) return "";
    switch (type) {
      case "sayi":
        return typeof value === "number" ? value : parseNumberTr(String(value)) ?? "";
      case "bool":
        return typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
      case "liste":
      case "enumliste":
        return Array.isArray(value) ? value.map(String).join("\n") : String(value);
      default:
        return String(value);
    }
  }
  function headerIndex(headers) {
    const m = /* @__PURE__ */ new Map();
    headers.forEach((h, i) => {
      const k = String(h).trim();
      if (k && !m.has(k)) m.set(k, i);
    });
    return m;
  }
  function missingHeaders(headers, required) {
    const have = new Set(headers.map((h) => String(h).trim()));
    return required.filter((r) => !have.has(r));
  }
  function rowToRecord(columns, headers, row) {
    const defs = new Map(columns.map((col) => [col.key, col]));
    const rec = {};
    headers.forEach((h, i) => {
      const def = defs.get(String(h).trim());
      if (!def) return;
      const v = cellToValue(def.type, row[i]);
      if (v !== void 0) rec[def.key] = v;
    });
    return rec;
  }
  function recordToRow(columns, headers, rec) {
    const defs = new Map(columns.map((col) => [col.key, col]));
    return headers.map((h) => {
      const def = defs.get(String(h).trim());
      if (!def) return "";
      return valueToCell(def.type, rec[def.key]);
    });
  }
  function fnv1a(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
  function fingerprintOf(items, settings, cash, extra = "") {
    const parts = [];
    let maxUpdated = "";
    let sumVersion = 0;
    for (const list of [items, settings, cash ?? []]) {
      for (const r of list) {
        const u = String(r.updated_at ?? "");
        if (u > maxUpdated) maxUpdated = u;
        sumVersion += Number(r.version ?? 0) || 0;
        parts.push(`${String(r.id ?? "")}|${String(r.version ?? "")}|${u}|${String(r.deleted_at ?? "")}`);
      }
    }
    parts.sort();
    if (extra) parts.push(extra);
    const counts = cash ? `${items.length}:${settings.length}:${cash.length}` : `${items.length}:${settings.length}`;
    return `${counts}:${sumVersion}:${maxUpdated}:${fnv1a(parts.join("\n"))}`;
  }

  // shared/ids.ts
  var ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function randomBytes(n) {
    const out = [];
    const g = globalThis.crypto;
    if (g && typeof g.getRandomValues === "function") {
      const buf = new Uint8Array(n);
      g.getRandomValues(buf);
      for (let i = 0; i < n; i++) out.push(buf[i]);
      return out;
    }
    for (let i = 0; i < n; i++) out.push(Math.floor(Math.random() * 256));
    return out;
  }
  var lastTime = 0;
  var lastRandom = [];
  function ulid(now = Date.now()) {
    let time = "";
    let t = now;
    for (let i = 0; i < 10; i++) {
      time = ENC[t % 32] + time;
      t = Math.floor(t / 32);
    }
    let rand;
    if (now === lastTime) {
      rand = lastRandom.slice();
      for (let i = rand.length - 1; i >= 0; i--) {
        if (rand[i] < 31) {
          rand[i]++;
          break;
        }
        rand[i] = 0;
      }
    } else {
      rand = randomBytes(16).map((b) => b % 32);
    }
    lastTime = now;
    lastRandom = rand;
    return time + rand.map((v) => ENC[v]).join("");
  }

  // gas/src/core.ts
  var REQUIRED_ON_INSERT = { kalemler: ["tip", "ad"], ayarlar: ["tip", "anahtar"], nakit: ["tarih", "tutar", "kalem"] };
  var META = new Set(META_KEYS);
  function isBlankRow(row) {
    return row.every((cell) => cell === "" || cell === null || cell === void 0 || cell === false);
  }
  function createTableState(columns, headers, cells, firstSheetRow = 2, now) {
    const st = { columns, headers, rows: [], sheetRows: [], index: /* @__PURE__ */ new Map(), dirty: /* @__PURE__ */ new Set() };
    cells.forEach((row, i) => {
      if (isBlankRow(row)) return;
      const rec = rowToRecord(columns, headers, row);
      const idx = st.rows.length;
      if (!rec.id || typeof rec.id !== "string") {
        rec.id = ulid();
        if (now) {
          rec.created_at = rec.created_at ?? now;
          rec.updated_at = rec.updated_at ?? now;
        }
        rec.version = Number(rec.version ?? 0) || 0;
        st.dirty.add(idx);
      }
      st.rows.push(rec);
      st.sheetRows.push(firstSheetRow + i);
      st.index.set(String(rec.id), idx);
    });
    return st;
  }
  function validateEnums(columns, patch) {
    for (const col of columns) {
      if (!col.enum) continue;
      const v = patch[col.key];
      if (v === void 0 || v === null || v === "") continue;
      const allowed = [...col.enum];
      if (col.type === "enumliste") {
        const arr = Array.isArray(v) ? v : String(v).split(/\r?\n/);
        if (arr.some((x) => x !== "" && !allowed.includes(String(x)))) return { field: col.key, allowed };
      } else if (!allowed.includes(String(v))) {
        return { field: col.key, allowed };
      }
    }
    return null;
  }
  function cleanPatch(patch) {
    const out = {};
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (k === "id" || META.has(k)) continue;
      out[k] = v;
    }
    return out;
  }
  function pick(rec, keys) {
    const out = {};
    for (const k of keys) if (rec[k] !== void 0) out[k] = rec[k];
    return out;
  }
  function err(id, code, message) {
    return { ok: false, id, error: code, message };
  }
  function applyUpsert(table, tableName, op, actor, now) {
    const patch = cleanPatch(op.patch);
    const invalid = validateEnums(table.columns, patch);
    if (invalid) return { ...err(op.id, "invalid_enum", `Ge\xE7ersiz de\u011Fer: ${invalid.field}`), message: `${invalid.field}: izinli de\u011Ferler ${invalid.allowed.join(", ")}` };
    const keys = Object.keys(patch);
    const idx = table.index.get(op.id);
    if (idx === void 0) {
      const need = REQUIRED_ON_INSERT[tableName];
      const missing = need.filter((k) => patch[k] === void 0 || patch[k] === "");
      if (missing.length) return err(op.id, "bad_request", `Yeni kay\u0131t i\xE7in zorunlu: ${missing.join(", ")}`);
      const rec = { id: op.id };
      for (const k of keys) if (patch[k] !== null) rec[k] = patch[k];
      rec.created_at = now;
      rec.updated_at = now;
      rec.updated_by = actor;
      rec.version = 1;
      rec.son_op_id = op.opId;
      rec.son_degisen_alanlar = keys;
      const newIdx = table.rows.length;
      table.rows.push(rec);
      table.sheetRows.push(0);
      table.index.set(op.id, newIdx);
      table.dirty.add(newIdx);
      return { ok: true, id: op.id, row: rec };
    }
    const row = table.rows[idx];
    if (row.son_op_id === op.opId) return { ok: true, id: op.id, row, duplicate: true };
    const currentVersion = Number(row.version ?? 0) || 0;
    let conflictKeys = [];
    if (op.baseVersion !== void 0 && op.baseVersion < currentVersion) {
      const last = Array.isArray(row.son_degisen_alanlar) ? row.son_degisen_alanlar : [];
      conflictKeys = keys.filter((k) => last.includes(k));
    }
    const applied = keys.filter((k) => !conflictKeys.includes(k));
    const result = { ok: true, id: op.id, row };
    if (conflictKeys.length) {
      result.conflict = {
        keys: conflictKeys,
        serverValues: pick(row, conflictKeys),
        serverVersion: currentVersion,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
      };
    }
    if (applied.length) {
      for (const k of applied) {
        if (patch[k] === null || patch[k] === "") delete row[k];
        else row[k] = patch[k];
      }
      row.updated_at = now;
      row.updated_by = actor;
      row.version = currentVersion + 1;
      row.son_op_id = op.opId;
      row.son_degisen_alanlar = applied;
      table.dirty.add(idx);
    }
    return result;
  }
  function applyBatch(state, req, now) {
    const results = [];
    let doneCount = 0;
    let ok = true;
    const actor = (req.actor || "bilinmeyen").toString().slice(0, 60);
    for (const op of req.ops ?? []) {
      const tableName = op.table;
      const table = state[tableName];
      if (!table) {
        results.push(err(op.id, "bad_request", `Bilinmeyen tablo: ${String(tableName)}`));
        ok = false;
        break;
      }
      let r;
      if (op.op === "upsert") {
        r = applyUpsert(table, tableName, op, actor, now);
      } else if (op.op === "delete" || op.op === "restore") {
        const idx = table.index.get(op.id);
        if (idx === void 0) r = err(op.id, "not_found", "Kay\u0131t bulunamad\u0131 (Sheets'te silinmi\u015F olabilir)");
        else {
          const row = table.rows[idx];
          if (row.son_op_id === op.opId) r = { ok: true, id: op.id, row, duplicate: true };
          else {
            if (op.op === "delete") row.deleted_at = now;
            else delete row.deleted_at;
            row.updated_at = now;
            row.updated_by = actor;
            row.version = (Number(row.version ?? 0) || 0) + 1;
            row.son_op_id = op.opId;
            row.son_degisen_alanlar = ["deleted_at"];
            table.dirty.add(idx);
            r = { ok: true, id: op.id, row };
          }
        }
      } else {
        r = err(op.id ?? "", "bad_request", "Bilinmeyen i\u015Flem");
      }
      results.push(r);
      if (!r.ok) {
        ok = false;
        break;
      }
      doneCount++;
    }
    const fp = stateFingerprint(state);
    const last = results[results.length - 1];
    return { ok, results, doneCount, fingerprint: fp, serverTime: now, error: ok ? void 0 : last?.error, message: ok ? void 0 : last?.message };
  }
  function stateFingerprint(state) {
    return fingerprintOf(state.kalemler.rows, state.ayarlar.rows, state.nakit?.rows, state.plan ? JSON.stringify(state.plan) : "");
  }
  function readState(state, fingerprint, now) {
    const fp = stateFingerprint(state);
    if (fingerprint && fingerprint === fp) return { ok: true, notModified: true, fingerprint: fp, serverTime: now, schemaVersion: SCHEMA_VERSION };
    return {
      ok: true,
      fingerprint: fp,
      serverTime: now,
      schemaVersion: SCHEMA_VERSION,
      items: state.kalemler.rows,
      settings: state.ayarlar.rows,
      ...state.nakit ? { cash: state.nakit.rows } : {},
      ...state.plan ? { plan: state.plan } : {}
    };
  }
  function dirtyRows(table) {
    const out = [];
    for (const idx of [...table.dirty].sort((a, b) => a - b)) {
      out.push({ sheetRow: table.sheetRows[idx], cells: recordToRow(table.columns, table.headers, table.rows[idx]) });
    }
    return out;
  }
  var LABEL_COL = 1;
  var FIRST_MONTH_COL = 2;
  var MONTH_HEADER = /^OCA/i;
  function num(cell) {
    if (typeof cell === "number") return Number.isFinite(cell) ? cell : 0;
    if (typeof cell === "string") {
      const n = parseFloat(cell.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
  function parsePlan(values, year) {
    const plan = { year, groups: [] };
    const layout = [];
    let group = null;
    for (let r = 0; r < values.length; r++) {
      const row = values[r] ?? [];
      const label = String(row[LABEL_COL] ?? "").trim();
      const head = String(row[FIRST_MONTH_COL] ?? "").trim();
      if (MONTH_HEADER.test(head)) {
        if (!label) {
          if (plan.groups.length) break;
          continue;
        }
        group = { name: label, rows: [] };
        plan.groups.push(group);
        continue;
      }
      if (!group || !label) continue;
      if (/^TOPLAM/i.test(label)) {
        group = null;
        continue;
      }
      const months = [];
      for (let m = 0; m < 12; m++) months.push(num(row[FIRST_MONTH_COL + m]));
      group.rows.push({ label, plan: months });
      layout.push({ label, group: group.name, sheetRow: r + 1 });
    }
    return { plan, layout };
  }
  var colLetter = (i) => {
    let n = i + 1;
    let out = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      out = String.fromCharCode(65 + m) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  function actualFormula(opts) {
    const { cashSheet, cashHeaders, planSheet, panoYearCell, sheetRow, month } = opts;
    const col = (key) => {
      const i = cashHeaders.indexOf(key);
      if (i < 0) throw new Error(`app_nakit s\xFCtunu yok: ${key}`);
      const L = colLetter(i);
      return `'${cashSheet}'!$${L}$2:$${L}`;
    };
    const cell = colLetter(FIRST_MONTH_COL + month - 1);
    const crit = `${col("kalem")},TRIM($B${sheetRow}),${col("tarih")},${panoYearCell}&"-${String(month).padStart(2, "0")}*",${col("deleted_at")},""`;
    return `=LET(n,COUNTIFS(${crit}),a,SUMIFS(${col("tutar")},${crit}),p,'${planSheet}'!${cell}${sheetRow},IF(n=0,p,IF(DATE(${panoYearCell},${month}+1,1)<=TODAY(),a,MAX(a,p))))`;
  }
  function planCopyFormula(planSheet, sheetRow, month) {
    return `='${planSheet}'!${colLetter(FIRST_MONTH_COL + month - 1)}${sheetRow}`;
  }

  // gas/src/main.ts
  var TABLES = [
    { key: "kalemler", name: SHEETS.items, columns: ITEM_COLUMNS, required: REQUIRED_ITEM_HEADERS },
    { key: "ayarlar", name: SHEETS.settings, columns: SETTING_COLUMNS, required: REQUIRED_SETTING_HEADERS },
    { key: "nakit", name: SHEETS.cash, columns: CASH_COLUMNS, required: REQUIRED_CASH_HEADERS, optional: true }
  ];
  var MAX_BODY = 512 * 1024;
  function json(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  }
  function fail(error, message, extra = {}) {
    return { ok: false, error, message, ...extra };
  }
  function nowIso() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  function loadState(ss) {
    const out = {};
    for (const t of TABLES) {
      const sheet = ss.getSheetByName(t.name);
      if (!sheet && t.optional) continue;
      if (!sheet) return fail("schema", `Sekme yok: ${t.name} (setup \xE7al\u0131\u015Ft\u0131r\u0131n)`, { missing: [t.name] });
      const values = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [[]];
      const headers = (values[0] ?? []).map((h) => String(h).trim());
      const missing = missingHeaders(headers, t.required);
      if (missing.length) return fail("schema", `Eksik s\xFCtun: ${missing.join(", ")}`, { missing });
      out[t.key] = createTableState(t.columns, headers, values.slice(1), 2, nowIso());
    }
    const plan = loadPlan(ss);
    if (plan) out.plan = plan.plan;
    return out;
  }
  function planYear(ss) {
    const pano = ss.getSheetByName(BUDGET_SHEETS.pano);
    const y = pano ? Number(pano.getRange("C2").getValue()) : NaN;
    return Number.isFinite(y) && y > 2e3 ? y : void 0;
  }
  function loadPlan(ss) {
    try {
      const sheet = ss.getSheetByName(BUDGET_SHEETS.plan);
      if (!sheet || sheet.getLastRow() < 2) return void 0;
      const values = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), 200), 14).getValues();
      return parsePlan(values, planYear(ss));
    } catch (_e) {
      return void 0;
    }
  }
  function wireActual(mode) {
    const ss = SpreadsheetApp.getActive();
    const actual = ss.getSheetByName(BUDGET_SHEETS.actual);
    const cash = ss.getSheetByName(SHEETS.cash);
    const parsed = loadPlan(ss);
    if (!actual || !parsed) throw new Error(`${BUDGET_SHEETS.actual} ya da ${BUDGET_SHEETS.plan} okunamad\u0131`);
    if (mode === "wire" && !cash) throw new Error(`${SHEETS.cash} yok (\xF6nce setup)`);
    const cashHeaders = cash ? cash.getRange(1, 1, 1, cash.getLastColumn()).getValues()[0].map((h) => String(h).trim()) : [];
    const labels = actual.getRange(1, 2, actual.getLastRow(), 1).getValues().map((r) => String(r[0]).trim());
    let written = 0;
    const skipped = [];
    for (const row of parsed.layout) {
      if (labels[row.sheetRow - 1] !== row.label) {
        skipped.push(`${row.sheetRow}:${row.label}`);
        continue;
      }
      const formulas = [];
      for (let m = 1; m <= 12; m++) {
        formulas.push(mode === "wire" ? actualFormula({ cashSheet: SHEETS.cash, cashHeaders, planSheet: BUDGET_SHEETS.plan, panoYearCell: `'${BUDGET_SHEETS.pano}'!$C$2`, sheetRow: row.sheetRow, month: m }) : planCopyFormula(BUDGET_SHEETS.plan, row.sheetRow, m));
      }
      actual.getRange(row.sheetRow, 3, 1, 12).setFormulas([formulas]);
      written++;
    }
    SpreadsheetApp.flush();
    return `${mode}: ${written} sat\u0131r${skipped.length ? `; e\u015Fle\u015Fmeyen: ${skipped.join(", ")}` : ""}`;
  }
  function flushState(ss, state) {
    for (const t of TABLES) {
      const table = state[t.key];
      if (!table?.dirty.size) continue;
      const sheet = ss.getSheetByName(t.name);
      const width = table.headers.length;
      const appended = [];
      for (const { sheetRow, cells } of dirtyRows(table)) {
        if (sheetRow > 0) sheet.getRange(sheetRow, 1, 1, width).setValues([cells]);
        else appended.push(cells);
      }
      if (appended.length) sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, width).setValues(appended);
    }
    SpreadsheetApp.flush();
  }
  function checkKey(key) {
    const expected = PropertiesService.getScriptProperties().getProperty("APP_KEY");
    if (!expected) return true;
    return typeof key === "string" && key === expected;
  }
  function handle(req) {
    const ss = SpreadsheetApp.getActive();
    if (req.action === "health") return healthCheck();
    if (req.action === "read") {
      if (!checkKey(req.key)) return fail("unauthorized");
      const st = loadState(ss);
      if ("ok" in st && st.ok === false) return st;
      return readState(st, req.fingerprint, nowIso());
    }
    if (req.action === "batch") {
      if (!checkKey(req.key)) return fail("unauthorized");
      if (!Array.isArray(req.ops) || req.ops.length === 0) return fail("bad_request", "ops bo\u015F");
      if (req.ops.length > 200) return fail("bad_request", "Tek istekte en fazla 200 i\u015Flem");
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(2e4)) return fail("busy", "Tablo me\u015Fgul, yeniden deneyin", { retryAfterMs: 3e3 });
      try {
        const st = loadState(ss);
        if ("ok" in st && st.ok === false) return st;
        const res = applyBatch(st, req, nowIso());
        flushState(ss, st);
        return res;
      } finally {
        lock.releaseLock();
      }
    }
    return fail("bad_request", "Bilinmeyen action");
  }
  function doPost(e) {
    try {
      const raw = e?.postData?.contents ?? "";
      if (raw.length > MAX_BODY) return json(fail("bad_request", "G\xF6vde \xE7ok b\xFCy\xFCk"));
      let req;
      try {
        req = JSON.parse(raw);
      } catch {
        return json(fail("bad_request", "JSON \xE7\xF6z\xFClemedi"));
      }
      return json(handle(req));
    } catch (error) {
      return json(fail("internal", String(error?.message ?? error)));
    }
  }
  function doGet(e) {
    const action = e?.parameter?.action ?? "health";
    if (action === "health") return json(healthCheck());
    if (action === "setup") {
      try {
        return json({ ok: true, app: "aile", message: setup(), health: healthCheck() });
      } catch (error) {
        return json(fail("internal", String(error?.message ?? error)));
      }
    }
    if (action === "wire" || action === "unwire") {
      if (!checkKey(e?.parameter?.key)) return json(fail("unauthorized"));
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(2e4)) return json(fail("busy", "Tablo me\u015Fgul, yeniden deneyin", { retryAfterMs: 3e3 }));
      try {
        return json({ ok: true, app: "aile", message: wireActual(action) });
      } catch (error) {
        return json(fail("internal", String(error?.message ?? error)));
      } finally {
        lock.releaseLock();
      }
    }
    return json(fail("bad_request", "GET yaln\u0131z health/setup/wire/unwire i\xE7in"));
  }
  function healthCheck() {
    const ss = SpreadsheetApp.getActive();
    const warnings = [];
    const triggers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
    if (!triggers.includes("onEditInstallable")) warnings.push("onEditInstallable tetikleyicisi yok (setup \xE7al\u0131\u015Ft\u0131r\u0131n)");
    for (const t of TABLES) if (!ss.getSheetByName(t.name)) warnings.push(`${t.optional ? "\u0130ste\u011Fe ba\u011Fl\u0131 sekme yok" : "Sekme yok"}: ${t.name}`);
    const tz = ss.getSpreadsheetTimeZone();
    if (tz !== "Europe/Istanbul") warnings.push(`Tablo saat dilimi ${tz}; Europe/Istanbul bekleniyor`);
    let fingerprint;
    if (!warnings.some((w) => w.startsWith("Sekme yok"))) {
      const st = loadState(ss);
      if (!("error" in st)) {
        const r = readState(st, void 0, nowIso());
        fingerprint = r.fingerprint;
      }
    }
    return { ok: true, app: "aile", schemaVersion: SCHEMA_VERSION, serverTime: nowIso(), fingerprint, triggers, warnings };
  }
  function ensureSheet(ss, name, columns) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const keys = columns.map((c2) => c2.key);
    const lastCol = sheet.getLastColumn();
    const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim()) : [];
    if (existing.filter(Boolean).length === 0) {
      sheet.getRange(1, 1, 1, keys.length).setValues([keys]);
    } else {
      const missing = keys.filter((k) => !existing.includes(k));
      if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    }
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
    const idx = headerIndex(headers);
    const maxRows = Math.max(sheet.getMaxRows(), 1e3);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3eee6");
    for (const col of columns) {
      const i = idx.get(col.key);
      if (i === void 0) continue;
      const colRange = sheet.getRange(2, i + 1, maxRows - 1, 1);
      const header = sheet.getRange(1, i + 1);
      header.setNote(`${col.label} (${col.type}${col.enum ? ": " + col.enum.join(" | ") : ""})`);
      if (col.type === "tarih" || col.type === "tarihsaat" || col.type === "metin" || col.type === "uzunmetin" || col.type === "liste" || col.type === "enumliste") {
        colRange.setNumberFormat("@");
      } else if (col.type === "sayi") {
        colRange.setNumberFormat("#,##0.##");
      }
      if (col.enum && col.type === "enum") {
        const rule = SpreadsheetApp.newDataValidation().requireValueInList([...col.enum], true).setAllowInvalid(true).build();
        colRange.setDataValidation(rule);
      } else if (col.type === "bool") {
        const rule = SpreadsheetApp.newDataValidation().requireCheckbox().setAllowInvalid(true).build();
        colRange.setDataValidation(rule);
      }
      sheet.setColumnWidth(i + 1, col.key === "ad" || col.key === "not" || col.key === "deger" ? 240 : 110);
    }
    const groups = /* @__PURE__ */ new Map();
    columns.forEach((col) => {
      const i = idx.get(col.key);
      if (i === void 0) return;
      if (["kimlik", "ortak"].includes(col.group)) return;
      const arr = groups.get(col.group) ?? [];
      arr.push(i + 1);
      groups.set(col.group, arr);
    });
    try {
      sheet.getRange(1, 1, 1, headers.length).shiftColumnGroupDepth(0);
      for (const cols of groups.values()) {
        const start = Math.min(...cols);
        const count = Math.max(...cols) - start + 1;
        if (sheet.getColumnGroupDepth(start) === 0) sheet.getRange(1, start, 1, count).shiftColumnGroupDepth(1);
      }
      sheet.collapseAllColumnGroups();
    } catch (_e) {
    }
    const protection = sheet.getRange(1, 1, 1, headers.length).protect();
    protection.setDescription("aile: ba\u015Fl\u0131k sat\u0131r\u0131 (uygulama bu adlar\u0131 kullan\u0131r)");
    protection.setWarningOnly(true);
    return sheet;
  }
  function setup() {
    const ss = SpreadsheetApp.getActive();
    for (const t of TABLES) ensureSheet(ss, t.name, t.columns);
    const triggers = ScriptApp.getProjectTriggers();
    if (!triggers.some((t) => t.getHandlerFunction() === "onEditInstallable")) {
      ScriptApp.newTrigger("onEditInstallable").forSpreadsheet(ss).onEdit().create();
    }
    const msg = `setup tamam: ${TABLES.map((t) => t.name).join(", ")}; tetikleyici: onEditInstallable; tz=${ss.getSpreadsheetTimeZone()}`;
    console.log(msg);
    return msg;
  }
  function onEditInstallable(e) {
    const range = e?.range;
    if (!range) return;
    const sheet = range.getSheet();
    const t = TABLES.find((x) => x.name === sheet.getName());
    if (!t) return;
    const rowStart = range.getRow();
    if (rowStart === 1) return;
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
    const colStart = range.getColumn();
    const colEnd = colStart + range.getNumColumns() - 1;
    const editedKeys = headers.slice(colStart - 1, colEnd).filter(Boolean);
    const meta = new Set(META_KEYS);
    if (editedKeys.length && editedKeys.every((k) => meta.has(k))) return;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1e4)) return;
    try {
      const now = nowIso();
      const user = (() => {
        try {
          return e.user?.getEmail?.() || Session.getActiveUser().getEmail() || "sheets";
        } catch {
          return "sheets";
        }
      })();
      const rowEnd = rowStart + range.getNumRows() - 1;
      const values = sheet.getRange(rowStart, 1, rowEnd - rowStart + 1, lastCol).getValues();
      const out = values.map((cells) => {
        const rec = rowToRecord(t.columns, headers, cells);
        const blank = cells.every((c2) => c2 === "" || c2 === null);
        if (blank) return cells;
        if (!rec.id) {
          rec.id = ulid();
          rec.created_at = now;
        }
        rec.updated_at = now;
        rec.updated_by = user;
        rec.version = (Number(rec.version ?? 0) || 0) + 1;
        rec.son_op_id = `sheet:${now}`;
        rec.son_degisen_alanlar = editedKeys.filter((k) => !meta.has(k));
        return recordToRow(t.columns, headers, rec);
      });
      sheet.getRange(rowStart, 1, out.length, lastCol).setValues(out);
    } finally {
      lock.releaseLock();
    }
  }
  return __toCommonJS(main_exports);
})();
function doGet(e) { return __aile.doGet(e); }
function doPost(e) { return __aile.doPost(e); }
function setup() { return __aile.setup(); }
function onEditInstallable(e) { return __aile.onEditInstallable(e); }
function health() { return JSON.stringify(__aile.healthCheck()); }
