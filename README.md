# AdOps Shared Inbox

A lean shared inbox for the `adops@maxbounty.com` Google Group. Each teammate signs
in with Google; the app reads the group's mail from their own Gmail and keeps the
team's triage state (assignee, flag, done, notes) in Firestore so everyone sees
the same thing live.

Shared state is keyed on the first message's `Message-ID` header, because Gmail
gives the same email a different id in each person's mailbox.

## What's in it

- Views: All open, Unassigned, Assigned to me, Flagged, Done, and one per teammate
- Thread view with sandboxed HTML rendering
- Reply, Reply all, Forward with send-as address picker and HTML signature
- Assign / Take it / Flag / Mark done, synced through Firestore
- Team notes on each thread (never emailed)

## Setup

1. Firebase project: enable **Authentication > Google** and **Firestore**.
2. Google Cloud console for the same project: enable the **Gmail API**. On the
   OAuth consent screen add the scopes `gmail.readonly` and `gmail.send`, and add
   both teammates as test users (or make the app Internal if you're on Workspace).
3. `cp .env.example .env` and fill in the Firebase web config.
4. Edit the team emails in `firestore.rules` to match `VITE_TEAM`, then
   `npx firebase deploy --only firestore:rules`.
5. `npm install && npm run dev`, or `npm run build && npx firebase deploy --only hosting`.

Add the hosting domain (and `localhost`) under Authentication > Settings >
Authorized domains.

## Data model

```
threads/{messageIdKey}        assignee, flagged, done, subject, updatedBy, updatedAt
threads/{messageIdKey}/notes  text, author, createdAt
users/{email}                 signature (HTML)
```
