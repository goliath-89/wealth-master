# Google Cloud setup — prerequisite for P0.5, P0.6, P0.9

One-time setup the owner must do by hand. It produces a **Client ID**, which is the only
value the app needs. Everything after that is code.

Console details verified against Google's documentation on **11 August 2026**; Google
changes this console often, so treat menu names as a guide and search the console if one
has moved.

---

## 1. Create the project

Go to <https://console.cloud.google.com/projectcreate>.

- **Project name:** `wealth-master`
- Leave organisation/location as-is. Click **Create**, then wait for it to become the
  selected project in the top bar.

## 2. Enable the Sheets API

Go to <https://console.cloud.google.com/apis/library/sheets.googleapis.com>, confirm
`wealth-master` is the selected project, and click **Enable**.

This is the only API that needs enabling. The app talks to Sheets directly over REST
using the access token — no Drive API call is required to create or update the
spreadsheet.

## 3. Configure the Google Auth Platform

Go to <https://console.cloud.google.com/auth/overview> and complete the setup prompts.

- **App name:** `Wealth Master`
- **User support email:** your own address
- **Audience / User type:** **External**
  (Internal is only available to Google Workspace organisations.)
- **Developer contact:** your own address

## 4. Add yourself as a test user

Go to <https://console.cloud.google.com/auth/audience>, and under **Test users** click
**Add users**. Enter your own Gmail address.

Skipping this is the most common cause of `access_denied` on first sign-in. While the app
is in **Testing** status, only listed test users can authorise it — and that is exactly
what we want for a single-owner tool.

## 5. Create the OAuth client

Go to <https://console.cloud.google.com/auth/clients> and click **Create client**.

- **Application type:** **Web application**
- **Name:** `Wealth Master web`

Under **Authorized JavaScript origins**, add these three entries:

```
https://goliath-89.github.io
http://localhost
http://localhost:8137
```

**The origin is scheme + hostname only — no path.** Google rejects a path, and the single
most common mistake here is entering `https://goliath-89.github.io/wealth-master`. The
app is *served* from that path, but its *origin* is the bare hostname. No trailing slash.

Leave **Authorized redirect URIs** empty. The Google Identity Services token flow uses a
popup tied to the origin and never redirects.

## 6. Copy the Client ID

After creating the client you get a **Client ID** ending in
`.apps.googleusercontent.com`, and a **Client secret**.

- The **Client ID** is what the app needs. It is not a secret and is designed to ship in
  public client-side code — safe in this public repo.
- The **Client secret** is never used by this app. Browser apps cannot hold one securely.
  Do not put it in the repo, in a config file, or in any commit (SEC-1).

Hand the Client ID over and it goes into the app's config for P0.5.

---

## What happens at first sign-in

The consent screen shows an **"unverified app"** warning, reached via *Advanced →
Go to Wealth Master (unsafe)*. This is expected (R5) and is not a misconfiguration — it is
what Google shows for any app in Testing status that has not been through review.

Verification is not needed here. The `drive.file` scope is classified **non-sensitive**,
and a personal-use app with a single test user stays comfortably inside the
unverified-app allowance. Publishing to Production and requesting review would only be
necessary to let strangers sign in.

## Scope

The app requests exactly one scope:

```
https://www.googleapis.com/auth/drive.file
```

This grants access **only to files the app itself creates** — the Wealth Master
spreadsheet and nothing else in your Drive (SEC-4). Your existing Warrant Desk and
Receipts Tracker sheets remain invisible to it.

## Token handling

Access tokens live in memory only and are never written to localStorage (SEC-5). They
expire after roughly an hour, after which the app requests a fresh one silently while
your Google session is active. There are no refresh tokens in this flow, so the seven-day
refresh-token expiry that applies to Testing-status apps is not a concern here.
