import { useI18n } from '../i18n/context';
import { Workbench } from './Workbench';

/** Default UI root: the workbench in the app's language. */
export function WorkbenchRoot() {
  const { locale } = useI18n();
  return <Workbench locale={locale} />;
}
