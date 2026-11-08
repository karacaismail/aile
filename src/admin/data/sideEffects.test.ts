import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Kaynak kuralı (p-fix m7): vite.config.ts yönetim veri katmanını (src/admin/data/*.ts ve *.tsx) toptan yan etkisiz
// sayar (treeshake.moduleSideEffects, ADMIN_PURE_MODULE). rolldown barrel üzerinden içe aktaran parçaya yalnız gerçekten
// kullanılan modülleri koyar; bu yüzden içe aktarılmakla bir şey yapan (genel kayıt, global değişiklik, ağ isteği) üst düzey
// deyim sessizce düşebilir. Kural: veri modüllerinin üst düzeyi yalnız import/export ve bildirimlerden oluşur (sabit,
// şema, sınıf, işlev, tür, modül içi durum). Tek izinli istisna store.ts'in sözleşme ön yüklemesidir (geliştirme ya da
// açık nesil adresinde contract.ts'i açılışta ister; depo kullanılmıyorsa gerekmez, düşmesi doğrudur).

const DATA_DIR = resolve(__dirname);
const ROOT = resolve(__dirname, '../../..');

/** Üst düzeyde izin verilen deyim türleri: içe/dışa aktarım ve bildirim. Gerisi (ifade, if, döngü, blok, try …) yan etkidir. */
const DECLARATION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.EmptyStatement,
]);

/** İzin listesi: dosya → deyimin (boşluk sadeleştirilmiş) metni. Yalnız store.ts'in sözleşme ön yüklemesi. */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'store.ts': ['if (!(defaultGenerationSource() instanceof UnselectedGenerationSource)) loadContract().catch(() => {});'],
};

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Kaynağın üst düzey yan etkili deyimleri: `satır: Tür metin`. */
function topLevelEffects(fileName: string, source: string): { line: number; kind: string; text: string }[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return file.statements
    .filter(statement => !DECLARATION_KINDS.has(statement.kind))
    .map(statement => ({
      line: file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1,
      kind: ts.SyntaxKind[statement.kind],
      text: squash(statement.getText(file)),
    }));
}

const dataModules = readdirSync(DATA_DIR)
  .filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .sort();

describe('src/admin/data üst düzey yan etki kuralı', () => {
  it('kural kör değil: ifade, atama, if ve döngü deyimi yakalanır; bildirimler geçer', () => {
    const effects = topLevelEffects('ornek.ts', [
      "import { a } from './a';",
      'export const sabit = 1;',
      'const durum = new Map<string, number>();',
      'export function islev() { return durum; }',
      'export class Sinif {}',
      'export type Tur = string;',
      'interface Arayuz { x: number }',
      "export { a } from './a';",
      'kaydet();',
      'window.aile = 1;',
      'if (a) yukle();',
      'for (const x of [1]) yukle(x);',
      'await yukle();',
    ].join('\n'));
    expect(effects.map(effect => `${effect.line} ${effect.kind}`)).toEqual([
      '9 ExpressionStatement', '10 ExpressionStatement', '11 IfStatement', '12 ForOfStatement', '13 ExpressionStatement',
    ]);
  });

  it('veri modüllerinin üst düzeyi yalnız içe/dışa aktarım ve bildirimdir (izin: store.ts sözleşme ön yüklemesi)', () => {
    expect(dataModules).toEqual(expect.arrayContaining(['store.ts', 'useGeneration.provider.tsx', 'types.ts']));
    const violations: string[] = [];
    const used = new Set<string>();
    for (const name of dataModules) {
      for (const effect of topLevelEffects(name, readFileSync(join(DATA_DIR, name), 'utf8'))) {
        if (ALLOWED[name]?.includes(effect.text)) used.add(`${name}:${effect.text}`);
        else violations.push(`${name}:${effect.line} ${effect.kind}: ${effect.text.slice(0, 120)}`);
      }
    }
    expect(violations).toEqual([]);
    // İzin listesi daralabilir: girdisi artık kaynakta yoksa bu test onu silmeyi ister.
    expect([...used].sort()).toEqual(Object.entries(ALLOWED).flatMap(([name, texts]) => texts.map(text => `${name}:${text}`)).sort());
  });

  it('vite.config.ts ADMIN_PURE_MODULE yorumu ve regex kapsamı aynı: data/*.ts ve *.tsx, alt klasör ve başka katman değil', () => {
    const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    const match = /((?:\/\/[^\n]*\n)+)const ADMIN_PURE_MODULE = \/(.+)\/;\n/.exec(config);
    expect(match, 'ADMIN_PURE_MODULE tanımı ve üstündeki yorum').not.toBeNull();
    const [, comment = '', body = ''] = match!;
    const pattern = new RegExp(body);
    for (const name of dataModules) expect(pattern.test(join(ROOT, 'src/admin/data', name)), name).toBe(true);
    expect(pattern.test(join(ROOT, 'src/admin/data/alt/x.ts'))).toBe(false);
    expect(pattern.test(join(ROOT, 'src/admin/ui/icons.tsx'))).toBe(false);
    expect(pattern.test(join(ROOT, 'src/admin/data/store.css'))).toBe(false);
    // Yorum kapsamı regex ile aynı söyler ve tek istisnayı adıyla anar.
    expect(comment).toMatch(/src\/admin\/data\/\*\.ts ve \*\.tsx/);
    expect(comment).toMatch(/store\.ts/);
    expect(comment).toMatch(/src\/admin\/data\/sideEffects\.test\.ts/);
    expect(comment).not.toMatch(/global değişiklik yoktur/);
  });
});
