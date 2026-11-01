import { Badge, Box, Card, Text } from '@mantine/core';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { FactList, type Fact } from '@/components/Info';
import { formatTlRange } from '@/lib/price';
import { cctGradient } from '@/lib/cct';
import { cctRange, DOG_MIN_HEIGHT_CM, driverLoad, layerIssues, layerTitle, TASK_CRI_MIN, type Issue, type RoomSetting } from './rules';
import { layerIcon } from './layerIcons';
import classes from './lighting.module.css';

function rangeText(min?: number, max?: number): string {
  if (min != null && max != null) return min === max ? `${min}` : `${min}–${max}`;
  return `${min ?? max}`;
}

/** One sentence per rule, naming the record's own value; the form shows the full rule text. */
function issueText(issue: Issue, layer: Item, needW?: number): string {
  switch (issue.field) {
    case 'montaj_yukseklik_cm': return `Köpek kuralı: açıkta montaj ${layer.montaj_yukseklik_cm} cm, en az ${DOG_MIN_HEIGHT_CM} cm olmalı`;
    case 'cri_min': return layer.cri_min == null ? `CRI belirtilmedi (görevde en az ${TASK_CRI_MIN} önerilir)` : `Görev katmanında CRI ${layer.cri_min}, en az ${TASK_CRI_MIN} olmalı`;
    case 'surucu_w': return `Sürücü yetersiz: en az ${needW} W gerekir, sürücü ${layer.surucu_w} W`;
    case 'uzunluk_m': return `İki uçtan besleme gerekir (${layer.uzunluk_m} m şerit)`;
    case 'cct_max': return 'CCT aralığı ters: alt değer üst değerden büyük';
    default: return issue.message;
  }
}

/**
 * A layer in the record grammar: identity → one coloured tag (layer type) with plain control, features, step,
 * installers and linked products → attention (icon + sentence) → facts (light, colour, quality, product, cost).
 */
export function LayerCard({ layer, room, linkedCount = 0 }: { layer: Item; room?: RoomSetting | null; linkedCount?: number }) {
  const [, navigate] = useLocation();
  const Icon = layerIcon(layer.katman_tur);
  const title = layerTitle(layer);
  const issues = layerIssues(layer, room);
  const drv = driverLoad(layer);
  const cct = cctRange([layer]);
  const go = () => navigate(`~/aydinlatma/${layer.oda}/${layer.id}`);
  const hasLux = layer.lux_min != null || layer.lux_max != null;
  const scope = [
    layer.kontrol_cihaz ? label('kontrol_cihaz', layer.kontrol_cihaz) : null,
    layer.flicker ? label('flicker', layer.flicker) : null,
    layer.adim ? `Adım: ${label('adim', layer.adim)}` : null,
    layer.kim?.length ? `Kurulum: ${layer.kim.map((k) => label('kim', k)).join(', ')}` : null,
    linkedCount > 0 ? `${linkedCount} ürün bağlı` : null,
  ].filter((x): x is string => !!x);
  const attention = [
    ...issues.errors.map((e) => ({ key: `e-${e.field}`, tone: 'danger', text: issueText(e, layer, drv?.needW) })),
    ...issues.warnings.map((w) => ({ key: `w-${w.field}`, tone: 'warn', text: issueText(w, layer) })),
    ...(drv && drv.ok === true && drv.marginPct != null ? [{ key: 'driver-ok', tone: 'ok', text: `Sürücü payı %${drv.marginPct}` }] : []),
  ];
  const facts: Fact[] = [
    ...(hasLux ? [{ label: 'Aydınlık düzeyi', value: `${rangeText(layer.lux_min, layer.lux_max)} lux${layer.lux_duzlem ? ` · ${label('lux_duzlem', layer.lux_duzlem).toLocaleLowerCase('tr')} düzlem` : ''}` }] : []),
    ...(cct ? [{ label: 'Işık rengi', value: <>{layer.cct_mod ? `${label('cct_mod', layer.cct_mod)} · ` : ''}{rangeText(cct.min, cct.max)} K<Box component="span" className={classes.miniStrip} aria-hidden style={{ background: cctGradient(cct.min, cct.max) }} /></> }] : []),
    ...(layer.cri_min != null || layer.r9_min != null ? [{ label: 'Renk doğruluğu', value: [layer.cri_min != null ? `CRI ${layer.cri_min}` : null, layer.r9_min != null ? `R9 ${layer.r9_min}` : null].filter(Boolean).join(' · ') }] : []),
    ...(layer.urun_sinifi ? [{ label: 'Ürün sınıfı', value: layer.urun_sinifi }] : []),
    ...(drv && drv.surucuW == null ? [{ label: 'Güç ihtiyacı', value: `Şerit yükü ${drv.loadW} W · sürücü en az ${drv.needW} W` }] : []),
    ...(layer.tahmini_tl_min != null || layer.tahmini_tl_max != null ? [{ label: 'Tahmini bedel', value: formatTlRange(layer.tahmini_tl_min, layer.tahmini_tl_max), detail: 'Ödeme kaydı değildir.' }] : []),
  ];
  return (
    <Card radius="md" p="md" className={`${classes.card} record-card`} data-testid="layer-card" data-layer-id={layer.id} data-tur={layer.katman_tur} role="link" tabIndex={0}
      aria-label={`${title} katmanı`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
      <div className={classes.identity}>
        <Box className={classes.iconBox} aria-hidden><Icon size={24} /></Box>
        <div className={classes.grow}>
          <Text component="h3" className="record-title">{title}</Text>
          {layer.amac && <Text className={classes.purpose}>{layer.amac}</Text>}
        </div>
      </div>
      {(layer.katman_tur || scope.length > 0) && (
        <div className="record-meta" role="group" aria-label="Tür ve kapsam">
          {layer.katman_tur && <Badge size="xs" variant="filled" color="blue.9">{label('katman_tur', layer.katman_tur)}</Badge>}
          {scope.map((part) => <span key={part} className="record-scope">{part}</span>)}
        </div>
      )}
      {attention.length > 0 && (
        <ul className="record-attention" aria-label="Dikkat">
          {attention.map((a) => (
            <li key={a.key} data-tone={a.tone}>
              {a.tone === 'ok' ? <CheckCircleIcon size={18} aria-hidden /> : a.tone === 'danger' ? <WarningIcon size={18} aria-hidden /> : <InfoIcon size={18} aria-hidden />}
              {a.text}
            </li>
          ))}
        </ul>
      )}
      {facts.length > 0 && (
        <div className="record-facts">
          <FactList label={`${title} ışık özellikleri ve bedeli`} items={facts} />
        </div>
      )}
    </Card>
  );
}
