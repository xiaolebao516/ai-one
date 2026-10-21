// ai-one v2 UI foundation (#41). Import from here; see README.md in this folder.
export { V2Scope, type V2ScopeProps } from './V2Scope';
export { Button, IconButton, type ButtonProps, type IconButtonProps } from './Button';
export { Card, type CardProps } from './Card';
export { Badge, StatusIndicator, type BadgeProps, type StatusIndicatorProps } from './Badge';
export { SectionHeader, type SectionHeaderProps } from './SectionHeader';
export { Tabs, TabPanel, type TabItem, type TabsProps, type TabPanelProps } from './Tabs';
export { SegmentedControl, type SegmentOption, type SegmentedControlProps } from './SegmentedControl';
export { nextRovingId, segmentDomId, tabDomId, tabPanelDomId } from './roving';
export { Select, type SelectOption, type SelectProps } from './Select';
export { Notice, type NoticeProps } from './Notice';
export { EmptyState, LoadingState, Divider, type EmptyStateProps, type LoadingStateProps, type DividerProps } from './States';
export { Icon, type IconProps } from './Icon';
export { V2_ICON_PATHS, type V2IconName } from './iconPaths';
export { cx } from './cx';
export { resolveV2Mode, useDocumentDarkClass } from './themeMode';
export { getV2Skin, setV2Skin, subscribeV2Skin, useV2Skin } from './skinPreference';
export {
  V2_DEFAULT_SKIN,
  V2_SKINS,
  V2_SKIN_IDS,
  V2_STATUS_TONES,
  isV2SkinId,
  isV2StatusTone,
  toV2StatusTone,
  v2CssVariables,
  type V2Mode,
  type V2ModePreference,
  type V2SkinId,
  type V2StatusTone,
} from './tokens';
export type { V2BadgeTone, V2ButtonVariant, V2CardVariant, V2ControlSize } from './variants';
