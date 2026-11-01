import { Box, Card, Text } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { useLocation } from 'wouter';
import type { Item, Oda } from '@shared/schema';
import { label } from '@shared/schema';
import { FactList } from '@/components/Info';
import { WarnBadge } from '@/components/badges';
import { cctGradient } from '@/lib/cct';
import { cctRange, completion, coverageText, roomBadges, TASK_CRI_MIN } from './rules';
import classes from './lighting.module.css';

/**
 * A room with layers, in the record grammar: name → one coloured tag (core coverage as a sentence) and plain
 * counts → attention → facts (the room's light colour range, with its swatch next to the text).
 */
export function RoomCard({ oda, layers }: { oda: Oda; layers: Item[] }) {
  const [, navigate] = useLocation();
  const c = completion(layers);
  const range = cctRange(layers);
  const b = roomBadges(layers);
  const coverage = coverageText(layers);
  const name = label('oda', oda);
  const go = () => navigate(`~/aydinlatma/${oda}`);
  return (
    <Card radius="md" p="md" className={`${classes.card} record-card`} data-testid="room-card" data-oda={oda} role="link" tabIndex={0}
      aria-label={`${name} aydınlatma`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
      <div className={classes.identity}>
        <Text component="h3" className="record-title">{name}</Text>
        <CaretRightIcon size={18} aria-hidden />
      </div>
      <div className="record-meta" role="group" aria-label="Kapsam">
        <WarnBadge tone={coverage.complete ? 'ok' : 'warn'}>{coverage.text}</WarnBadge>
        <span className="record-scope">{b.count} katman · {c.done} tanesi tam tanımlı</span>
      </div>
      {b.gorevCri90 && (
        <ul className="record-attention" aria-label="Dikkat">
          <li data-tone="ok"><CheckCircleIcon size={18} aria-hidden />Görev katmanında CRI ≥ {TASK_CRI_MIN}</li>
        </ul>
      )}
      {range && (
        <div className="record-facts">
          <FactList label={`${name} ışık rengi`} items={[{ label: 'Işık rengi', value: <>{range.min === range.max ? range.min : `${range.min}–${range.max}`} K<Box component="span" className={classes.miniStrip} aria-hidden style={{ background: cctGradient(range.min, range.max) }} /></> }]} />
        </div>
      )}
    </Card>
  );
}

/** A room without layers: one compact row with the same link; the group heading says what is missing once. */
export function EmptyRoomRow({ oda }: { oda: Oda }) {
  const [, navigate] = useLocation();
  const name = label('oda', oda);
  const go = () => navigate(`~/aydinlatma/${oda}`);
  return (
    <li>
      <div className={classes.emptyRow} data-testid="room-card" data-oda={oda} role="link" tabIndex={0} aria-label={`${name} aydınlatma`}
        onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
        <span>{name}</span>
        <CaretRightIcon size={18} aria-hidden />
      </div>
    </li>
  );
}
