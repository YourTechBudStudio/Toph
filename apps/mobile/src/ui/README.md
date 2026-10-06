# ui

Shared presentation primitives and layouts. Capability modules compose these without putting product state into shared UI.

- `ui/core`: press feedback, cards, rows, controls, fields, and title text.
- `ui/chrome`: the screen frame, its backdrop, and the back bar of pushed screens.
- `ui/theme.ts`: token values mirrored from `global.css` for SVG, icons, gradients, and navigator options.

## Rules

- Screens compose primitives; they do not restyle them. If a screen needs a different look, the primitive gains a prop or a variant.
- Colors, fonts, and radii come from tokens: a Tailwind class where one exists, `ui/theme.ts` where a class cannot reach. No hex literals in screens.
- Every press goes through `PressableScale`, so the app has one press feel. Reduced motion dims instead of scaling.
- A tone maps to literal class names inside the primitive, never to an interpolated class string, so Tailwind can see every class.
- `className` on an animated surface needs `AnimatedView`; a plain `Animated.View` ignores it.
