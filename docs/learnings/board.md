# Board pane

- A desktop chat's first message can run before its window attaches (about 0.6 s after the
  chat is created, on 2026-11-13). `$.ui.open` then answers not placed, with a reason that
  starts `no-surface`, and the pane never shows on its own. `/jobs` and `open_board` remember
  it (`awaitingWindow`) and open the pane again on the next `session.attach` from a surface
  that docks panes (never the phone, which reports `viewport.isFullscreen: false`). Other
  not-placed reasons (width floors) are the engine's to resolve.
- `claude plugin test` does not catch a non-literal hook matcher or tool arguments read from
  anywhere but flat on `e`; check a pane change live in a new desktop chat after merging.
