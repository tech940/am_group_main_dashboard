# Frontend & UI/UX Design Engineering Rules

## Automated Skill Selection & Hierarchy
For frontend and UI/UX work, automatically select and apply the appropriate installed skills based on the task scope rather than requiring explicit user invocation.

### Skill Hierarchy & Specializations:

1. **CREATIVE DIRECTION**
   - **Taste**: Visual restraint, typography selection, aesthetic cohesion, avoiding generic AI defaults.
   - **Frontend Design**: Modern layouts, responsive framing, whitespace hierarchy, balanced content density.
   - **UI/UX Pro Max**: Domain-specific UX flows, usability ergonomics, progressive disclosure, intuitive navigation.
   - **Apple Design**: Precision alignment, optical balance, subtle depth, high-contrast legibility, tactile micro-details.

2. **INTERACTION**
   - **Emil Design Engineering**: Crafting snappy, physics-accurate transitions, responsive states, feedback micro-interactions.
   - **Design Motion Principles**: Purposeful choreography, avoiding unnecessary fluff, honoring `prefers-reduced-motion`.

3. **SYSTEM**
   - **Design System**: Cohesive token scale (spacing, radii, font weights, color palettes), reusable UI component patterns.
   - **UX Copy**: Concise, unambiguous labels, scannable microcopy, actionable empty/error states.

4. **QUALITY**
   - **Design Critique**: Objective visual evaluation, contrast auditing, visual hierarchy scrutiny.
   - **Impeccable**: Pixel perfection, typographic rhythm, edge-case UI handling.
   - **Web Design Guidelines**: Standards compliance, keyboard navigability, semantic HTML.
   - **Accessibility Review**: WCAG compliance, high contrast ratios, screen reader semantics, ARIA states.

5. **PERFORMANCE**
   - **Fixing Motion Performance**: GPU-accelerated transforms (`transform`, `opacity`), zero layout thrashing, efficient re-renders.

6. **ENGINEERING**
   - **Architecture**: Modular component structure, predictable state management, clear separation of concerns.
   - **Code Review**: Defensive coding, type safety, bundle-size efficiency.
   - **Testing Strategy**: Regression prevention, user interaction coverage.

7. **VERIFICATION**
   - **Playwright / Browser Tools**: Visual verification, layout confirmation across viewports, verifying actual rendered UI in real browser.

> [!NOTE]
> Do not blindly use all skills at once. For small UI changes or quick fixes, select only the specific relevant skills.

---

## 11-Step Major Redesign Workflow
When executing a major feature or page redesign, follow this disciplined 11-step pipeline:

1. **Audit the Existing Application**: Understand current data flows, user pain points, responsive constraints, and business logic.
2. **Establish Visual Direction**: Define color palette, tone, density, and thematic identity tailored to the product domain.
3. **Establish Design System**: Define consistent tokens (typography scale, elevation, border-radii, spacing).
4. **Create the Page Architecture**: Layout scaffolding, responsive breakpoints, navigation hierarchies, and content zones.
5. **Implement**: Build clean, modular, type-safe components.
6. **Implement Motion**: Add purposeful, performant micro-interactions and transitions.
7. **Test in the Real Browser**: Validate responsive rendering, interactive states, and edge cases.
8. **Critique the Visual Result**: Perform self-critique on typography, spacing, contrast, and visual balance.
9. **Fix Issues**: Refine polish, fix alignment drifts, and resolve layout quirks.
10. **Run Accessibility & Performance Checks**: Verify contrast, keyboard accessibility, ARIA tags, and render performance.
11. **Perform Final Code Review**: Ensure maintainability, no console errors, and clean TypeScript types.

---

## Anti-Patterns to Avoid (No Generic AI UI)
Never add generic AI UI patterns simply because they are common. Avoid:
- ❌ **Generic SaaS Layouts**: Boring cookie-cutter template boxes.
- ❌ **Excessive Cards**: Over-nesting cards inside cards inside cards.
- ❌ **Unnecessary Icons**: Adding icons to every single heading or text snippet.
- ❌ **Excessive Gradients**: Rainbow gradients, muddy background washes.
- ❌ **Random Bright Colors**: Uncurated, clashing accent colors.
- ❌ **Generic Typography**: Unexpressive font sizing with poor typographic contrast.
- ❌ **Excessive Rounded Corners**: Bubble-like, exaggerated radii where crisp edges work better.
- ❌ **Glassmorphism**: Overused translucent blurred backdrops with low text contrast.
- ❌ **Animation Everywhere**: Gratuitous bouncing, spinning, or delayed fade-ins on basic static content.
- ❌ **Unnecessary 3D**: Distracting faux-3D widgets that add zero information value.
- ❌ **Repetitive Section Structures**: Repeating identical 3-column blocks across the entire page.

---

## Precedence
Explicit project instructions and user prompts always override these rules.
