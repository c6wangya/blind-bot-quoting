# Agent engineering standard

This file is the default engineering contract for agents working in this repository. Apply it to
new code and to code touched by the task. Do not perform unrelated, repository-wide rewrites merely
to make old code conform.

## Always enforce these six rules

1. Parse every runtime boundary from `unknown`; a TypeScript cast is not validation.
2. Establish a trusted access context and authorize the exact operation (`read`, `mutate`,
   `administer`, or `act-as`) on every protected resource.
3. Recompute money and workflow decisions on the server; never trust the client with authority.
4. Make privilege explicit: a service-role client, signed capability, or system caller is never an
   ordinary user merely because the static TypeScript type looks the same.
5. Commit coupled workflow state, stock, money, and audit events atomically or provide an explicit,
   idempotent recovery design.
6. Preserve historically authoritative snapshots and deliberately classify every field as
   snapshotted truth, live enrichment, or a documented legacy fallback.

## 1. Start from the problem, not the requested implementation

- Work from first principles: identify the user outcome, business invariant, source of truth, trust
  boundary, failure modes, and acceptance evidence before choosing a pattern or library.
- Do not assume the user has already selected the best implementation. If the goal is clear but the
  proposed path is longer, less safe, or less maintainable, explain the shorter/better path and use
  it when it stays within the task.
- If the business goal is materially ambiguous and a wrong assumption could affect money,
  authorization, persisted data, or workflow state, clarify before implementing. Otherwise state a
  reasonable assumption and proceed.
- Think from the model's perspective: future agents only know what the repository, types, tests, and
  docs make explicit. Encode important domain facts in names, types, module boundaries, database
  constraints, and focused comments rather than relying on tribal knowledge.
- Inspect the current implementation and relevant migrations before designing a change. Preserve
  user changes and existing wire/storage compatibility unless the task explicitly includes a
  migration or breaking change.

## 2. Repository facts and non-negotiable invariants

This is a B2B CRM/ERP-style quoting and pre-order portal for window treatments:
catalog/configuration -> server-side pricing -> quote -> payment -> supplier fulfilment -> invoice,
purchase order, messages, and notifications.

The current structure is intentionally root-based (there is no `src/`):

- `app/`: Next.js App Router pages, layouts, and public HTTP route handlers.
- `components/`: React UI. Client Components are interaction adapters, not trusted business layers.
- `lib/`: domain calculations, shared contracts, auth, integrations, and application helpers.
- `lib/db/`: the Supabase/Postgres data-access layer and persistence mappers.
- `lib/supabase/`: browser, cookie/JWT, service-role, and external-project clients.
- `supabase/migrations/`: schema, constraints, RLS, storage, and transactional database behavior.

`README.md` still contains legacy prototype claims about SQLite and no authentication. For current
architecture, source code, migrations, `package.json`, this file, and `CLAUDE.md` take precedence.
Do not reintroduce the retired SQLite architecture based on that README section.

Preserve these business/security invariants:

1. **The server owns prices and totals.** Never persist a client-supplied price, discount,
   shipping amount, tax, refund, or payment total without authoritative server recomputation and
   authorization.
2. **Retailer access is owner-scoped.** Retailer reads/writes use the cookie/JWT Supabase client so
   RLS applies. The service-role `admin()` client bypasses RLS and is only for explicit privileged
   or system operations with an application-layer authorization/ownership check.
3. **Authentication is not authorization, and read access is not write access.** Every protected
   operation must verify both the trusted caller/capability and whether it grants that exact
   operation on the target resource. Public-demo rows (`owner_id IS NULL`) are readable, not
   retailer-mutable. UI visibility and a generic “can access” result are never mutation controls.
4. **Quotes and orders preserve authoritative history through snapshots.** A quote line snapshots
   its configuration and charged computation, and an order snapshots charged amounts. Some legacy
   invoice/PO display metadata and supplier costs are still enriched from the live catalog. For
   every changed field, explicitly choose snapshotted truth versus live enrichment; when adding a
   snapshot, preserve a documented fallback for legacy rows.
