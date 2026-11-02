# Floor Plan — Domain Knowledge

## What This Template Is
A parametric 2D/3D architectural floor plan and room layout designer (`waymark-floorplan`). Each row defines a spatial element (room, wall, door, window, furniture, fixture, electrical, or plumbing element) with coordinates and dimensions in feet.

## Column Role Semantics
- `type` — Element type (`Room`, `Wall`, `Door`, `Window`, `Fixture`, `Furniture`, `Electrical`, `Plumbing`, `Zone`, `Stair`).
- `label` — Human-readable name (e.g., `Living Room`, `Kitchen Island`, `Primary Bedroom`, `Front Door`).
- `layer` — Architectural layer (`Structure`, `Rooms`, `Openings`, `Fixtures`, `Furniture`, `Electrical`, `Plumbing`, `Annotations`).
- `x` — Horizontal X position in feet from origin (`0` = left edge).
- `y` — Vertical Y position in feet from origin (`0` = top edge).
- `width` — Width (X span) in feet.
- `height` — Ceiling/wall height (Z span) in feet (typically `8` or `9` for rooms/walls, `3` for counters).
- `length` — Depth/length (Y span) in feet.
- `notes` — Material, finish, color, circuit, or specification notes.

## Smart Operations

### Designing a Cohesive Layout
- Avoid unintentionally overlapping rooms on the `Rooms` / `Structure` layer: place adjacent rooms so their `(x, y)` coordinates and `(width, length)` spans abut cleanly (e.g., Room A at `x=0, y=0, width=16, length=14` and adjacent Room B at `x=16, y=0, width=12, length=14`).
- Place `Furniture` and `Fixture` elements inside the bounding box `[x, x + width] × [y, y + length]` of their parent room.
- Place `Door` and `Window` elements along room boundary walls.
