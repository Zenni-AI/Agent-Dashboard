export interface Theme {
  id: string;
  label: string;
  /** How the light colour is described to the image model. */
  lightDescription: string;
  /** CSS gradient for the theme chip in the UI. */
  swatch: string;
}

export const THEMES: Theme[] = [
  {
    id: 'warm_white',
    label: 'Warm White',
    lightDescription: 'a soft, warm white (about 2700K, like candlelight) — elegant everyday accent lighting',
    swatch: 'linear-gradient(90deg,#ffd8a1,#ffe9c7)',
  },
  {
    id: 'christmas',
    label: 'Holiday',
    lightDescription: 'festive Christmas colours: alternating red and green lights with a few warm white ones',
    swatch: 'linear-gradient(90deg,#e53935,#43a047,#e53935)',
  },
  {
    id: 'halloween',
    label: 'Halloween',
    lightDescription: 'Halloween colours: alternating vivid orange and purple lights',
    swatch: 'linear-gradient(90deg,#ff8f00,#8e24aa,#ff8f00)',
  },
  {
    id: 'patriotic',
    label: 'Red, White & Blue',
    lightDescription: 'patriotic colours: repeating red, white and blue lights',
    swatch: 'linear-gradient(90deg,#e53935,#ffffff,#1e88e5)',
  },
  {
    id: 'rainbow',
    label: 'Rainbow',
    lightDescription: 'a smooth rainbow gradient that flows along the roofline (red, orange, yellow, green, blue, violet)',
    swatch: 'linear-gradient(90deg,#f44336,#ff9800,#ffeb3b,#4caf50,#2196f3,#9c27b0)',
  },
  {
    id: 'ice_blue',
    label: 'Winter Ice',
    lightDescription: 'cool icy blue and crisp white lights alternating, like a winter wonderland',
    swatch: 'linear-gradient(90deg,#81d4fa,#ffffff,#4fc3f7)',
  },
];

export const DEFAULT_THEME = 'warm_white';

export function getTheme(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

export function buildPrompt(theme: Theme): string {
  return `Edit this photograph of a house. Show the exact same house, from the same camera position and with the same framing, at dusk (blue hour, the sky deep blue just after sunset) with Govee Permanent Outdoor Lights Pro professionally installed.

How the lights are installed — follow this precisely:
- One continuous run of small, evenly spaced round LED point lights (individual pucks about 4 inches / 10 cm apart) mounted tight under the roof eaves along the fascia/soffit, following EVERY visible roofline edge of the house: the horizontal eaves and up and down every gable and peak.
- The fixtures are low-profile and blend into the trim; what you notice is the neat line of individual points of light and the glow they wash down onto the walls and trim beneath them.
- Light colour: ${theme.lightDescription}.
- Realistic brightness: inviting and clearly visible, not blown out. Subtle reflections on nearby surfaces.
- Put lights ONLY on the rooflines of the main house in the photo. No lights on trees, bushes, fences, cars or neighbouring buildings.

Keep everything else identical: architecture, roof shape, windows, doors, siding and trim colours, materials, landscaping, driveway and surroundings. A few windows may show warm interior light. Do not add people, text, logos or watermarks. The result must look like a real, photorealistic twilight real-estate photograph.`;
}
