import { redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/masuk");
  return (
    <AppShell wallet={user.wallet} name={user.name}>
      {children}
    </AppShell>
  );
}
