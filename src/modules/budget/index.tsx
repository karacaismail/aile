import { useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { BudgetHome } from './BudgetHome';
import { openExpense } from './quick';

export { ExpenseHost } from './ExpenseForm';
export { openExpense } from './quick';

/** /butce/yeni: ana ekran kısayolu (PWA) doğrudan hızlı formu açar. */
function NewExpense() {
  const [, navigate] = useLocation();
  useEffect(() => { openExpense(); navigate('~/butce', { replace: true }); }, [navigate]);
  return null;
}

export function BudgetModule() {
  return (
    <Switch>
      <Route path="/yeni"><NewExpense /></Route>
      <Route><BudgetHome /></Route>
    </Switch>
  );
}
