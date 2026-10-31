import { Route, Switch, Redirect } from 'wouter';
import { PurchaseList } from './modules/purchase';
import { SettingsPage } from './modules/settings/SettingsPage';
import { LightingModule } from './modules/lighting';
import { RenovationModule } from './modules/renovation';
import { LayoutModule } from './modules/layout';
import { BudgetModule } from './modules/budget';

/** Planner routes only; page labels and navigation live in `app/family/navigation.ts`. */
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
