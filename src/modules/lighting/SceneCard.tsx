import { Card, Text } from '@mantine/core';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { label } from '@shared/schema';
import { SourceNote } from '@/components/Info';
import { layerTitle, parseLevel, type SceneLevel } from './rules';
import classes from './lighting.module.css';

/** One line naming the layer with its room (used where rooms are not grouped, e.g. the conflict band). */
export function levelText(lv: SceneLevel, layers: Map<string, Item>): string {
  const l = layers.get(lv.layerId);
  const name = l ? `${label('oda', l.oda)} · ${layerTitle(l)}` : 'Bulunamayan katman';
  return `${name} · ${lv.pct != null ? `%${lv.pct}` : '—'} · ${lv.cct != null ? `${lv.cct} K` : '—'}`;
}

function levelValue(lv: SceneLevel): string {
  return `${lv.pct != null ? `Parlaklık %${lv.pct}` : 'Parlaklık belirtilmedi'} · ${lv.cct != null ? `${lv.cct} K` : 'renk belirtilmedi'}`;
}

const MISSING = 'Bulunamayan katmanlar';

/** Levels grouped by the layer's room in first-appearance order; a missing or deleted layer forms its own named group. */
function groupLevels(levels: readonly SceneLevel[], layers: Map<string, Item>) {
  const groups = new Map<string, { room: string; rows: Array<{ lv: SceneLevel; title: string }> }>();
  for (const lv of levels) {
    const l = layers.get(lv.layerId);
    const room = l ? label('oda', l.oda) || 'Oda belirtilmedi' : MISSING;
    const g = groups.get(room) ?? { room, rows: [] };
    g.rows.push({ lv, title: l ? layerTitle(l) : 'Bulunamayan katman' });
    groups.set(room, g);
  }
  return [...groups.values()];
}

/** A scene: name → plain scope (room, labelled trigger, level count) → levels as facts under their room → note. */
export function SceneCard({ scene, layers }: { scene: Item; layers: Map<string, Item> }) {
  const [, navigate] = useLocation();
  const levels = (scene.seviyeler ?? []).map(parseLevel).filter((x): x is SceneLevel => !!x);
  const go = () => navigate(`~/aydinlatma/sahne/${scene.id}`);
  const scope = [scene.oda ? label('oda', scene.oda) : null, scene.tetik ? `Tetik: ${label('tetik', scene.tetik)}` : 'Tetik belirtilmedi', `${levels.length} katman`].filter((x): x is string => !!x);
  return (
    <Card radius="md" p="md" className={`${classes.card} record-card`} data-testid="scene-card" data-scene-id={scene.id} role="link" tabIndex={0}
      aria-label={`${scene.ad} sahnesi`} onClick={go} onKeyDown={(e) => { if (e.key === 'Enter') go(); }}>
      <div className={classes.identity}>
        <Text component="h3" className="record-title">{scene.ad}</Text>
        <CaretRightIcon size={18} aria-hidden />
      </div>
      <div className="record-meta" role="group" aria-label="Kapsam">
        {scope.map((part) => <span key={part} className="record-scope">{part}</span>)}
      </div>
      {levels.length > 0 && (
        <div className="record-facts">
          {groupLevels(levels, layers).map((g) => (
            <div key={g.room} className="info-facts" data-tone="plain" role="group" aria-label={g.room === MISSING ? 'Bulunamayan katmanların seviyeleri' : `${g.room} seviyeleri`}>
              <Text component="h4" className={classes.levelRoom}>{g.room}</Text>
              <dl>
                {g.rows.map(({ lv, title }, i) => (
                  <div key={`${lv.layerId}-${i}`} data-testid="scene-level"><dt>{title}</dt><dd>{levelValue(lv)}</dd></div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
      {scene.not && <SourceNote label="Sahne notu">{scene.not}</SourceNote>}
    </Card>
  );
}
