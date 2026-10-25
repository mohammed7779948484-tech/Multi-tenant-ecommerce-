# Storefront Buyer Accounts (phone sign-up without email)

**Date**: 2026-10-25
**Status**: Ready for implementation

> Authored with `om-spec-writing --autonomous` under the owner's brief of 2026-10-25. It depends on `.ai/specs/2026-10-25-storefront-shopping-journey.md` (the guest purchase loop) and closes the open owner item P6 (sign-up with no email round-trip) for buyers.

## TLDR

A buyer can create an account in a store with name, Yemeni mobile number and password:

- no email and no verification code;
- signed in immediately;
- the account belongs to that one store (tenant and organization) only.

Signed in, the buyer gets:

- the cart attached to the account;
- saved delivery addresses that checkout fills with one tap;
- an order history with tracking;
- a wishlist;
- in-store notifications when an order's status changes.

Reused from Open Mercato:

- **Identity and sessions:** `customer_accounts` (customer users, customer sessions and JWT cookies, the customer RBAC and default role).
- **Saved addresses:** `customers` (person record and `CustomerAddress`).
- **Order history:** `sales` (orders linked by `customerEntityId`).
- **Buyer notifications:** `notifications` (portal notifications API for customer users).

App-owned:

- the phone login binding;
- the wishlist;
- the buyer UI.

## Problem Statement

The installed buyer identity (`customer_accounts`) signs buyers up by email and refuses login until the email is verified (`api/login.ts` checks `emailVerifiedAt`; `api/signup.ts` sends verification mail).

The owner's rule P6 forbids any email provider, in production too. So today a buyer can only check out as a guest:

- they keep no order history across devices;
- they retype the address every time;
- they get no notifications.

The Safqi reference shows the local expectation: account by phone + name + password, signed in at once, with no OTP (`CUSTOMER-ACCOUNT-FEATURES.md` §2).

## Overview and Success Measures

- **Primary outcome:** a buyer creates an account on a phone in under a minute and places a second order with a saved address in one tap.
- **Leading indicators:** sign-ups per store, share of orders by signed-in buyers, saved addresses per account.
- **Baseline:** 0 buyer accounts (email-only sign-up is unusable under P6).
- **Market / product reference:** Safqi demo (account by phone, no OTP; dashboard with identity, notifications, addresses, orders, sign-out).
  - Adopted: phone sign-up, saved addresses, orders bound to the account, unread notification count.
  - Rejected: points, store credit, referral code (owner-deferred), downloads, web push, self-service account deletion (see Non-goals).

## Goals

- **REQ-A01** — Sign up with name, Yemeni mobile and password (≥ 8 characters), signed in immediately, with no email or code. Sign in with mobile + password. Sign out.
- **REQ-A02** — An account belongs to one store. The same phone in another store is a different, unrelated account; a session for store A is treated as signed out in store B.
- **REQ-A03** — Signing in attaches the device's guest cart to the account, merging lines; a signed-in buyer's cart follows them across devices.
- **REQ-A04** — Saved addresses (same Yemeni address model as checkout): add, edit, delete, set default. Checkout pre-selects the default and saves a new address on request.
- **REQ-A05** — Order history: orders placed while signed in (and guest orders claimed with their access token on that device) are listed, newest first, and each opens the tracking view without the token.
- **REQ-A06** — Wishlist: add or remove a product from its card or page; a wishlist page lists the products that are still public.
- **REQ-A07** — Notifications: when the merchant changes an order's status or payment status, the buyer gets an Arabic in-store notification. The header shows the unread count and a notifications page lists them with mark-all-read.
- **REQ-A08** — Account page: name and phone, change password, links to orders, addresses, wishlist and notifications.

## Non-goals

- SMS or WhatsApp verification, password reset by code, email of any kind (P6). A forgotten password is handled by the merchant in a later dashboard ("reset buyer password"); recorded under **Deferred dashboard work**.
- Loyalty points, store credit, referrals and invite rewards (owner-deferred).
- Self-service account deletion: deferred to a privacy spec, together with data export.
- Web push, PWA, and accounts shared across stores.

## Proposed Solution

