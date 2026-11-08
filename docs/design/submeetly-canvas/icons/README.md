# Colour icons (D02, D03, T03)

`colour-icons.mjs` holds full-colour two-tone icons on a 24 grid, plus the hue tiles they sit on.

Source of the approach: Solvarium, `E:/devSchedule/Solvarium/app/src/workspace/logic/p6Icons.js` ("Full-colour toolbar icons ... our own hand-written SVG on a 24 grid, built from small shapes"). The helper shapes (R rect, C circle, P path, L line) and the palette family (green, blue, red, amber, orange, teal, slate: light fill plus darker outline) are the same idea. Every drawing here is new; nothing is copied or traced from another product.

Rules kept
- One hue per feature group (tile tint), seven hues: g, b, o, t, y, r, n. No sparkle AI icon, no emoji.
- Text next to an icon is always ink (`--text`), never the hue, so text contrast stays at or above 4.5:1. Icon-on-tile is checked at 3:1 (non-text).
- Used only on the redrawn boards D02, D03, T03. The shipped app keeps its line icons until the owner approves the set.
