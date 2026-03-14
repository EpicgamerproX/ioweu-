# Invite System Integration

## Frontend modules

- `js/invite-side-panel.js`: fixed right-side invite panel with minimize and restore behavior.
- `js/qr-box-card.js`: boxed QR card UI, room code display, and invite actions.
- `js/qr-code-generator.js`: QR canvas rendering and PNG download.
- `js/room-invite-api.js`: invite URL normalization, `/join/:roomId` parsing, and route cleanup.

## Required QR library

This app currently loads the QR library globally from the page:

```html
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
```

If you prefer package installation in another build setup, the equivalent package is:

```bash
npm install qrcode
```

The current repo uses the global browser build, so no extra install step is needed unless the asset pipeline changes.

## Backend contract

### Supabase RPC contract

`create_group_for_member` should normalize to:

```json
{
  "group_id": "uuid",
  "group_name": "Weekend Trip",
  "room_key": "ROOM1234",
  "currency_code": "INR",
  "roomId": "ROOM1234",
  "inviteUrl": "https://myapp.com/join/ROOM1234"
}
```

The frontend accepts this through `normalizeGroup()` and `normalizeInviteData()`.

`roomId` is treated as the canonical invite code.

If `inviteUrl` is missing, the frontend derives it as:

```text
${APP_CONFIG.appBaseUrl}/join/${roomId}
```

### Example HTTP endpoint

If this logic is exposed outside Supabase RPC, the equivalent endpoint shape is:

```http
POST /api/rooms
Content-Type: application/json
Authorization: Bearer <session-token>
```

```json
{
  "roomName": "Weekend Trip",
  "currency": "INR"
}
```

Response:

```json
{
  "id": "uuid",
  "name": "Weekend Trip",
  "roomId": "ROOM1234",
  "inviteUrl": "https://myapp.com/join/ROOM1234"
}
```

## Join route flow

- Invite entry route is `/join/:roomId`.
- If a logged-out user lands on that route, the app stores `roomId` and keeps the auth UI visible.
- After login or signup, the app automatically runs the existing join logic for that room.
- While the join is being validated, the app shows a lightweight spinner status.
- On success:
  - the route is cleared,
  - the room becomes active,
  - workspace data loads,
  - the invite panel is available for the active room.
- On failure:
  - the pending route is cleared,
  - an error message is shown,
  - the app remains usable.

## App config requirements

Set `APP_BASE_URL` so invite links resolve to the deployed app origin:

```js
window.__EXPENSE_TRACKER_ENV__ = {
  APP_BASE_URL: "https://myapp.com"
};
```

This value is passed into `create_group_for_member` and is also used by the frontend fallback invite URL builder.

## Notes

- Invite panel visibility is derived from the active room's invite data, not only from newly created rooms.
- QR regeneration is skipped when the `inviteUrl` has not changed.
- QR rendering errors are surfaced to the user instead of failing silently.
