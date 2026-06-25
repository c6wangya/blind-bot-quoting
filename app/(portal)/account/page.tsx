import { PageHeader } from "@/components/ui";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { requireUserId } from "@/lib/auth/user";
import { getProfile } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const uid = await requireUserId("/account");
  const profile = await getProfile(uid);
  return (
    <>
      <PageHeader eyebrow="Account" title="Account" description="Manage your sign-in details." />
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Change password</h2>
      <p className="mb-4 max-w-md text-sm text-muted">
        Enter your current password, then choose a new one.
      </p>
      <ChangePasswordForm email={profile?.email ?? ""} />
    </>
  );
}
