export interface Theme {
  id: string;
  label: string;
  /** How the light colour is described to the image model. */
  lightDescription: string;
  /** CSS gradient for the theme tab in the UI. */
  swatch: string;
}

/**
 * Every design renders all of these in parallel, so visitors can flip between them instantly.
 * Each one is an AI render, so each theme added here adds to the cost of every lead.
 */
export const THEMES: Theme[] = [
  {
    id: 'warm_white',
    label: 'Warm White',
    lightDescription:
      'every light is the same soft warm white (about 2700K, like candlelight) — elegant everyday accent lighting',
    swatch: 'linear-gradient(90deg,#ffd8a1,#ffe9c7)',
  },
  {
    id: 'holiday',
    label: 'Holiday',
    lightDescription: 'festive Christmas colours: the lights alternate red, green, red, green, with an occasional warm white one',
    swatch: 'linear-gradient(90deg,#e53935,#43a047,#e53935)',
  },
  {
    id: 'multicolor',
    label: 'Multicolor',
    lightDescription:
      'a vivid rainbow that flows smoothly along the roofline — red, orange, yellow, green, blue, purple — each light a single colour, neighbouring lights blending into the next hue',
    swatch: 'linear-gradient(90deg,#f44336,#ff9800,#ffeb3b,#4caf50,#2196f3,#9c27b0)',
  },
];

export function getTheme(id: string | undefined): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export function buildPrompt(theme: Theme, spacingInches: number): string {
  const spacingCm = Math.round(spacingInches * 2.54);
  return `Edit this photograph of a house. Keep the exact same house, camera position and framing, but make it dusk (blue hour, deep blue sky just after sunset) and show Govee Permanent Outdoor Lights Pro professionally installed and switched on.

How the lights are installed — follow this precisely:
- A single run of small, round LED point lights mounted tight under the edge of the roof (along the fascia / eave line), following EVERY visible roofline edge of the house: every horizontal eave and up and down every gable and peak.
- Spacing is what makes it look real: each light is a separate, distinct point of light with a clear dark gap between neighbours — evenly spaced about ${spacingInches} inches (${spacingCm} cm) apart, the same spacing along the whole house. A typical 40-foot eave has roughly ${Math.round((40 * 12) / spacingInches)} lights. It must NOT look like a continuous LED strip or rope light, and the lights must not be bunched up, doubled or randomly placed.
- The fixtures are low-profile and blend into the trim; you see the neat line of evenly spaced points of light and the soft glow they wash down onto the walls and trim beneath them.
- Light colour: ${theme.lightDescription}.
- Realistic brightness: clearly lit and inviting, not blown out. Subtle reflections on nearby surfaces.
- Lights go ONLY on the rooflines of the main house in the centre of the photo. No lights on trees, bushes, fences, cars, windows or neighbouring buildings.

Keep everything else identical: architecture, roof shape, windows, doors, siding and trim colours, materials, landscaping, driveway and surroundings. A few windows may show warm interior light. Do not add people, text, logos or watermarks. The result must look like a real, photorealistic twilight photograph of this exact house.`;
}
