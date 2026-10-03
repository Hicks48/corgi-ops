import { theme } from "./theme.ts"

/** Footer key hints; wraps between hints, never inside one. */
export function Hints({ hints }: { hints: string[] }) {
  return (
    <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0} paddingLeft={1}>
      {hints.map((hint) => (
        <text key={hint} fg={theme.dim}>
          {hint}
        </text>
      ))}
    </box>
  )
}