1. **Identity: the installed `customer_accounts` user, with a phone binding.**
   - A buyer is a `CustomerUser` in the store's tenant and organization, created through `customerUserService.createUser`. Its required email field holds a system-assigned, non-routable login identifier: `<e164-digits>@phone.invalid`. `.invalid` is reserved by RFC 2606, so no mail can ever be delivered there.
   - The identifier is marked verified at creation (`emailVerifiedAt`), because it is never an address the buyer typed.
   - An app-owned table `storefront_buyer_phones` binds (`tenant_id`, `organization_id`, `phone_hash`) to the user id; the phone itself is encrypted.
   - Sign-in resolves the phone to the user, checks the password with the installed service's hash, applies the installed lockout counters, and creates the session through `customerSessionService.createSession`. It sets the same `customer_auth_token` / `customer_session_token` cookies the installed login sets, so every installed customer API (notifications, profile) works.
2. **Person record.**
   - On sign-up, a `customers` person (`CustomerEntity` kind person, with display name and phone) is created through the customers create command and linked as `CustomerUser.customerEntityId`.
   - Orders placed while signed in set `customerEntityId`, so the merchant sees the buyer as a customer in the CRM and orders group by customer.
3. **Addresses.** `CustomerAddress` rows on that person through the customers address commands:
   - `region` holds the governorate P-code and Arabic name;
   - `city` holds the district;
   - `addressLine1` holds the area/street, `addressLine2` the landmark;
   - `latitude`/`longitude` hold the GPS point;
   - `isPrimary` marks the default.
4. **Cart.** `storefront_carts.customer_user_id` (additive column). On sign-in the guest cart's lines merge into the account cart (same line key → quantities add, capped at 99), and the guest cart is closed.
5. **Wishlist.** App-owned `storefront_wishlist_items` (user, product), unique per pair.
6. **Notifications.**
   - A subscriber on `sales.order.updated` (installed event) compares the order's status and payment status with the last notified values (kept in `storefront_order_access.last_notified_status`).
   - It creates a notification for the order's customer user through the installed notification service, with an Arabic title and body and a link to the tracking page.
   - The header reads the unread count from the installed portal notifications API.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| A-1 `CustomerUser` with a `.invalid` login identifier + phone binding | Reuses sessions, RBAC, notifications and lockout; no parallel auth | App-owned buyer table and session | Duplicates `customer_accounts` (AGENTS rule) |
| A-2 Identifier marked verified at creation | It is system-assigned and never mailed; installed login requires the flag | Patch login | Never edit installed modules |
| A-3 No OTP | Owner rule P6 (no email) and no SMS provider; the reference also has none | SMS OTP | No provider; out of scope; risk recorded |
| A-4 Guest orders are claimed only with the access token on the device | Phone numbers are unverified, so matching by phone would expose other people's orders | Claim by phone | Privacy |
| A-5 Notifications from `sales.order.updated` | Installed event; no polling | Polling the order | Wasteful |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Buyer account | `CustomerUser` in the store's tenant/org with a phone binding | `customer_users`, `storefront_buyer_phones` | — |
| Phone uniqueness | One account per (tenant, organization, E.164 phone) | unique index on `phone_hash` within scope | Sign-up of a taken phone → 409 `storefront.account.errors.phoneTaken` (wording does not confirm more than the form needs) |
| Login identifier | `<digits>@phone.invalid`, never shown to the buyer | `CustomerUser.email` | — |
| Password | ≥ 8 characters, ≤ 128; hashed by the installed service (bcrypt) | `customer_users.password_hash` | 422 |
| Lockout | Installed counters (`failedLoginAttempts`, `lockedUntil`) | `customer_users` | 429/401 generic message |
| Store session | Valid customer JWT whose `tenantId` and `orgId` equal the store's | cookie | Mismatch → treated as signed out |
| Default address | At most one `isPrimary` address per person | `customer_addresses` | Setting a new default clears the old one in one transaction |
| Wishlist item | (user, product) unique; product must be public when shown | `storefront_wishlist_items` | Non-public products are hidden from the list |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Anonymous buyer | Sign up, sign in | Store by slug | none |
| Signed-in buyer | Account, addresses, orders, wishlist, notifications, cart | Own `CustomerUser` within the store's tenant/org; every query filters by user id and scope | customer role default (no portal features needed; routes check the session) |
| Merchant staff | See buyers as customers and their orders | Existing CRM/sales ACL | existing |

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Identity, password, session | Reuse | `customer_accounts` | DI `customerUserService`, `customerSessionService`; cookies | Installed buyer identity |
| Phone binding | App-own | `storefront` | `customer_user_id` | Installed identity has no phone login |
| Person + addresses | Reuse | `customers` | commands `customers.people.create`, address commands; ids | CRM is the source of truth |
| Orders | Reuse | `sales` | `customerEntityId` on create; scoped reads | — |
| Notifications | Reuse | `notifications` | service + portal API | — |
| Wishlist | App-own | `storefront` | product ids | Nothing installed |

