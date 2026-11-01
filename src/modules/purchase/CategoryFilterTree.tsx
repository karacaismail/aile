import { useId, useState } from 'react';
import { Checkbox, Collapse, UnstyledButton } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { PURCHASE_CATEGORY_TREE, categoryCount, categorySelection, categoryValues, toggleCategorySelection, type PurchaseCategoryNode } from '@shared/purchaseCategories';
import { facetLabel } from '@/components/filter/FacetChips';
import { tokens } from '@/dashboard/tokens';
import classes from './CategoryFilterTree.module.css';

export interface CategoryExpansion { expanded: Readonly<Record<string, boolean>>; onExpand: (key: string, open: boolean) => void }
interface Props { counts: ReadonlyMap<string, number>; value: string[]; onChange: (value: string[]) => void; expansion?: CategoryExpansion }

function CategoryNode({ node, counts, value, onChange, expansion }: Props & { node: PurchaseCategoryNode; expansion: CategoryExpansion }) {
  const selected = categorySelection(value, node.value);
  const [initiallyOpen] = useState(selected !== 'none');
  const open = expansion.expanded[node.value] ?? initiallyOpen;
  const setOpen = (next: boolean) => expansion.onExpand(node.value, next);
  const id = useId();
  const reduced = useReducedMotion();
  const count = categoryCount(counts, node.value);
  return <li className={classes.node}>
    <div className={classes.row} data-selected={selected !== 'none' || undefined}>
      <Checkbox classNames={{ root: classes.checkbox, label: classes.label }} checked={selected === 'all'} indeterminate={selected === 'mixed'}
        disabled={count === 0 && selected === 'none'} data-filter-key={`category:${node.value}`} data-testid={`facet-kategori-${node.value}`}
        onChange={() => { onChange(toggleCategorySelection(value, node.value)); if (node.children) setOpen(true); }}
        label={<><span>{node.label}</span>{' '}<span className={classes.count}>{count}</span></>} />
      {node.children && <UnstyledButton className={classes.expand} aria-label={`${node.label} alt kategorileri`} aria-expanded={open} aria-controls={id}
        data-filter-key={`expand:${node.value}`} onClick={() => setOpen(!open)}><span aria-hidden>{open ? '−' : '+'}</span></UnstyledButton>}
    </div>
    {node.children && <Collapse id={id} expanded={open} inert={!open} aria-hidden={!open} transitionDuration={reduced ? 0 : tokens.duration} transitionTimingFunction={tokens.ease} animateOpacity={false}>
      <ul className={classes.children}>{node.children.map(child => <CategoryNode key={child.value} node={child} counts={counts} value={value} onChange={onChange} expansion={expansion} />)}</ul>
    </Collapse>}
  </li>;
}

/** Native checkboxes plus independent disclosure buttons, not an ARIA tree with invented keyboard behavior. */
export function CategoryFilterTree({ counts, value, onChange, expansion: controlled }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const expansion = controlled ?? { expanded, onExpand: (key: string, open: boolean) => setExpanded(previous => ({ ...previous, [key]: open })) };
  const unknown = [...new Set([...counts.keys(), ...value])].filter(key => categoryValues(key).length === 0);
  return <ul className={classes.tree}>
    {PURCHASE_CATEGORY_TREE.map(node => <CategoryNode key={node.value} node={node} counts={counts} value={value} onChange={onChange} expansion={expansion} />)}
    {unknown.map(key => <li key={key} className={classes.node}><Checkbox classNames={{ root: classes.checkbox, label: classes.label }} checked={value.includes(key)}
      data-filter-key={`category:${key}`} data-testid={`facet-kategori-${key || 'belirsiz'}`}
      onChange={() => onChange(value.includes(key) ? value.filter(v => v !== key) : [...value, key])}
      label={<><span>{facetLabel('kategori', key)}</span>{' '}<span className={classes.count}>{counts.get(key) ?? 0}</span></>} /></li>)}
  </ul>;
}
