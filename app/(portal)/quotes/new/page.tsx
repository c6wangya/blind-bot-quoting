import { BackLink, PageHeader } from "@/components/ui";
import { NewQuoteFlow } from "@/components/NewQuoteFlow";
import { requireUserId } from "@/lib/auth/user";

export default async function NewQuotePage() {
  await requireUserId("/quotes/new");
  return (
    <div>
      <BackLink href="/quotes">All quotes</BackLink>
      <PageHeader
        eyebrow="Quoting"
        title="New quote"
        description="Capture the customer, ship-to and references — the details that drive the order. Add products next."
      />
      <NewQuoteFlow />
    </div>
  );
}
