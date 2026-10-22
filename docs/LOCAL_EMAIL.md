# Email in local development

**Email delivery is disabled in local development on purpose.** Nothing is sent to any
provider; every outgoing email is written to a file instead. This lets self-service signup
(`/onboarding`) work end to end without a Resend or Amazon SES account.

## What is configured

These three lines live only in the git-ignored `.env` of a developer machine:

```env
OM_DISABLE_EMAIL_DELIVERY=true
OM_TEST_MODE=true
OM_TEST_EMAIL_CAPTURE_PATH=./.mercato/email-capture/outbox.jsonl
```

| Variable | Effect (Open Mercato 0.9.0, `@open-mercato/shared/lib/email`) |
|---|---|
| `OM_DISABLE_EMAIL_DELIVERY=true` | `sendEmail()` returns before looking up a provider, so a missing provider no longer fails the request (signup used to answer 502). |
| `OM_TEST_MODE=true` | `sendEmail()` appends every message (recipient, subject, links, text) to the capture file. The string `true` is used on purpose: framework test-only behaviours that check for the literal `'1'` (a test command interceptor, rate-limit opt-ins) stay off. |
| `OM_TEST_EMAIL_CAPTURE_PATH` | Capture file, relative to the app root. `.mercato/` is git-ignored. |

`SYSTEM_EMAIL_PROVIDER` and `RESEND_API_KEY` are **not** set locally. The `channel_resend`
module stays enabled but inactive; it is used as soon as a key is configured.

## Reading a verification link

After submitting `/onboarding`, the newest line of the capture file holds the email:

```bash
tail -n 1 .mercato/email-capture/outbox.jsonl | python3 -c "import sys,json; m=json.loads(sys.stdin.read()); print(m['subject']); print(*m['links'], sep='\n')"
```

Open the `/api/onboarding/onboarding/verify?...` link in the browser. The app provisions the
tenant, organization and owner, then sends you to `/login`.

Verified on 2026-10-22: form submit → 200, captured "Confirm your email to finish onboarding",
link → `/onboarding/preparing` → `/login`, owner sign-in → `/backend`, owner sees only their
own organization and cannot list tenants.

## Before any deployment: configure a real provider

**A deployment without a working email provider cannot onboard tenants**: signup stops at
the verification email. Never copy the three development lines above to a deployed
environment. Instead set:

**Resend**

```env
SYSTEM_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...                 # from the Resend dashboard
EMAIL_FROM="Suqna <no-reply@your-domain>"   # a sender on a domain verified in Resend
ADMIN_EMAIL=ops@your-domain           # receives new-signup notifications
APP_URL=https://your-domain           # base URL for verification links
```

**Amazon SES**

```env
SYSTEM_EMAIL_PROVIDER=ses
AWS_SES_REGION=eu-west-1              # or AWS_REGION
EMAIL_FROM="Suqna <no-reply@your-domain>"   # must be a verified SES identity
# credentials from the AWS SDK chain (instance role, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)
```

SES also needs the `channel_ses` module enabled in `src/modules.ts` (it is installed but
disabled in this app). Restart the app after changing email settings, then sign up once
with a real inbox to confirm delivery.

## Checks that keep the dev mode out of production

- `.env.example` (the template for every environment) does not set any of the three
  variables; they appear there only as commented documentation.
- `.env` is git-ignored.
- In production, a missing provider is a hard failure at signup (502), which is the
  intended signal.
