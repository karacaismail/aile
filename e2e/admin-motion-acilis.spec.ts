import { test, expect, type Page } from '@playwright/test';
import { ADMIN_MAIN, openAdmin } from './admin-helpers';

// Hareket sözleşmesi: durum anında güncellenir; geçiş yalnız kullanıcının başlattığı değişikliği canlandırır. Açılan
// gövdeler (akordeon, açılır bölüm, pivot yığını) yüksekliği grid-template-rows 0fr → 1fr geçişiyle açar. Bu geçiş
// varsayılan açık gövdeye ilk çizimde uygulanınca sayfa hazır olduktan sonra kayar ve geçiş sürerken gövdedeki düğmeye
// dokunuş boşa gidebiliyordu (/ev telefon "Odayı aç", WebKit). Burada: kullanıcı girdisinden önce hiçbir gövde
// geçişi başlamaz; kullanıcı bir satırı açınca geçiş başlar.
//
// transitionrun belge düzeyinde, ilk betikten itibaren dinlenir (gecikmeli geçişler de sayılır). Kare sınırı rAF;
// sabit bekleme yok. Seçiciler role/ad ile. Projeler: chromium 320×568 ve webkit 390×844 dokunmatik telefon; @matrix
// ek projelerde. Emülasyon gerçek cihaz değildir.

const MATRIX = { tag: '@matrix' };

type Kayit = { id: string; girdiSonrasi: boolean };

async function geciskaydi(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __gecis: { id: string; girdiSonrasi: boolean }[]; __girdi: boolean };
    w.__gecis = [];
    w.__girdi = false;
    const girdi = () => { w.__girdi = true; };
    for (const tur of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(tur, girdi, true);
    document.addEventListener('transitionrun', (event) => {
      if ((event as TransitionEvent).propertyName !== 'grid-template-rows') return;
      const target = event.target as HTMLElement;
      w.__gecis.push({ id: target.id || target.tagName, girdiSonrasi: w.__girdi });
    }, true);
  });
}

const kayitlar = (page: Page) => page.evaluate(() => (window as unknown as { __gecis: Kayit[] }).__gecis);
const ikiKare = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

for (const rota of ['/ev', '/genel', '/odemeler', '/projeler']) {
  test(`${rota}: varsayılan açık gövde ilk çizimde yerinde; kullanıcı girdisinden önce gövde geçişi yok`, MATRIX, async ({ page }) => {
    await geciskaydi(page);
    await openAdmin(page, rota);
    const profil = await page.locator('html').getAttribute('data-profile');
    test.skip(profil !== 'phone', 'geniş profilde bu sayfalar tablo gösterir; varsayılan açık akordeon telefon sunumundadır');
    const acik = page.locator(ADMIN_MAIN).getByRole('button', { expanded: true }).first();
    await expect(acik).toBeVisible();
    await ikiKare(page);
    expect((await kayitlar(page)).filter(k => !k.girdiSonrasi), 'girdiden önce başlayan gövde geçişleri').toEqual([]);
  });
}

test('/ev: kullanıcı kapalı bir odayı açınca gövde geçişi başlar; açık gövdedeki "Odayı aç" ilk dokunuşta ayrıntıyı açar', MATRIX, async ({ page }) => {
  await geciskaydi(page);
  await openAdmin(page, '/ev');
  const liste = page.getByRole('region', { name: 'Odalar' });
  const tablo = page.getByRole('table', { name: 'Odalar' });
  await expect(liste.or(tablo).first()).toBeVisible();
  test.skip(await tablo.isVisible(), 'geniş profilde oda tablosu; akordeon yalnız telefon sunumunda');

  // İlk dokunuş: varsayılan açık satırın "Odayı aç"ı hemen çalışır (geçiş sürerken boşa gitmez).
  await liste.getByRole('button', { name: 'Odayı aç' }).first().click();
  await expect(page.getByRole('tablist', { name: 'Oda bölümleri' })).toBeVisible();
  await page.getByRole('button', { name: 'Listeye dön' }).click();

  // Kapalı ilk satır, gövde kimliğiyle sabitlenir (rol sorgusu tıklamadan sonra bir sonraki kapalı satıra kayar).
  const panel = await liste.getByRole('button', { expanded: false }).first().getAttribute('aria-controls');
  expect(panel).toBeTruthy();
  const kapali = liste.locator(`button[aria-controls="${panel}"]`);
  await kapali.click();
  await expect(kapali).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await kayitlar(page)).some(k => k.id === panel && k.girdiSonrasi), { message: 'kullanıcının açtığı gövdede geçiş' }).toBe(true);
});
