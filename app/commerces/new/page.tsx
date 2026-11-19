import BusinessForm from "@/components/BusinessForm";
import { requireSession } from "@/lib/session";
export default async function New() {
  await requireSession("redirect");
  return (<><h1>Nouveau commerce</h1><BusinessForm /></>);
}
