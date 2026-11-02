// Single raw-import surface for antd and Pro Components. Everything under src/admin outside ui/
// consumes wrappers from '../ui' or re-exports from here. Simgeler Phosphor'dan gelir (./icons);
// @ant-design/icons burada yok. Tarih alanı yok: DatePicker yerine TextField inputMode (tasarım kararı).
export {
  ConfigProvider, theme, Layout, Segmented, Tooltip, Empty, Alert, Skeleton, Typography, Space,
  Collapse, Checkbox, Dropdown, Grid, Popover, List, Statistic, Progress, Switch, Radio, InputNumber,
  Menu as AntMenu, Button as AntButton, Input as AntInput, Select as AntSelect, Table as AntTable,
  Drawer as AntDrawer, Modal as AntModal, Tabs as AntTabs, Tag as AntTag, App as AntApp,
} from 'antd';
export type { ThemeConfig, MenuProps as AntMenuProps, TableProps as AntTableProps, TableColumnsType as AntTableColumnsType } from 'antd';
export { default as trTR } from 'antd/locale/tr_TR';
export {
  ProLayout, PageContainer, ProTable, ProList, ProDescriptions, ProForm, DrawerForm, ModalForm,
} from '@ant-design/pro-components';
export type { ProColumns, ProLayoutProps, ProFormInstance } from '@ant-design/pro-components';