5. **Accessory deletion stays referentially clean.** When adding a table keyed by accessory model
   id, update `deleteModel` in `lib/db/accessory-catalog-admin.ts` to remove its rows or give it a
   deliberate database cascade. Storage objects still require explicit cleanup. Historical
   `quote_items` remain untouched because they are snapshots.
6. **Workflow changes are guarded and auditable.** Order/payment/refund transitions must validate
   the previous state, be race-safe and idempotent where retries are possible, and record the
   corresponding event. State, stock, money, and event changes that form one business operation
   must be atomic. The only exception is a documented, idempotent compensation/recovery design
   when a real transaction is impossible.
7. **Critical invariants exist twice.** Enforce them in domain/application code for useful errors
   and in Postgres constraints, RLS, conditional updates, or transactional functions for integrity.

## 3. Architectural default: functional-first hybrid

Use this split unless the task gives a stronger reason not to:

| Concern | Default style |
| --- | --- |
| Pricing, shipping, discounts, tax, totals, refund math | Pure functions over immutable values |
| Validation and normalization | Pure parsers returning typed results |
| Quote/order/payment/refund workflow decisions | Discriminated unions and pure transition functions |
| Use cases and commands | Small imperative application services/functions |
| Supabase repositories | Explicit ports plus server-only adapters |
| Payment, email, BlindBot, storage, Excel clients | Factory-created objects or selective classes |
| Resource-owning or long-lived components | Selective classes |
| Configuration, permissions, policies | Plain readonly data plus evaluators |
| React UI state | Framework-appropriate functional components/hooks |
| Cross-capability coordination | Typed commands and domain events |

The core rule is:

> Pure functions and immutable data decide what is valid; imperative application code coordinates
> I/O; adapters translate at boundaries; classes are used only when identity, lifecycle, protected
> state, or resource ownership makes them useful.

Do not introduce deep inheritance, mutable Active Record entities, base classes for every concept,
getters/setters around plain data, decorator/reflection machinery, giant `*Service` files, or a DI
container for pure functions. Prefer composition.

### Module ownership

Organize by business capability, incrementally. Do not turn `lib/types.ts`, `lib/db/index.ts`, or a
generic `utils.ts` into dumping grounds.

For a substantial new capability, prefer a shape such as:

```text
lib/<capability>/
  domain/          # readonly domain types, pure decisions, policies
  application/     # commands, ports, orchestration
  infrastructure/  # Supabase/provider adapters when capability-specific
app/...            # HTTP/page adapters
components/...     # UI and client interaction adapters
```

Small additions may stay in the existing `lib/<capability>.ts` and `lib/db/<capability>.ts` pattern.
Extract a higher-level module when it creates a real boundary or removes conceptual coupling, not
merely to add folders. Avoid a big-bang reorganization of existing code.

Dependencies point inward: UI/HTTP and infrastructure may depend on application/domain contracts;
domain code must not import Next.js, React, Supabase, Stripe, environment variables, global clocks,
or other I/O.

## 4. Types are the design; boundaries are the priority

Before implementing a substantial operation, model at least:

1. the command/input,
2. the valid domain state,
3. expected domain errors,
4. emitted domain events or effects, when the operation emits them,
5. the success result,
6. the ports needed by orchestration, when the operation performs I/O.

Prefer types that make invalid states hard to construct:

- discriminated unions instead of boolean combinations or objects full of conditional optionals;
- `readonly` properties and `readonly T[]` for domain inputs/outputs;
- literal unions derived from `as const` data;
- exhaustive switches with a `never` check;
- distinct types for identifiers that are easy to mix up, with validated constructors at the
  boundary when branding is worthwhile;
- `satisfies` to check object conformance without widening useful literals;
- type aliases for unions/value shapes and interfaces for replaceable ports or extensible object
  contracts.

Do not create one universal `Order`, `Quote`, or `User` shape and pass it through every layer. Use
separate contracts when the guarantees differ:

```text
unknown external value
  -> transport parser
  -> trusted user/capability/system context
  -> load the minimum target state
  -> resource authorization policy
  -> application command
  -> domain decision
  -> persistence mapper / outbound DTO
```

