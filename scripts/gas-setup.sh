#!/usr/bin/env bash
# Apps Script kurulumu (clasp login SONRASI). Kullanım:
#   scripts/gas-setup.sh create   → tabloya bağlı script oluştur + kodu gönder (bir kez)
#   scripts/gas-setup.sh push     → kodu yeniden gönder (her güncellemede)
#   scripts/gas-setup.sh deploy   → web uygulaması dağıt (ilk kez) ya da güncelle (deploymentId varsa)
#   scripts/gas-setup.sh url      → /exec adresini yazdır
set -euo pipefail
cd "$(dirname "$0")/.."
SPREADSHEET_ID="${AILE_SPREADSHEET_ID:-1f7H_wpjConQknpmyZTBQdeYpMG4q1AGQ-y0TIgxZ0kU}"
CLASP="pnpm exec clasp"

case "${1:-}" in
  create)
    $CLASP show-authorized-user >/dev/null 2>&1 || { echo "Önce: pnpm exec clasp login"; exit 1; }
    pnpm gas:build
    if [ -f .clasp.json ]; then echo ".clasp.json zaten var; 'push' kullanın"; exit 1; fi
    $CLASP create-script --parentId "$SPREADSHEET_ID" --title "aile" --rootDir apps-script
    $CLASP push -f
    echo "Şimdi editörde setup'ı bir kez çalıştırıp yetki verin: pnpm exec clasp open-script  (Fonksiyon: setup → Çalıştır)"
    ;;
  push)
    pnpm gas:build && $CLASP push -f
    ;;
  deploy)
    DEP="$(node -e 'try{const j=require("./.clasp.json");process.stdout.write(j.deploymentId||"")}catch{}' )"
    if [ -n "$DEP" ]; then
      $CLASP create-deployment -i "$DEP" -d "aile $(date +%Y-%m-%d)"
    else
      $CLASP create-deployment -d "aile $(date +%Y-%m-%d)"
      echo "Yeni dağıtımın kimliğini .clasp.json içine \"deploymentId\" olarak yazın; sonraki dağıtımlar aynı URL'yi korur."
    fi
    $CLASP list-deployments
    ;;
  url)
    $CLASP list-deployments
    echo "Web uygulaması adresi: https://script.google.com/macros/s/<deploymentId>/exec"
    ;;
  *)
    sed -n '2,7p' "$0"; exit 1;;
esac
