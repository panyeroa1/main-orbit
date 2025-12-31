Task ID: T-0015
Title: Fix Webpack Vendor Chunk Error
Status: DONE
Owner: Miles

Start log:
- Timestamp: 2025-12-31 11:55
- Plan: Clean cache (.next), reinstall node_modules, and rebuild.

End log:
- Timestamp: 2025-12-31 12:00
- Changed:
  - Deleted `.next`, `node_modules`, `package-lock.json`.
  - Reinstalled dependencies.
  - Successfully built production bundle.
- Tests: `npm run build` passed.
- Status: DONE
