import type { Deck } from "../engine/deck";

const n = (id: number, k: number) => Array<number>(k).fill(id);

/** 示例：Snake-Eye Fiendsmith，只是为了能马上试用，不是推荐构筑。 */
export const SAMPLE_DECK: Deck = {
  main: [
    ...n(9674034, 3), // Snake-Eye Ash
    ...n(90241276, 3), // Snake-Eyes Poplar
    ...n(45663742, 1), // Snake-Eye Oak
    ...n(12058741, 1), // Snake-Eye Birch
    ...n(48452496, 1), // Snake-Eyes Flamberge Dragon
    ...n(72270339, 2), // Diabellstar the Black Witch
    ...n(89023486, 3), // Original Sinful Spoils - Snake-Eye
    ...n(24081957, 1), // Sinful Spoils of Subversion - Snake-Eye
    ...n(80845034, 1), // WANTED: Seeker of Sinful Spoils
    ...n(53639887, 1), // Divine Temple of the Snake-Eye
    ...n(60764609, 3), // Fiendsmith Engraver
    ...n(98567237, 1), // Fiendsmith's Tract
    ...n(28803166, 1), // Lacrima the Crimson Tears
    ...n(97651498, 1), // Fabled Lurrie
    ...n(14558127, 3), // Ash Blossom & Joyous Spring
    ...n(23434538, 3), // Maxx "C"
    ...n(10045474, 3), // Infinite Impermanence
    ...n(24224830, 2), // Called by the Grave
    ...n(65681983, 1), // Crossout Designator
    ...n(25311006, 2), // Triple Tactics Talent
    ...n(42141493, 3), // Mulcharmy Fuwalos
  ],
  extra: [
    2772337, // Promethean Princess, Bestower of Flames
    ...n(2463794, 2), // Fiendsmith's Requiem
    49867899, // Fiendsmith's Sequence
    82135803, // Fiendsmith's Desirae
    46640168, // Fiendsmith's Lacrima
    93860227, // Necroquip Princess
    65741786, // I:P Masquerena
    29301450, // S:P Little Knight
    71818935, // Moon of the Closed Heaven
    60303245, // Salamangreat Almiraj
    58071334, // Snake-Eyes Doomed Dragon
    50277355, // Cross-Sheep
  ],
  side: [],
};
