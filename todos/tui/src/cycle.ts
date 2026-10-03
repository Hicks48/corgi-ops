/** The item `delta` steps from `current`, wrapping around. */
export const cycle = <T,>(items: readonly T[], current: T, delta: number): T =>
  items[(items.indexOf(current) + delta + items.length) % items.length]!
