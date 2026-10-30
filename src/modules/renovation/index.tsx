import { Box } from '@mantine/core';
import { Route, Switch } from 'wouter';
import { CalendarScreen } from './CalendarScreen';
import { TasksScreen } from './TasksScreen';
import { VendorsScreen } from './VendorsScreen';
import { ChecklistScreen } from './ChecklistScreen';
/** Tadilat sayfaları ortak site menüsünden açılır; senaryo ve filtreler kendi ekranlarında kalır. */
export function RenovationModule() {
  return (
    <Box data-testid="renovation">
      <Switch>
        <Route path="/isler" nest><TasksScreen /></Route>
        <Route path="/ustalar" nest><VendorsScreen /></Route>
        <Route path="/kontrol"><ChecklistScreen /></Route>
        <Route><CalendarScreen /></Route>
      </Switch>
    </Box>
  );
}
