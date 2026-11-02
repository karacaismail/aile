/**
 * Geçiş bayrağı (tek yer). false: WideProviders (antd ConfigProvider + App + trTR + tema) her profilde bağlıdır;
 * App.tsx onu statik içe aktarır — bugünkü davranış. true: telefon profili antd sağlayıcısı olmadan çalışır;
 * sağlayıcı geniş profilde bağlanır ve sonra yapışkan kalır (telefona dönünce alt ağaç yeniden bağlanmaz).
 * Sahibi entegrasyon görevi: tüm ui görevleri telefon yolundan statik antd'yi çıkarınca çevirir ve App.tsx'te
 * WideProviders'ı wideResource('wide-providers', () => import('./adaptive/WideProviders')) ile tembel yapar
 * (source-rules.test.ts bayrak true iken App.tsx'teki statik WideProviders importunu reddeder).
 */
export const PHONE_WITHOUT_ANTD: boolean = false;
