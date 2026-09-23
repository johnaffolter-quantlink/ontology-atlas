# three.js and a graphite palette: brainstorm, 2026-09-23

A point-in-time list of options, not a decision. Nothing here changes the
renderer rule in `AGENTS.md` (canvas-2D `ontology-map`, another renderer needs a
decision) or any record in `docs/DECISIONS.md`. Each item that ships goes
through `/po-pass`, `pnpm design:route` and, for a structural choice,
`/design-directions` with the status quo as one of the three directions.

## Starting point

- `three` 0.185.1 is already a dependency, used by the gateway hero
  (`src/views/download/lib/hero-atlas-scene.ts`) and the Library constellation
  (`src/views/library/expressive/constellation-scene.ts`). Both are loaded on
  demand after a WebGL probe and keep a 2D fallback (decision 2026-09-08,
  "The gateway hero is a lit three.js atlas").
- The 2026-09-06 probe (`docs/benchmark/THREE-PROBE-2026-09-06.md`) found
  WebGL no faster than canvas-2D at 125 or 1,000 nodes, both near 30 fps at
  5,000, and a 137 kB gzip chunk. Its bar for adoption: true occlusion, thick
  lines, or depth-correct labels, which the 2D engine cannot draw.
- The dome record (2026-08-18) measured a 3.29x rise in edge crossings when
  the same data becomes 3D. A 3D view must encode a typed fact in height or
  enclosure to pay that back.
- The charter is already neutrals plus one indigo; the 2026-09-08 lift of the
  expression bans keeps tokens, ramps, contrast floors and reduced motion.

A throwaway prototype was built outside the repository against the dogfood
vault (`docs/ontology`, 96 concepts including the project, 95 contains,
90 depends): Strata, Shells and Impact relief in three.js, instanced solids per
Node Spec kind, `LineSegments2` lines, ray-tested labels, and an
Indigo/Graphite selection-ink toggle. It reads only existing token values.

## Graphite: the monochrome system

| Idea | Size | Note |
|---|---|---|
| Graphite as a palette, not a constant | S | Swap whole palettes, as the ember swap did (decisions 69/79), keeping the L* ladder. |
| Selection by form, not hue | S | Ring, label weight and full-white ink; the rest dims one step. Hue is never the only channel. |
| Kind by shape and albedo | S | Node Spec shapes at 30/17/11/7, one albedo step per tier; shading separates kinds at small sizes. |
| Depth from light, not fill ramps | M | Architecture planes measured 1.00:1 between depths (2026-09-08). One shadowed key light separates plates. |
| 12-step neutral ramp with a fixed cool bias | S | Current map inks (`#7a7a86`, `#80808c`, `#8a8a96`) are cool; make `b − r` a rule, register in `globals.css` and `cn.ts`, gate contrast per surface. |
| Dither dark grounds | S | Low-alpha noise over radial grounds near `#08090a` to remove 8-bit banding. |
| Outlines, never glows, on labels | S | The probe's 1px canvas-colour outline on the product type ramp. |
| Colour-management contract | S | `NoToneMapping` and sRGB output for marks; a test that a flat-lit mark equals its token within ΔE 2. |

## Where 3D says something true

| Idea | Size | Fact carried |
|---|---|---|
| Impact relief | M | Height = hops a change reaches over `depends` (reverse) and `contains`. The product's "what a change could affect" as shape. |
| Strata | S | Height = tier, angle = ownership. The probe's next step stands: port into `dome-view.ts` for the 2D engine first. |
| Shells as a focused mode | M | Enclosure = "what is inside this domain". Entered from a domain's popover, never the default. |
| Path as a lit tube | M | A `find_path` answer; one travelling highlight at one speed, static chevrons under reduced motion. |
| Git growth on depth | L | `growth-replay.ts` order on z; recent meaning on top. |
| Architecture as stacked plates | M | FSD layers as plates; an upward import visibly climbs. |
| Gateway hero in graphite | S | Replace additive bloom sprites with one specular key and contact shadows. |
| One material set for all 3D | S | Hero and constellation share materials and lights. |

## Engineering that keeps it honest

- **One stage kernel in `src/shared/lib/`**: WebGL probe, token read at mount,
  a frame loop that sleeps after 30s, a reduced-motion still frame, dispose.
  The hero and the constellation duplicate this today. Moving dome placement
  down a layer also clears the probe's same-layer ratchet row.
- **`window.__atlasMap` for any 3D map**, so
  `tests/contract/map-testability.contract.test.ts` covers both engines.
- **Altitude as level of detail**: the continuous `farT` switches instanced
  solids to one `Points` draw of star sprites, brightness unchanged.
- **Attribute the 5,000-node bound** before any performance claim (label
  commits, raycasts, MSAA fill), then try id-buffer picking, `BatchedMesh`
  and a DPR cap of 2.
- **Off the critical path**: keep the hero's lazy-load rule and add a bundle
  check that no eagerly referenced chunk contains `three`.
- **WebGPU later**: `WebGPURenderer` with WebGL2 fallback behind the kernel,
  only after the bound is attributed.

## A reversible sequence

1. Kernel and colour contract. No visible change; the hero and the
   constellation move onto it.
2. Strata in the 2D engine, shown to the owner on the real vault.
3. Graphite palette as an appearance option through Personalization.
4. Impact relief behind a flag, with a renderer decision fragment, a
   falsifier, `/map-perf` and a `/motion-verify` recording.
