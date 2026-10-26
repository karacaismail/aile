import { useMemo } from 'react';
import { Box, Button, EmptyState, Skeleton, Stack } from '@mantine/core';
import { HammerIcon, PlusIcon } from '@phosphor-icons/react';
import { Route, useLocation } from 'wouter';
import type { Item } from '@shared/schema';
import { useAppStore, type AppState } from '@/sync/store';
import { Fab } from '@/app/shell/Fab';
import { sortTasks } from './rules';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';

const selectTasks = (s: AppState): Item[] => s.items.filter((i) => !i.deleted_at && i.tip === 'tadilat');
const selectMeta = (s: AppState) => ({ hydrated: s.hydrated, status: s.status });

/** İşler: kod sırasıyla kartlar, Fab → yeni, /:id detay modalı. */
export function TasksScreen() {
  const tasks = useAppStore(selectTasks);
  const { hydrated, status } = useAppStore(selectMeta);
  const [, navigate] = useLocation();
  const list = useMemo(() => sortTasks(tasks), [tasks]);
  return (
    <Box pb={96}>
      <Stack gap="xs" p="sm" data-testid="task-list">
        {!hydrated && status !== 'unconfigured' ? (
          <><Skeleton h={88} radius="md" /><Skeleton h={88} radius="md" /><Skeleton h={88} radius="md" /></>
        ) : list.length === 0 ? (
          <EmptyState icon={<HammerIcon size={40} aria-hidden />} title="Henüz iş yok" description="Tadilat işlerini kod sırasıyla (T1, T2…) ekleyin." data-testid="empty-state">
            <EmptyState.Actions>
              <Button leftSection={<PlusIcon size={18} aria-hidden />} onClick={() => navigate('~/tadilat/isler/yeni')}>İş ekle</Button>
            </EmptyState.Actions>
          </EmptyState>
        ) : list.map((t) => <TaskCard key={t.id} task={t} tasks={tasks} />)}
      </Stack>
      <Fab onClick={() => navigate('~/tadilat/isler/yeni')} label="İş ekle" />
      <Route path="/:id">{(params) => <TaskDetail key={params.id} id={params.id} />}</Route>
    </Box>
  );
}