Authorization sometimes requires loading the resource; do not pretend a command is authorized
before checking its owner/quote/order relationship. This repository has several legitimate access
modes. Represent them as a discriminated `AccessContext` (or equivalent), not loose booleans:

- a signed-in owner or admin;
- an acting admin with distinct real actor id and effective retailer owner id;
- an anonymous holder of an invoice capability bound to a specific quote;
- a signature-verified provider/webhook event with a provider event id;
- an authenticated cron/system job or signed BlindBot handoff.

The boundary adapter proves one variant from credentials. Domain/application code receives that
trusted variant and still applies an operation-specific policy (`read`, `mutate`, `administer`, or
`act-as`) to the loaded target. A visibility proof must never be reused as a mutation proof. Never
construct authority from a client-supplied role, owner id, `viaToken` flag, or provider name.

Typical type families are:

- `*Request` / `*Response`: public transport DTOs; serializable and minimal.
- `*Command`: already parsed input to a use case.
- domain state/value types: invariant-bearing business values.
- `*Record` / generated `Database` types: persistence representation, including snake_case and
  nullable/JSON columns.
- `*ViewModel`: only the fields a page or Client Component needs.
- repository/client interfaces: capability-based ports, not a mirror of an entire SDK.

Keep a type near the module that owns its meaning. Promote it to a shared module only when multiple
capabilities truly share the same concept and semantics.

### Static types do not validate runtime data

TypeScript disappears at runtime. Treat every value crossing a runtime boundary as `unknown` until
it is parsed:

- `Request.json()`, `FormData`, route params, search params, headers, cookies;
- webhook/provider payloads even after signature verification;
- BlindBot handoff/import data;
- Supabase JSON/JSONB fields and untyped query results;
- environment variables, local/session storage, and `JSON.parse`;
- spreadsheet imports and data from other services.

Do **not** assert trust into existence:

```ts
// Wrong: no runtime evidence supports this type.
const body = (await request.json()) as AdvanceOrderRequest;

// Correct shape: parse unknown, then use the proven value.
const raw: unknown = await request.json();
const parsed = parseAdvanceOrderRequest(raw);
if (!parsed.ok) return badRequest(parsed.error);
const command = parsed.value;
```

A cast is acceptable only after an invariant has been established in the same narrow adapter and
TypeScript cannot express that proof. Avoid `as any`, double assertions (`as unknown as X`), and
open-ended `Record<string, unknown>` escaping the boundary. Never use a type assertion as the only
validation of money, identity, role, status, quantity, JSONB, or provider data.

Use a runtime-schema library only if it pays for itself and has been deliberately adopted. Native
type guards/parsers are sufficient for small boundaries. In either case, keep one canonical parser
and derive or explicitly pair the TypeScript type so runtime and compile-time definitions cannot
quietly drift.

Distinguish **validation** from **sanitization**:

- Transactional commands fail closed with specific errors when invalid. Do not silently clamp or
  coerce money, quantities, roles, statuses, or identifiers unless that behavior is a documented
  business rule.
- Tolerant imports/search/display inputs may intentionally normalize or discard bad optional data,
  as long as the return type and caller make that lossy behavior explicit.

### Persistence is a boundary too

The current Supabase clients are intentionally untyped (`SupabaseClient` without a generated
`Database` generic), and `admin()` and the RLS-scoped user client have the same static TypeScript
type despite radically different authority. Existing `QuoteRow`, `QuoteItemRow`, and `OrderRow`
types are legacy persistence/read projections, not invariant-bearing domain state; for example,
`OrderRow` permits status/nullable-field combinations that should not enter a pure workflow
decision unchanged.

In new or touched adapters, use either deliberately generated `Database` types plus JSON parsers,
or narrow local `*Record` types plus explicit parser/mapper functions. Refine records into a
discriminated domain state before calling a pure decision. Generated Supabase types can prove table
column shapes, but they do not prove JSONB contents,
cross-column invariants, authorization, or valid workflow states. Map database records into domain
types at `lib/db/` or a capability infrastructure adapter. Validate untyped/JSON fields on read and
write. Do not let snake_case rows, provider SDK objects, or nullable persistence records become the
domain model by assertion.

