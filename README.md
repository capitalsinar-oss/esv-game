# Future Family Holidays

The Endless Summer Villa family game: parents and kids vote on what the villa builds next.

- Game: `/play` (link previews, Meta pixel when `META_PIXEL_ID` is set)
- Team stats: `/play/stats?token=ADMIN_TOKEN`
- Downloads: `/api/ffh/export.csv?token=…` (plays), `/api/ffh/events.csv?token=…` (events)

## Render
- Build `npm install`, start `node server.js`
- Persistent disk mounted at `/data` (plays and events are stored there)
- Environment: `ADMIN_TOKEN`, `META_PIXEL_ID`, `META_CAPI_TOKEN`; optional `META_TEST_EVENT_CODE` while testing, `PUBLIC_URL`
