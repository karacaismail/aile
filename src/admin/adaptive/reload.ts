/** Sürüm kayması kurtarması: sayfayı yeniden yükler (yeni index.html → yeni parça adları). Testler bu modülü mock'lar. */
export function reloadPage(): void {
  window.location.reload();
}
