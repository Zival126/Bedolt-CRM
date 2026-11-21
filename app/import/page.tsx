import ImportWizard from "@/components/ImportWizard";
import ImportBatches from "@/components/ImportBatches";
import { importBatches } from "@/lib/crm";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Import() {
  await requireSession("redirect");
  return (
    <>
      <h1>Import Excel / CSV</h1>
      <ImportWizard />
      <h2>Imports récents</h2>
      <ImportBatches batches={importBatches()} />
    </>
  );
}
