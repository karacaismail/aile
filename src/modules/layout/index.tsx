import { Route, Switch } from 'wouter';
import { RoomList } from './RoomList';
import { RoomPage } from './RoomPage';

/** Yerleşim modülü: /yerlesim (oda kartları) ve /yerlesim/:oda (duvar bazlı liste + ihtiyaç haritası; kalem formu /:oda/:id). */
export function LayoutModule() {
  return (
    <Switch>
      <Route path="/:oda" nest>{(params) => <RoomPage key={params.oda} oda={params.oda} />}</Route>
      <Route><RoomList /></Route>
    </Switch>
  );
}
