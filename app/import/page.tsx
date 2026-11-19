import ImportWizard from "@/components/ImportWizard";
import { requireSession } from "@/lib/session";
export default async function Import() {
  await requireSession("redirect");
  return (<><h1>Import Excel / CSV</h1><ImportWizard /></>);
}