## Architecture and Data Flow

```text
Sign-up ─► /api/storefront/shop/{site}/account/signup ─► customerUserService.createUser + customers.people.create
                                                      └► storefront_buyer_phones, customerSessionService.createSession → cookies
Sign-in ─► …/account/login ─► phone binding → password check → session → merge guest cart
Checkout (signed in) ─► addresses from customers; order gets customerEntityId
sales.order.updated ─► storefront subscriber ─► notificationService.create(recipient = customer user)
```

- **Module boundaries:** stays in `storefront`, which owns the store's buyer surfaces.
- **Extension points:** installed DI services, commands, events and APIs only.
- **Compatibility:**
  - The installed email sign-up stays enabled for portals.
  - Buyers created here cannot use email password reset (their identifier is `.invalid`), which is accepted under P6.

## User Journeys

### Journey J-A01 — Sign up and buy again

1. From the header's account button, the buyer picks "إنشاء حساب" (create account) and enters name, mobile and password.
2. They are signed in at once, and the guest cart carries over.
3. At checkout the address form offers "حفظ العنوان" (save address).
4. On the next order the saved default address is pre-selected and delivery priced immediately.
5. Errors: a taken phone shows a message with a link to sign in; a weak password shows a field error.

### Journey J-A02 — Follow orders

1. The account page lists orders newest first, each with its status badge.
2. The merchant confirms an order in the sales admin. Within seconds the buyer's bell shows 1; the notification opens the order.

## UI and Interaction Contracts

