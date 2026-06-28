import { PageHeader } from "@/components/ui";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { AddressBook } from "@/components/AddressBook";
import { requireUserId } from "@/lib/auth/user";
import { getProfile, listAddresses } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const uid = await requireUserId("/account");
  const profile = await getProfile(uid);
  const addresses = await listAddresses(uid);
  return (
    <>
      <PageHeader eyebrow="Account" title="Account" description="Manage your sign-in details." />
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Change password</h2>
      <p className="mb-4 max-w-md text-sm text-muted">
        Enter your current password, then choose a new one.
      </p>
      <ChangePasswordForm email={profile?.email ?? ""} />

      <h2 className="mb-3 mt-10 text-lg font-semibold tracking-tight text-ink">Address book</h2>
      <p className="mb-4 max-w-md text-sm text-muted">
        Saved customer &amp; ship-to details. Pick one at checkout to fill the form instantly.
      </p>
      <AddressBook initial={addresses} />
    </>
  );
}
