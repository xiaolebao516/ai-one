import { useI18n } from '../i18n/context';
import { Workbench } from './Workbench';
import { switchUiRoot } from './workbenchStorage';

/** Default UI root: the workbench in the app's language, with a way to the classic chat UI. */
export function WorkbenchRoot() {
  const { locale } = useI18n();
  return <Workbench locale={locale} onOpenClassic={() => switchUiRoot('classic')} />;
}