For new ownership-sensitive repository functions, require an explicit Supabase client or explicit
access context rather than silently defaulting to `admin()`. Keep the existing defaulted APIs for
compatibility where necessary, but do not expand the implicit-privilege pattern.

## 5. Domain decisions: pure, explicit, exhaustive

For substantial business operations, use an explicit result/decision shape:

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

type Decision<TState, TEvent, TError> =
  | {
      readonly ok: true;
      readonly state: TState;
      readonly events: readonly TEvent[];
    }
  | { readonly ok: false; readonly error: TError };
```

Domain errors should be discriminated data such as
`{ readonly type: "OrderNotAwaitingPayment" }`, not generic exceptions or message strings. The HTTP
adapter maps them to status codes and stable response DTOs; UI code maps them to presentation text.

A domain decision must not read the database, call a provider, log, read `process.env`, use
`Date.now()`, generate a random reference, or mutate its input. Pass time, exchange rates, pricing
policies, actor context, and generated ids explicitly. Return a new state plus events/effects.

Use exhaustive switches for workflow commands and state variants. Avoid open string maps such as
`Record<string, OrderStatus>` for a closed command set: they conceal invalid keys and weaken
exhaustiveness.

Expected business failures are values. Unexpected infrastructure/programmer failures may throw,
but catch them at a controlled boundary. Catch variables remain `unknown`; normalize them safely,
log diagnostic context server-side, and do not return raw database/provider error messages to the
client.

### Money, dates, and identifiers

- Preserve the repository's existing USD/rounded-number representation when touching an existing
  flow unless the task includes an end-to-end migration. Never partially convert one flow.
- For new financial boundaries, prefer integer minor units or an explicit Money value and centralize
  rounding. Never mix unit price, line total, order total, shipping, cost, and refund amounts just
  because all are `number`.
- Serialized boundaries use deliberate string formats (for example ISO timestamps and date-only
  `YYYY-MM-DD` values). Do not rely on server locale or implicit `Date` serialization.
- Generate random/reference values in orchestration or infrastructure and pass them into pure
  decisions. Use cryptographically appropriate/idempotent provider identifiers where security or
  retries matter.

## 6. Application orchestration: imperative but thin

Application services may be straightforward imperative code. Their job is to:

1. receive parsed input plus a trusted access context;
2. load the minimum state through a port;
3. apply the operation-specific authorization policy and construct the command;
4. call the pure domain decision/policy;
5. map a domain failure without side effects;
6. persist state and events atomically;
7. invoke external effects after commit or through an outbox/idempotent mechanism;
8. return a narrow result DTO.

Prefer functions with an explicit dependency object or a small factory. Use a class only when an
adapter owns a connection/resource, has a meaningful lifecycle or stable identity, protects real
internal state, or groups several cohesive operations. Repositories, provider clients, workflow
runners, and a unit of work are reasonable class candidates. A pure pricing or validation rule is
not.

Ports should express what the use case needs, not expose a broad Supabase/Stripe/Resend client. For
example, prefer `OrderRepository.saveDecision(...)` over passing a generic database client into the
domain.

A guarded conditional update is appropriate for a one-row transition/race. It does **not** make
multiple writes atomic. Multi-row business writes (order state + event, payment + quote conversion,
refund + stock, reservation + order creation) must put every authoritative row and audit/outbox
event in one purpose-built Postgres transaction/RPC. Provider effects cannot share the database
transaction, so use a durable idempotency record/outbox plus retry and reconciliation. “Best effort”
is acceptable only for explicitly non-critical effects such as an email after the authoritative
commit, and the retry/observability behavior must be clear.

Existing helpers such as `markOrderPaid`, refund orchestration, and some order/event updates perform
multiple network writes and are legacy behavior, not proof that copying this pattern is safe. When
a task touches or adds a critical multi-write workflow, close the race/partial-write seam with a
single database transaction/RPC; use idempotent recovery for external effects that cannot join it.

## 7. Next.js, React, and public entry points

<!-- BEGIN:nextjs-agent-rules -->
### This is NOT the Next.js you know

This repository uses Next.js 16.2.9 and React 19. APIs, caching, conventions, and file structure may
differ from training data. Before changing framework behavior, read the relevant guide in
`node_modules/next/dist/docs/` and heed deprecation notices. Page/layout `params`, page
`searchParams`, and Route Handler context `params` are promises; await them. Route Handler URL query
parameters are read synchronously from `request.nextUrl.searchParams` or `new URL(request.url)`.
<!-- END:nextjs-agent-rules -->

- Server Components are the default. Add `"use client"` only at the smallest interaction boundary.
- Treat Client Component code and props as browser-visible. Pass a minimal, serializable view model,
  not a full database/domain record. Never import service-role, secrets, or server DAL modules into
  a client graph.
- Mark every secret/service-key client and secret-bearing integration `server-only`; Next.js handles
  the marker internally. Also use it for ordinary DAL modules where practical so environment
  poisoning becomes a build-time error.
- Route Handlers and Server Actions are public entry points even if only one button calls them.
  Parse input, establish the appropriate trusted user/capability/system context, load the minimum
  target, apply resource authorization, and return a minimal DTO inside every protected path.
- Every endpoint declares one access policy: signed-in owner, admin, acting admin, signed
  capability, provider-authenticated, cron/internal, or intentionally public. “Used only by our UI”
  is not a policy.
- Pages/layouts render and compose. Route handlers translate HTTP. Neither should contain a large
  business state machine or pricing/refund algorithm.
- POST (or another non-GET method) is the default for mutations; render paths never mutate. OAuth or
  payment protocols may require a GET return/callback, but that is a narrow, documented, verified,
  and idempotent exception—not a precedent for ordinary mutation routes. Never put cron secrets in
  query strings.
- Client validation exists for usability only. Repeat authoritative validation and pricing on the
  server.
- Maintain existing API response compatibility when editing a route. For new APIs, prefer a stable
  discriminated success/error response with machine-readable error codes. Do not leak raw
  `Error.message`, SQL details, provider payloads, tokens, or internal records.

## 8. Supabase and security boundaries

- Verify current Supabase documentation/changelog before implementing Supabase-specific behavior;
  do not rely on remembered APIs.
- Use the cookie/JWT client for retailer data so RLS enforces row ownership. Use `admin()` only in
  server-only code and only when the use case explicitly requires bypassing RLS.
- Server identity comes from `auth.getClaims()` or `auth.getUser()`, never from a cookie-loaded
  `getSession().user`. Prefer `getClaims()` for verified JWT identity and `getUser()` when a fresh
  Auth user record is required. App-metadata claims may remain stale until token refresh.
- An acting-as operation must keep the real admin actor and effective retailer owner distinct. The
  authorization decision must not be inferred from a client-supplied owner id.
- Repository/service APIs that can mutate privileged data receive a typed actor/access context and
  an operation-specific authorization decision. Passing an id or route-level boolean is not enough;
  never rely on a service-role default after a read-only/public-demo access check.
- Never expose `SUPABASE_SERVICE_ROLE_KEY`; anything prefixed `NEXT_PUBLIC_` is browser-visible.
- Do not use user-editable `user_metadata` for authorization. Store roles/permissions in protected
  profile data or app metadata and verify them server-side.
- Every migration must deliberately choose Data API exposure and least-privilege object grants for
  `anon`, `authenticated`, and/or `service_role`; RLS and SQL privileges are separate controls.
  Every exposed table needs deliberate RLS/policies. `TO authenticated` alone is not ownership
  authorization. Updates need appropriate SELECT/USING/WITH CHECK behavior. Exposed views use
  `security_invoker` or are revoked/moved to an unexposed schema.
- Treat `SECURITY DEFINER` and service-role code as privileged APIs. Prefer invoker rights. When a
  definer function is unavoidable: revoke `EXECUTE` from `PUBLIC`, `anon`, and unnecessary roles
  before selective grants; authorize inside the function because callers can invoke RPC directly;
  validate every argument including JSONB and quantities; use `search_path = ''` with fully
  qualified objects where possible; and run tests/advisors. Do not copy the broad anonymous grants
  in legacy `0036_atomic_motor_stock.sql` as a security model.
- Schema changes are forward migrations. Never rewrite an applied migration. Inspect local/remote
  migration history and dependent snapshot/deletion behavior first, then use the current Supabase
  CLI (`supabase migration new`) workflow to create the next unique migration rather than inventing
  or reusing a numeric prefix (legacy duplicates already exist). Do not silently mix manual SQL
  history with CLI tracking. Verify local application/reset when available, RLS as `anon` and
  `authenticated`, the migration list, and database advisors. Add constraints for critical status,
  amount, uniqueness, ownership, and idempotency invariants.
- Payment webhooks and browser return/callback routes require provider verification, runtime payload
  parsing, and idempotency. Bind the remote object to the local order and verify expected amount,
  currency, method, provider status, unique provider reference, and allowed prior state before any
  transition. A valid signature or successful provider fetch proves origin/existence, not those
  business invariants.
- Upload/storage adapters authorize before reads, writes, deletes, or signed URLs; deliberately
  choose public versus private buckets and owner/conversation-scoped paths. Enforce size limits and
  inspect actual content where risk warrants it. Browser MIME types and filenames are untrusted;
  treat user-controlled SVG/HTML or other active content specially.

## 9. Abstraction and refactoring rules

Do not be afraid to propose a higher-level abstraction when it creates a clearer business boundary,
makes illegal states unrepresentable, centralizes a repeated policy, or enables atomicity. Name the
problem the abstraction solves.

Do not add abstraction merely because a pattern is fashionable. Avoid speculative generic
frameworks, a repository interface for a one-line local read, an FP/Effect library for ordinary
`Result` handling, or wrapper layers that only rename SDK calls. Start with native TypeScript
unions, readonly objects, functions, generics, and explicit ports. Add a library after repeated
pressure demonstrates its value and the team accepts its debugging/learning cost.

When touching a large legacy route or DB module, improve the seam needed by the task: extract the
parser, command, pure decision, or mapper first. Do not combine a feature/fix with an unrelated
full architecture migration.

## 10. Agent workflow and completion gate

For non-trivial work:

1. Read the root instructions, relevant source, call sites, migrations, and current framework/
   provider docs.
2. State the business goal and invariants. Identify each trust boundary and its owner.
3. Design the command, domain state, errors, events, DTOs, and ports before implementation.
4. Implement/test the pure decision first when the task contains business rules.
5. Add imperative orchestration and narrow adapters around it.
6. Re-check auth, ownership, RLS/service-role use, transactionality, idempotency, snapshots, and
   client data exposure.
7. Verify through the surface that changed.

Minimum practical verification:

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build` when framework boundaries, bundling, routes, or server/client imports changed and
  the required environment is available
- focused tests for every changed calculation, parser, policy, and workflow transition
- migration/database verification for persistence changes, including constraints/RLS and failure
  cases

This repository currently has no configured general unit-test command and does not guarantee a
baseline-clean full lint. Do not claim tests that do not exist or hide a gap behind lint/build
success. Run full checks to detect regressions; when a full check fails outside the diff, also run
the narrowest relevant check for touched TypeScript files and report the baseline failure
separately. For non-trivial domain logic, add focused tests using a real adopted runner when that is
within scope, or clearly report the missing harness. A throwaway script that copies the production
algorithm instead of importing and exercising it is not a test.

Before finishing, review the diff for:

- unchecked runtime casts or `any`;
- a persistence/transport type leaking into the domain;
- missing union cases or expected failures thrown as generic errors;
- mutation inside a domain calculation;
- client-trusted money, roles, owners, status, or identifiers;
- accidental `admin()` use or missing resource authorization;
- multi-step writes without atomicity/race handling;
- a Client Component receiving more data than it needs;
- live catalog lookups that break historical snapshots;
- an abstraction that adds indirection without strengthening a boundary.
