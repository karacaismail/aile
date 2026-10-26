import { Box, Paper, SegmentedControl } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { useLocation } from 'wouter';
import { Fab } from '@/app/shell/Fab';
import { RoomsTab } from './RoomsTab';
import { ScenesTab } from './ScenesTab';
import { RoadmapTab } from './RoadmapTab';
import { SceneForm } from './SceneForm';
import classes from './lighting.module.css';

export type LightingTab = 'odalar' | 'sahneler' | 'yol';
const TABS: Array<{ value: LightingTab; label: string }> = [
  { value: 'odalar', label: 'Odalar' }, { value: 'sahneler', label: 'Sahneler' }, { value: 'yol', label: 'Yol haritası' },
];

export function LightingHome({ forceTab, sceneId }: { forceTab?: LightingTab; sceneId?: string }) {
  const [, navigate] = useLocation();
  const [tab, setTab] = useLocalStorage<LightingTab>({ key: 'aile:lighting:tab', defaultValue: 'odalar', getInitialValueInEffect: false });
  const current = forceTab ?? tab;
  return (
    <Box pb={96}>
      <Paper className={classes.sticky} px="sm" py={6} radius={0}>
        <SegmentedControl fullWidth size="sm" value={current} data={TABS} aria-label="Aydınlatma bölümü" data-testid="lighting-tabs"
          classNames={{ root: classes.tabs, label: classes.tabsLabel }}
          onChange={(v) => { setTab(v as LightingTab); if (forceTab) navigate('~/aydinlatma'); }} />
      </Paper>
      {current === 'odalar' && <RoomsTab />}
      {current === 'sahneler' && <ScenesTab />}
      {current === 'yol' && <RoadmapTab />}
      {current === 'sahneler' && <Fab onClick={() => navigate('~/aydinlatma/sahne/yeni')} label="Sahne ekle" />}
      {sceneId && <SceneForm key={sceneId} id={sceneId} />}
    </Box>
  );
}
