import { redirect } from "next/navigation";
import { requireShowroomContext } from "@/features/showroom-shell/context";

export default async function ShowroomEntry() {
  await requireShowroomContext();
  redirect("/preview/showroom-suite-v2/home");
}
