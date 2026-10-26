import { Route, Switch, Redirect } from 'wouter';
import { Center, Text } from '@mantine/core';

function Placeholder({ title }: { title: string }) {
  return (
    <Center h="60vh" data-testid="placeholder">
      <Text c="dimmed">{title} hazırlanıyor</Text>
    </Center>
  );
}

export const MODULES = [
  { key: 'satinalma', path: '/satinalma', label: 'Satınalma' },
  { key: 'aydinlatma', path: '/aydinlatma', label: 'Aydınlatma' },
  { key: 'tadilat', path: '/tadilat', label: 'Tadilat' },
  { key: 'yerlesim', path: '/yerlesim', label: 'Yerleşim' },
] as const;

export function AppRoutes() {
  return (
    <Switch>
      <Route path="/satinalma" nest>
        <Placeholder title="Satınalma" />
      </Route>
      <Route path="/aydinlatma" nest>
        <Placeholder title="Aydınlatma" />
      </Route>
      <Route path="/tadilat" nest>
        <Placeholder title="Tadilat" />
      </Route>
      <Route path="/yerlesim" nest>
        <Placeholder title="Yerleşim" />
      </Route>
      <Route path="/ayarlar">
        <Placeholder title="Ayarlar" />
      </Route>
      <Route>
        <Redirect to="/satinalma" replace />
      </Route>
    </Switch>
  );
}
