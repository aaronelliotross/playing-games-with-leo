// Each walk carries a visual `style` that selects its renderer:
//   'ink'        -> top-down Ink Wanderer world
//   'silhouette' -> side-on layered dusk landscape
//   'nocturne'   -> side-on night landscape
export const HIKES = [
  {
    id: 'walk_the_dog',
    name: 'Walk the Dog',
    style: 'ink',
    biome: 'park',
    description: 'Three miles. The dog stopped to smell everything.',
    distanceLabel: '3 mi',
    steps: 6000,
    funFact: 'Your dog smelled 47 things, investigated 12 of them, and was unsatisfied with all of them.',
  },
  {
    id: 'midnight_mile',
    name: 'The Midnight Mile',
    style: 'nocturne',
    biome: 'town',
    description: 'One quiet mile under the streetlights.',
    distanceLabel: '1 mi',
    steps: 2000,
    funFact: 'The whole town is asleep. It is, briefly, entirely yours.',
  },
  {
    id: 'mojave',
    name: 'Crossing the Mojave Desert',
    style: 'silhouette',
    biome: 'desert',
    description: '~130 miles of sand, sun, and Joshua trees.',
    distanceLabel: '~130 mi',
    steps: 300000,
    funFact: 'Daytime highs top 120°F. The Joshua tree is not a tree, and this is not a road.',
  },
  {
    id: 'appalachian_trail',
    name: 'Appalachian Trail',
    style: 'ink',
    biome: 'forest',
    description: '2,190 miles from Georgia to Maine.',
    distanceLabel: '2,190 mi',
    steps: 5000000,
    funFact: 'Most thru-hikers take 5–7 months. You are attempting this with your thumbs.',
  },
];
