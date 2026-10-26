import { Box, Paper, SegmentedControl } from '@mantine/core';
import { Route, Switch, useLocation } from 'wouter';
import { CalendarScreen } from './CalendarScreen';
import { TasksScreen } from './TasksScreen';
import { VendorsScreen } from './VendorsScreen';
import { ChecklistScreen } from './ChecklistScreen';
import classes from './renovation.module.css';

const TABS = [
  { value: 'takvim', label: 'Takvim' },
  { value: 'isler', label: 'İşler' },
  { value: 'ustalar', label: 'Ustalar' },
  { value: 'kontrol', label: 'Kontrol' },
] as const;

/** Tadilat modülü: /tadilat altında Takvim | İşler | Ustalar | Kontrol (iç rotalar göreli). */
export function RenovationModule() {
  const [location, navigate] = useLocation();
  const seg = location.split('/')[1] ?? '';
  const tab = TABS.some((t) => t.value === seg) ? seg : 'takvim';
  return (
    <Box data-testid="renovation">
      <Paper className={classes.tabs} px="sm" py={4} radius={0}>
        <SegmentedControl
          fullWidth size="sm" value={tab} onChange={(v) => navigate(`~/tadilat/${v}`)} data={[...TABS]} aria-label="Tadilat ekranı"
          styles={{ label: { paddingInline: 4 } }}
        />
      </Paper>
      <Switch>
        <Route path="/isler" nest><TasksScreen /></Route>
        <Route path="/ustalar" nest><VendorsScreen /></Route>
        <Route path="/kontrol"><ChecklistScreen /></Route>
        <Route><CalendarScreen /></Route>
      </Switch>
    </Box>
  );
}
