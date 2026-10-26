import { Route, Switch } from 'wouter';
import { LightingHome } from './LightingHome';
import { RoomPage } from './RoomPage';

/** /aydinlatma (sekmeler) · /aydinlatma/sahne/:id (sahne modalı) · /aydinlatma/:oda(/:id) (oda sayfası + katman modalı) */
export function LightingModule() {
  return (
    <Switch>
      <Route path="/sahne/:id">{(p) => <LightingHome forceTab="sahneler" sceneId={String(p.id)} />}</Route>
      <Route path="/:oda/:id?">{(p) => <RoomPage key={String(p.oda)} oda={String(p.oda)} layerId={p.id ? String(p.id) : undefined} />}</Route>
      <Route><LightingHome /></Route>
    </Switch>
  );
}
