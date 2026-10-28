import { Route, Switch, Redirect } from 'wouter';
import { PurchaseList } from './modules/purchase';
import { SettingsPage } from './modules/settings/SettingsPage';
import { LightingModule } from './modules/lighting';
import { RenovationModule } from './modules/renovation';
import { LayoutModule } from './modules/layout';
import { BudgetModule } from './modules/budget';

export const MODULES = [
  { key: 'satinalma', path: '/satinalma', label: 'Satınalma' },
  { key: 'aydinlatma', path: '/aydinlatma', label: 'Aydınlatma' },
  { key: 'tadilat', path: '/tadilat', label: 'Tadilat' },
  { key: 'yerlesim', path: '/yerlesim', label: 'Yerleşim' },
  { key: 'butce', path: '/butce', label: 'Bütçe' },
] as const;

export function AppRoutes() {
  return (
    <Switch>
      <Route path="/satinalma" nest>
        <PurchaseList />
      </Route>
      <Route path="/aydinlatma" nest>
        <LightingModule />
      </Route>
      <Route path="/tadilat" nest>
        <RenovationModule />
      </Route>
      <Route path="/yerlesim" nest>
        <LayoutModule />
      </Route>
      <Route path="/butce" nest>
        <BudgetModule />
      </Route>
      <Route path="/ayarlar">
        <SettingsPage />
      </Route>
      <Route>
        <Redirect to="/satinalma" replace />
      </Route>
    </Switch>
  );
}
