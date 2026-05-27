---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:

- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

### Apple-Inspired Design Philosophy

The design system follows its own theme and palette, but the **interaction quality, motion design, and layout sensibility are heavily inspired by the Apple design system**. Every UI decision should pass the gut check: "Would Apple ship this?"

**What this means in practice:**

- **Motion**: Smooth, purposeful animations with ease-out curves and generous durations (800-1200ms). No jarring jumps. Scroll behavior, transitions, and hover states should feel fluid and deliberate.
- **Spacing & layout**: Generous whitespace. Let content breathe. When in doubt, add more space, not less.
- **Typography**: Clear visual hierarchy. Headlines that command attention, body text that's effortless to read.
- **Interactions**: Every clickable element should have tactile feedback (subtle scale, opacity shifts, smooth color transitions). Nothing should feel "dead" on hover/click.
- **Restraint**: Resist the urge to add. Fewer elements, each with more impact. If a section feels busy, remove something rather than rearranging.

**Always respect `prefers-reduced-motion`** - when the user has motion reduction enabled, skip animations entirely rather than degrading them.

### Color Palette — Catppuccin Macchiato

The design system uses the **Catppuccin Macchiato** flavor as its canonical color palette ([catppuccin.com/palette](https://catppuccin.com/palette)). All UI work must use these tokens — do not invent ad-hoc colors.

| Role             | Token             | Hex       | Catppuccin name              |
| ---------------- | ----------------- | --------- | ---------------------------- |
| Canvas           | `canvas`          | `#24273a` | Base                         |
| Elevated surface | `canvas-elevated` | `#363a4f` | Surface 0                    |
| Subtle surface   | `canvas-subtle`   | `#2e3244` | — (between Base & Surface 0) |
| Primary text     | `text-primary`    | `#cad3f5` | Text                         |
| Secondary text   | `text-secondary`  | `#a5adcb` | Subtext 0                    |
| Tertiary text    | `text-tertiary`   | `#6e738d` | Overlay 0                    |
| Blue accent      | `accent-blue`     | `#8aadf4` | Blue                         |
| Violet accent    | `accent-violet`   | `#c6a0f6` | Mauve                        |
| Amber accent     | `accent-amber`    | `#f5a97f` | Peach                        |
| Green accent     | `accent-green`    | `#a6da95` | Green                        |
| Red accent       | `accent-red`      | `#ed8796` | Red                          |
| Cyan accent      | `accent-cyan`     | `#91d7e3` | Sky                          |
| Spark / capture  | `spark`           | `#7dc4e4` | Sapphire                     |

**Soft tints**: Each accent has a `-soft` variant at 12-14% opacity (e.g., `accent-blue-soft: rgba(10, 132, 255, 0.12)`). Use these for card fills and pastel backgrounds.

**Card borders**: `rgba(255, 255, 255, 0.06)` — subtle white edge that defines card boundaries without harshness.

**Background atmosphere**: Use 2-3 overlapping full-screen `LinearGradient` layers with Catppuccin accents at 2-4% opacity and different angles. This creates a faint nebula wash. Every layer must cover the full screen (no `height`/`top` clipping) to avoid hard edges.

### Typography

| Role    | Font family       | Weights                                         | Purpose                                                                                 |
| ------- | ----------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Display | **Sora**          | 400 Regular, 500 Medium, 600 SemiBold, 700 Bold | Headings, titles, emphasis. Geometric and distinctive.                                  |
| Body    | **Source Sans 3** | 400 Regular, 500 Medium, 600 SemiBold, 700 Bold | Body text, labels, UI copy. Optimized for readability and fast scanning at small sizes. |

Both are loaded via `@expo-google-fonts` packages. Font tokens are defined in `global.css` (e.g., `--font-display`, `--font-body`) and used via NativeWind `className` utilities (`font-display`, `font-body`, etc.).

## Voice & Copywriting (Toph tone)

Default voice for UI copy is **witty, playful, and nerdy** with a light through-line of:

- The app is an AI that’s _cheerfully_ “trying to take over the world,”
- but in a clearly comedic, non-threatening way.

Guidelines:

- **Stay useful first**: clarity beats jokes. Humor should _support_ comprehension, not replace it.
- **Short punchlines**: one good line per surface. Avoid paragraph jokes or repeated bits.
- **Comedic-villain, not scary**: no violent/abusive language, no real-world harm, no coercive threats.
- **Developer-centric humor**: The humor should be explicitly for devs. Lean into shared developer pain points, engineering culture, and inside jokes (e.g., merge conflicts, ignored lint rules, cache invalidation, pushing to production on Fridays, blaming DNS) rather than generic tech humor. However, ensure it doesn't gate the UI usability behind these jokes.
- **App speaks as “I”** when helpful (“I queued this for you.”), but avoid cringe roleplay.
- **Error states are kind**: funny, but still actionable.

Copy patterns to use:

- Status chips: “Plotting…”, “Assimilating context…”, “Rehydrating your brain cache…”
- CTAs: “Resume (mobile)”, “Unblock me”, “Approve the scheme”, “Capture a spark”, “Deploy idea → backlog”
- Empty states: “Nothing to unblock. Suspicious. I’ll allow it.”
- Micro-hints: “No code on mobile. I respect your thumbs.”

## Frontend Aesthetics Guidelines

Focus on:

- **Typography**: Use the established Sora (display) + Source Sans 3 (body) pairing. Do not introduce new font families unless explicitly requested. Sora provides geometric character for headings; Source Sans 3 provides exceptional readability for body text and scanning.
- **Color & Theme**: Use the Catppuccin Macchiato palette defined above. All colors must come from the established tokens. Use soft tints (12-14% opacity accents) for card backgrounds to create visual rhythm across sections. Do not invent ad-hoc colors.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Use overlapping full-screen `LinearGradient` layers with Catppuccin accent colors at very low opacity (2-4%) to create a subtle nebula wash on the canvas. Every gradient layer must cover the full viewport (no `height`/`top` clipping) to avoid hard edges. Cards use solid pastel tint fills (not blur/glassmorphism) for performance and visual clarity.

Stay within the established design system (Catppuccin Macchiato palette, Sora + Source Sans 3 fonts, pastel-tinted cards). Consistency across the app is more important than novelty per screen. Creativity should express through layout, spacing, motion, and copywriting — not by inventing new colors or fonts.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: You are capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.
