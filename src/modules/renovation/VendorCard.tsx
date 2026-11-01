import { useId } from 'react';
import { ActionIcon, Anchor, Card, Group, Text } from '@mantine/core';
import { PhoneIcon } from '@phosphor-icons/react/dist/csr/Phone';
import { SealCheckIcon } from '@phosphor-icons/react/dist/csr/SealCheck';
import { SealWarningIcon } from '@phosphor-icons/react/dist/csr/SealWarning';
import { WhatsappLogoIcon } from '@phosphor-icons/react/dist/csr/WhatsappLogo';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { FactList, SourceNote } from '@/components/Info';
import { formatTl } from '@/lib/price';
import { normalizePhone, whatsappHref } from './rules';
import classes from './renovation.module.css';

/** `uyum_pct`: ustanın şartnameye uyumu (formdaki "Şartname uyumu (%)"), 0–100. APG meter: görünür etiket + değer metni. */
function SpecFitMeter({ value }: { value: number }) {
  const id = useId();
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className={classes.score}>
      <div className={classes.scoreHead}>
        <span id={id}>Şartname uyumu</span>
        <span aria-hidden className="tabular">%{value}</span>
      </div>
      <div role="meter" aria-labelledby={id} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`%${value}`} className={classes.meter}>
        <div className={classes.meterFill} style={{ inlineSize: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Kayıt dili: kimlik → meslek düz metin → MYK dikkat metni → teklif bilgileri → şartname uyumu → iletişim. */
export function VendorCard({ vendor }: { vendor: Item }) {
  const [, navigate] = useLocation();
  const wa = whatsappHref(vendor.telefon);
  const tel = normalizePhone(vendor.telefon);
  const go = () => navigate(`~/tadilat/ustalar/${vendor.id}`);
  return (
    <Card radius="md" p="md" className={classes.card} data-testid="vendor-card" data-vendor-id={vendor.id}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <div className={`${classes.linkArea} record-card`} role="link" tabIndex={0} aria-label={`${vendor.ad} detayı`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
          <h3 className={`record-title ${classes.title}`}>{vendor.ad}</h3>
          {vendor.meslek && <div className="record-meta"><span className="record-scope">{label('meslek', vendor.meslek)}</span></div>}
          <ul className="record-attention" aria-label={`${vendor.ad} yetkinlik`}>
            {vendor.myk_dogrulandi
              ? <li data-tone="ok"><SealCheckIcon size={18} aria-hidden />MYK doğrulandı</li>
              : <li data-tone="warn"><SealWarningIcon size={18} aria-hidden />MYK doğrulanmadı</li>}
          </ul>
        </div>
        {wa && (
          <ActionIcon component="a" href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp: ${vendor.ad}`} color="teal" variant="light" style={{ flexShrink: 0 }}>
            <WhatsappLogoIcon size={26} aria-hidden />
          </ActionIcon>
        )}
      </Group>
      <div className="record-facts">
        <FactList label={`${vendor.ad} teklif bilgileri`} items={[
          { label: 'Teklif bedeli', value: vendor.teklif_tl != null ? formatTl(vendor.teklif_tl) : 'Teklif girilmedi', emphasis: vendor.teklif_tl != null },
          ...(vendor.teklif_sure_gun != null ? [{ label: 'İş süresi', value: `${vendor.teklif_sure_gun} gün` }] : []),
          ...(vendor.garanti_ay != null ? [{ label: 'Garanti', value: `${vendor.garanti_ay} ay garanti` }] : []),
        ]} />
      </div>
      {vendor.uyum_pct != null && <SpecFitMeter value={vendor.uyum_pct} />}
      <div className={classes.contact}>
        {tel ? (
          <Anchor href={`tel:+${tel}`} size="sm" className={classes.telLink}>
            <PhoneIcon size={18} aria-hidden />
            {vendor.telefon}
          </Anchor>
        ) : <Text size="sm" c="dimmed" style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>Telefon yok</Text>}
      </div>
      <SourceNote label="">Teklif, yapılmış ödeme değildir.</SourceNote>
    </Card>
  );
}
