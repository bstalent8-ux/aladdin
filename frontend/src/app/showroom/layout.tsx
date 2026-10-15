import type { ReactNode } from "react";
import { ShowroomFrame } from "@/features/showroom-shell/frame";

export const dynamic = "force-dynamic";

export default function ShowroomLayout({ children }: { children: ReactNode }) {
  return <ShowroomFrame>{children}</ShowroomFrame>;
}