Public storefront surfaces with the same shell, theme bridge, shadcn components, states and RTL rules as the shopping-journey spec (decision S-4 there).

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/{site}/account/login`, `/{site}/account/signup` | Sign in, sign up | `POST …/account/login`, `…/signup` | portal login/signup pages (`portal/frontend/[orgSlug]/portal/{login,signup}`) | `Form`, `Input`, `Button`, `Alert`, `Tabs` | submitting, field errors, locked out | REQ-A01, A02 |
| `/{site}/account` | Profile, password change, sign out, links | `GET …/account`, `POST …/account/password`, `POST …/account/logout` | portal profile | `Card`, `Form`, `Button`, `AlertDialog` | loading, error | REQ-A08 |
| `/{site}/account/addresses` | List, add, edit, delete, set default | `…/account/addresses*` | — | `Card`, `Dialog`/`Sheet`, address form (shared with checkout) | empty, conflict | REQ-A04 |
| `/{site}/account/orders` | Order list → tracking | `GET …/account/orders` | portal orders example (`ui/AGENTS.md`) | `Card` list, `Badge`, `Pagination` | empty | REQ-A05 |
| `/{site}/account/wishlist` | Wishlist grid | `…/account/wishlist*` | — | `ProductCard` | empty | REQ-A06 |
| `/{site}/account/notifications` + header bell | List, unread count, mark all read | installed `/api/customer_accounts/portal/notifications*` | `NotificationFeed` pattern | `Popover`, `Badge`, `Button` | empty | REQ-A07 |

## Data Models

### `storefront:buyer_phone` (`storefront_buyer_phones`)

| Field | Type | Scope / index | Sensitive | Notes |
|---|---|---|---|---|
| `id` | uuid | pk | no | |
| `tenant_id`, `organization_id` | uuid | unique (`tenant_id`, `organization_id`, `phone_hash`) | no | |
| `customer_user_id` | uuid | unique | no | installed user id |
| `phone_hash` | text | see above | no | HMAC via the platform hash-for-lookup helper |
| `phone` | text | — | **encrypted** (storefront encryption map) | E.164 |
| `created_at` | timestamptz | — | no | |

### `storefront:wishlist_item` (`storefront_wishlist_items`)

| Field | Type | Scope / index | Notes |
|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | uuid | | |
| `customer_user_id`, `product_id` | uuid | unique pair | |
| `created_at` | timestamptz | | |

### Additive columns

- `storefront_carts.customer_user_id` (uuid, nullable, index).
- `storefront_order_access.customer_user_id` (uuid, nullable), `last_notified_status` (text, nullable), `last_notified_payment_status` (text, nullable).

## API, Command, and Error Contracts

Under `/api/storefront/shop/{siteSlug}/account/…`:

- public routes with per-method metadata and OpenAPI;
- rate-limited (sign-up and login per IP + phone);
- every account route except sign-up and login requires a store session (otherwise 401 JSON; the client shows the sign-in page).

| Method | Path | Input | Success | Errors | Req |
|---|---|---|---|---|---|
| POST | `…/account/signup` | `{ name, phone, password }` | 201 `{ user }` + cookies; `storefront.buyer.signed_up` | 409 phone taken; 422; 429 | A01 |
| POST | `…/account/login` | `{ phone, password }` | 200 + cookies; merges cart | 401 generic; 423 locked; 429 | A01, A03 |
| POST | `…/account/logout` | — | 204, clears cookies | — | A01 |
| GET | `…/account` | — | `{ name, phone }` | 401 | A08 |
| POST | `…/account/password` | `{ current, next }` | 204 | 401/422 | A08 |
| GET/POST | `…/account/addresses` | address | list / 201 | 401/422 | A04 |
| PATCH/DELETE | `…/account/addresses/{id}` | address / — | 200 / 204 | 401/404/422 | A04 |
| GET | `…/account/orders` | `?page=` | `{ items, total }` | 401 | A05 |
| GET/POST/DELETE | `…/account/wishlist(/{productId})` | — | list / 201 / 204 | 401/404 | A06 |

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency |
|---|---|---|---|---|
| `storefront.buyer.signed_up` | storefront | none yet | — | after commit |
| `sales.order.updated` | sales (installed) | `storefront` subscriber `order-status-notify` | notification to the buyer when the status or payment status value changed | idempotent on the last-notified values |

## Security, Privacy, and Compliance

- **Authentication:** installed password hashing, lockout and sessions. Phone + password only.
  - Without OTP, a person can register someone else's number in a store. Accepted under P6: no order data is bound by phone, guest orders are claimed only by token, and the merchant sees "phone not verified".
- **Isolation:** sessions are honoured only when the JWT tenant and organization equal the store's. Addresses, orders and wishlist are always filtered by the session's user and the store scope; a foreign address id is 404.
- **Privacy:** the phone is encrypted at rest and looked up by hash. Logs carry ids only.

## Integration Coverage

| Test ID | Level | Actions | Assertions | Req |
|---|---|---|---|---|
| TEST-A01 | API | sign up, sign in, wrong password, lockout, sign out | cookies; 401 generic; no email captured | A01 |
| TEST-A02 | security | same phone in two stores; store A session on store B | two accounts; B treats as signed out | A02 |
| TEST-A03 | API | guest cart → sign in → merge | lines merged, guest cart closed | A03 |
| TEST-A04 | API + browser | addresses CRUD, default, checkout pre-select | one default; checkout uses it | A04 |
| TEST-A05 | API | orders list; other user's order | only own orders | A05 |
| TEST-A06 | API | wishlist add/remove/list; inactive product hidden | — | A06 |
| TEST-A07 | integration | merchant changes status → buyer notification | one notification per change, Arabic text | A07 |
| TEST-A08 | browser | full account journey at 390 px, two themes | RTL, themed | A01–A08 |

## Implementation Phases

### Phase A1 — Phone accounts and the store session

- **Depends on:** shopping-journey Phase 3 (cart).
- **Deliverables:** `storefront_buyer_phones` migration; signup/login/logout routes; session helper (store-scoped); cart attach/merge; header account button; login/sign-up pages.
- **Requirements closed:** REQ-A01, A02, A03.
- **Tests:** TEST-A01, A02, A03.
- **Exit gate:** two stores, the same phone, two accounts; sign-in merges the cart; no email captured.

### Phase A2 — Addresses and orders

- **Depends on:** A1, shopping-journey Phase 4.
- **Deliverables:** person creation on sign-up; addresses API and page; checkout pre-select and save; `customerEntityId` on orders; orders page.
- **Requirements closed:** REQ-A04, A05, A08.
- **Tests:** TEST-A04, A05.
- **Exit gate:** a second order with a saved address in one tap; the order appears under the buyer and the customer in the CRM.

### Phase A3 — Wishlist and notifications

- **Depends on:** A2.
- **Deliverables:** wishlist table, API, buttons and page; order-status subscriber; bell and notifications page.
- **Requirements closed:** REQ-A06, A07.
- **Tests:** TEST-A06, A07, A08.
- **Exit gate:** a status change made in the admin reaches the buyer's bell; the wishlist works on both stores.

## Edge Cases and Failure Scenarios

| Scenario | Buyer sees | Behaviour |
|---|---|---|
| Phone already registered in this store | "هذا الرقم مسجّل — سجّل الدخول" (this number is registered — sign in) | 409; nothing created |
| Wrong password / locked | Generic error / "try again later" | Installed counters |
| Session from another store | Signed-out header | Session ignored |
| Address deleted while selected at checkout | Address list refreshes | 404 → re-select |
| Product in wishlist deactivated | Hidden from the list | Filtered by the public catalog rule |
| Notification subscriber fails | Order unaffected | Event retried by the persistent queue; idempotent on last-notified values |

## Requirement Traceability

| Requirement | Surface | Contracts | Phase | Tests | AC |
|---|---|---|---|---|---|
| REQ-A01 | login/signup | signup/login/logout | A1 | TEST-A01 | AC-A01 |
| REQ-A02 | all | session helper | A1 | TEST-A02 | AC-A02 |
| REQ-A03 | cart | merge | A1 | TEST-A03 | AC-A01 |
| REQ-A04 | addresses, checkout | addresses API | A2 | TEST-A04 | AC-A03 |
| REQ-A05 | orders | orders API | A2 | TEST-A05 | AC-A03 |
| REQ-A06 | wishlist | wishlist API | A3 | TEST-A06 | AC-A04 |
| REQ-A07 | bell | subscriber, installed API | A3 | TEST-A07 | AC-A04 |
| REQ-A08 | account | account API | A2 | TEST-A08 | AC-A03 |

### Extension-surface traceability

| Surface | Requirement | Reference capability → exact source | Phase | Own test | Mechanism |
|---|---|---|---|---|---|
| Account API routes `api/shop/[siteSlug]/account/**` | REQ-A01…A08 | `api.custom-route` → `src/modules/example/api/organizations/route.ts` | A1–A3 | TEST-A01, A04, A05, A06 | emitted-example |
| Entities `storefront:buyer_phone`, `storefront:wishlist_item` + migration | REQ-A01, A06 | `data.entities` → `src/modules/example/data/entities.ts`; `data.migrations` → `src/modules/example/migrations/Migration20260804120546_example.ts` | A1, A3 | TEST-A01, A06 | emitted-example |
| Encryption map for the buyer phone | REQ-A01 | `data.encryption-map` → `src/modules/example/encryption.ts` | A1 | TEST-A01 (stored value is not plaintext) | emitted-example |
| Frontend pages `frontend/[siteSlug]/account/**` | REQ-A01…A08 | `ui.frontend-page` → `src/modules/example/frontend/example.tsx` | A1–A3 | TEST-A08 | emitted-example |
| Subscriber `storefront:order-status-notify` on `sales.order.updated` | REQ-A07 | `events.ephemeral-subscriber` → `src/modules/example/subscribers/example-event.ts` (declared `persistent: true` here) | A3 | TEST-A07 | emitted-example |
| Notification type `storefront.order.status_changed` | REQ-A07 | `notifications.type` → `src/modules/example/notifications.ts` | A3 | TEST-A07 | emitted-example |

## Implementation Plan

**Phase A1**

1. Migration and entity for phone bindings, the encryption map, and the phone normalizer (shared with checkout). Test: TEST-A01 unit.
2. Sign-up, login and logout routes using the installed services; the store-scoped session helper. Test: TEST-A01, A02.
3. Attach and merge the cart on sign-in; header account button; login and sign-up pages. Test: TEST-A03, browser.

**Phase A2**

4. Create the person on sign-up; set `customerEntityId` on orders placed while signed in. Test: TEST-A05 setup.
5. Addresses API and page; checkout pre-select and save. Test: TEST-A04.
6. Orders list and account page (password change). Test: TEST-A05, A08.

**Phase A3**

7. Wishlist table, API, buttons and page. Test: TEST-A06.
8. Order-status subscriber and notification type; header bell and notifications page. Test: TEST-A07, A08.

## Resolved assumptions (autonomous defaults)

| Question | Chosen answer | Rationale | Marker |
|---|---|---|---|
| Q-A01 Verification without email or SMS | None at launch | Owner rule P6; reference behaviour; nothing is bound by phone | ⚠ NEEDS HUMAN CONFIRMATION: accounts are not phone-verified |
| Q-A02 Claim guest orders by phone | No; token on the device only | Privacy | — |
| Q-A03 Identity store | Installed `customer_accounts` with a `.invalid` identifier and a phone binding (A-1) | No parallel auth | — |

## Rollout, Migration, and Rollback

- Additive migrations: `storefront_buyer_phones`, `storefront_wishlist_items`, and the new columns on carts and order access. `down` drops them.
- Accounts stay in `customer_users` and are visible to the merchant's customer-accounts admin.
- Disabling the feature means hiding the header account button; existing sessions expire as installed.

## Risks and Tradeoffs

| Risk | Impact | Mitigation | Residual |
|---|---|---|---|
| No phone verification | Someone registers another person's number | Nothing is bound by phone; merchant sees unverified; OTP spec later | Accepted (P6) |
| Forgotten password | Buyer locked out | Merchant reset in a later dashboard; new account with a new number is not possible for the same phone | Accepted until the dashboard |
| `.invalid` identifier visible to staff | Confusion in the admin | The person record holds the real name and phone; document | Low |
| One customer cookie per browser | Signing into store B signs out of store A | Session honoured per store; documented | Accepted |

## Deferred dashboard work

| Buyer feature | Merchant settings / actions | Data | Permissions | Dependencies |
|---|---|---|---|---|
| Accounts | List buyers, deactivate, reset password, see phone (verified or not) | `customer_users`, phone binding | `customer_accounts.*` | A1 |
| Notifications | Edit Arabic templates per status | notification types | `notifications.manage` | A3 |
| Wishlist insight | Most-wished products | wishlist table | `storefront.view` | A3 |

## Acceptance Criteria

- [ ] **AC-A01** — Sign-up, sign-in and sign-out work with phone + password and no email or code. The guest cart carries over.
- [ ] **AC-A02** — The same phone is two separate accounts in two stores; a session never crosses stores.
- [ ] **AC-A03** — Saved addresses and order history work, and the second checkout uses the default address.
- [ ] **AC-A04** — Wishlist and order-status notifications work in Arabic in each store's theme.
- [ ] All surfaces have loading, empty, error, keyboard, accessibility and responsive states; validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `customer_accounts`, `customers`, `notifications`, `ui` AGENTS; spec-delivery guide |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability |
| Every workflow completes end to end without a catch-all integration phase | pass | A1–A3 |
| Platform-native reuse and extension points were chosen before custom code | pass | A-1, reuse map |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI contracts |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | phases |

Verdict: Ready for implementation

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-A01 | Sign-up verification without email or SMS? | product | no | None at launch (P6); recorded risk, 2026-10-25 |
| Q-A02 | Claim guest orders by phone? | product | no | No; token on the device only (A-4), 2026-10-25 |

## Changelog

| Date | Change |
|---|---|
| 2026-10-25 | Initial specification (autonomous, owner brief of 2026-10-25) |
