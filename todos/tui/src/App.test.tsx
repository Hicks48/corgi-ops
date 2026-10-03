import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { formatLocalDateTime, TodoStore } from "@corgiops/todos-core"
import { App } from "./App.tsx"
import type { System } from "./system.ts"

let root: string
let store: TodoStore
let ui: Awaited<ReturnType<typeof testRender>>
let exited = false
let effects: string[] = []
const system: System = {
  copy: async (text) => void effects.push(`copy ${text}`),
  open: async (url) => void effects.push(`open ${url}`),
}

// Local noon, so "today" is stable regardless of time zone.
const now = () => new Date(2026, 9, 3, 12)

const mount = async () => {
  ui = await testRender(<App store={store} system={system} onExit={() => (exited = true)} />, { width: 80, height: 30 })
  // Store calls resolve outside act(); let React schedule those updates normally.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
}

/**
 * Waits for `text` to be on screen (or gone, with `absent`). Polls on real time rather than
 * render passes, since store I/O and React's scheduler both need the event loop to turn.
 */
const see = async (text: string, absent = false) => {
  const deadline = Date.now() + 2000
  for (;;) {
    await ui.flush()
    const frame = ui.captureCharFrame()
    if (frame.includes(text) !== absent) {
      // Let React commit effects (e.g. rebinding key handlers) before the next input.
      await Bun.sleep(10)
      return frame
    }
    if (Date.now() > deadline) throw new Error(`"${text}" never ${absent ? "disappeared" : "appeared"}:\n${frame}`)
    await Bun.sleep(5)
  }
}
const gone = (text: string) => see(text, true)

/** Screen position of the first occurrence of `text`. */
const locate = (text: string) => {
  const rows = ui.captureCharFrame().split("\n")
  const y = rows.findIndex((row) => row.includes(text))
  if (y < 0) throw new Error(`"${text}" not on screen`)
  return { x: rows[y]!.indexOf(text), y }
}

const save = () => ui.mockInput.pressKey("s", { ctrl: true })
const settle = () => Bun.sleep(10)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "corgiops-"))
  store = new TodoStore({ dir: join(root, "todos"), now })
  exited = false
  effects = []
})

afterEach(async () => {
  ui.renderer.destroy()
  await rm(root, { recursive: true, force: true })
})

test("opens on current tasks, in-progress first", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await store.add({ title: "Feed corgi", description: "Kibble", status: "in-progress", targetDate: "2026-10-01" })
  await store.add({ title: "Groom corgi", description: "Later", targetDate: "2026-10-09" })
  await store.add({ title: "Bathe corgi", description: "Done", status: "done" })
  await mount()

  const frame = await see("Walk corgi")
  expect(frame).toContain("Current Tasks")
  expect(frame).toContain("2 tasks · 2026-10-03")
  expect(frame).not.toContain("Groom corgi")
  expect(frame).not.toContain("Bathe corgi")
  expect(frame.indexOf("Feed corgi")).toBeLessThan(frame.indexOf("Walk corgi"))
  expect(frame).toContain("[ +1 day ]")
})

test("descriptions are cut to 3 lines", async () => {
  await store.add({ title: "Long", description: "one\ntwo\nthree\nfour\nfive" })
  await mount()
  const frame = await see("three")
  expect(frame).not.toContain("four")
})

test("[ and ] switch between views", async () => {
  await store.add({ title: "Groom corgi", description: "Later", targetDate: "2026-10-09" })
  await store.add({ title: "Bathe corgi", description: "Done", status: "done" })
  await mount()
  await see("Nothing on for today")

  ui.mockInput.pressKey("]")
  const upcoming = await see("Groom corgi")
  expect(upcoming).toContain("[ Pull to today ]")
  expect(upcoming).toContain("2026-10-09")
  ui.mockInput.pressKey("]")
  await settle()
  await see("Groom corgi") // already on the last view
  ui.mockInput.pressKey("[")
  await see("Nothing on for today")
  ui.mockInput.pressKey("[")
  expect(await see("Bathe corgi")).toContain("[ Reopen ]")
})

test("left and right arrows switch views too", async () => {
  await store.add({ title: "Groom corgi", description: "Later", targetDate: "2026-10-09" })
  await mount()
  await see("Nothing on for today")
  ui.mockInput.pressArrow("right")
  await see("Groom corgi")
  ui.mockInput.pressArrow("left")
  await see("Nothing on for today")
})

test("view actions: +1 day, pull to today, reopen", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await store.add({ title: "Bathe corgi", description: "Done", status: "done" })
  await mount()
  await see("Walk corgi")

  ui.mockInput.pressKey("+")
  await see("Nothing on for today")
  expect((await store.get(1)).targetDate).toBe("2026-10-04")

  ui.mockInput.pressKey("]")
  await see("Walk corgi")
  ui.mockInput.pressKey("t")
  await see("No upcoming tasks")
  expect((await store.get(1)).targetDate).toBe("2026-10-03")

  ui.mockInput.pressKey("[")
  await see("Walk corgi")
  ui.mockInput.pressKey("[")
  await see("Bathe corgi")
  ui.mockInput.pressKey("r")
  await see("No completed tasks yet")
  expect(await store.get(2)).toMatchObject({ status: "in-progress", targetDate: "2026-10-03" })
})

test("action buttons, cards and tabs respond to the mouse", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await store.add({ title: "Feed corgi", description: "Kibble" })
  await mount()
  await see("Feed corgi")

  // Second card's button.
  const rows = ui.captureCharFrame().split("\n")
  const y = rows.findIndex((row) => row.includes("Feed corgi"))
  await ui.mockMouse.click(rows[y]!.indexOf("[ +1 day ]") + 2, y)
  await gone("Feed corgi")
  expect((await store.get(2)).targetDate).toBe("2026-10-04")

  const tab = locate("Upcoming Tasks")
  await ui.mockMouse.click(tab.x + 1, tab.y)
  await see("Feed corgi")
  const back = locate("Current Tasks")
  await ui.mockMouse.click(back.x + 1, back.y)
  await see("Walk corgi")

  // Clicking the selected card opens it.
  const title = locate("Walk corgi")
  await ui.mockMouse.click(title.x, title.y)
  await see("Task #1")
})

test("clicking a card selects it", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await store.add({ title: "Feed corgi", description: "Kibble" })
  await mount()
  await see("Feed corgi")

  const desc = locate("Kibble")
  await ui.mockMouse.click(desc.x, desc.y)
  await settle()
  ui.mockInput.pressEnter()
  expect(await see("Task #2")).toContain("Kibble")
})

test("lists show visible custom fields with copy / open buttons", async () => {
  await store.add({
    title: "Review PR",
    description: "Check it",
    fields: [
      { type: "link", name: "PR", value: "https://example.com/1", visibleOnLists: true },
      { type: "text", name: "Notes", value: "first\nsecond", visibleOnLists: true },
      { type: "text", name: "Secret", value: "hidden" },
    ],
  })
  await mount()
  const frame = await see("PR: https://example.com/1")
  expect(frame).toContain("Notes: first second")
  expect(frame).not.toContain("hidden")

  const pr = locate("PR: https://example.com/1")
  const row = ui.captureCharFrame().split("\n")[pr.y]!
  await ui.mockMouse.click(row.indexOf("[ open ]") + 2, pr.y)
  await see("Opened PR")
  await ui.mockMouse.click(row.indexOf("[ copy ]") + 2, pr.y)
  await see("Copied PR")
  expect(effects).toEqual(["open https://example.com/1", "copy https://example.com/1"])
})

test("clicking a field in the details view focuses it", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see("Task #1")

  const target = locate("2026-10-03")
  await ui.mockMouse.click(target.x + 2, target.y)
  await settle()
  ui.mockInput.pressKey("END")
  ui.mockInput.pressKey("BACKSPACE")
  await ui.mockInput.typeText("5")
  const description = locate("Around the block")
  await ui.mockMouse.click(description.x + 3, description.y + 1)
  await settle()
  ui.mockInput.pressKey("END")
  await ui.mockInput.typeText("!")
  save()
  await see("[ Pull to today ]")
  expect(await store.get(1)).toMatchObject({ targetDate: "2026-10-05", description: "Around the block!" })
})

test("adds, edits and removes custom fields in the details view", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see("Task #1")

  ui.mockInput.pressKey("n", { ctrl: true })
  await see("New field")
  ui.mockInput.pressEnter()
  await see("field name is required")
  await ui.mockInput.typeText("Route")
  ui.mockInput.pressTab({ shift: true }) // type
  await settle()
  ui.mockInput.pressArrow("right") // link
  await see("‹ link ›")
  ui.mockInput.pressTab() // name
  await settle()
  ui.mockInput.pressTab() // editable
  await settle()
  ui.mockInput.pressKey(" ")
  await see("[ ] editable")
  ui.mockInput.pressTab() // visible on lists
  await settle()
  ui.mockInput.pressKey(" ")
  await see("[x] visible on lists")
  ui.mockInput.pressEnter()
  await gone("New field")
  await see("Route · link")

  // The new field has focus; a non-editable field can be filled in until it is saved.
  await ui.mockInput.typeText("https://maps.example/park")
  ui.mockInput.pressKey("y", { ctrl: true })
  await see("Copied Route")
  expect(effects).toEqual(["copy https://maps.example/park"])
  save()

  expect(await see("Route: https://maps.example/park")).toContain("[ open ]")
  expect((await store.get(1)).fields).toEqual([
    { type: "link", name: "Route", value: "https://maps.example/park", editable: false, visibleOnLists: true },
  ])

  // Locked now: shown read-only, but it can be removed.
  ui.mockInput.pressEnter()
  await see("Route · link · locked")
  const route = locate("https://maps.example/park")
  await ui.mockMouse.click(route.x, route.y)
  await see("ctrl+x remove field")
  ui.mockInput.pressKey("x", { ctrl: true })
  await gone("Route · link")
  save()
  await see("[ +1 day ]")
  expect((await store.get(1)).fields).toEqual([])
})

test("editable custom fields save their typed value", async () => {
  await store.add({
    title: "Walk corgi",
    description: "Around the block",
    fields: [{ type: "date", name: "Vet", value: "2026-10-09" }],
  })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see("Vet · date")
  ui.mockInput.pressTab() // title -> Vet
  await settle()
  ui.mockInput.pressKey("END")
  ui.mockInput.pressKey("BACKSPACE")
  await ui.mockInput.typeText("8")
  save()
  await see("[ +1 day ]")
  expect((await store.get(1)).fields[0]!.value).toBe("2026-10-08")

  ui.mockInput.pressEnter()
  await see("Vet · date")
  ui.mockInput.pressTab()
  await settle()
  await ui.mockInput.typeText("x")
  save()
  await see("date fields must be YYYY-MM-DD")
})

test("adds a task from any view with todo / today defaults", async () => {
  await mount()
  await see("Nothing on for today")
  ui.mockInput.pressKey("[")
  await see("No completed tasks yet")

  ui.mockInput.pressKey("a")
  const form = await see("New Task")
  expect(form).toContain("‹ Todo ›")
  expect(form).toContain("2026-10-03")
  expect(form).not.toContain("ctrl+d delete")
  await ui.mockInput.typeText("Brush corgi")
  ui.mockInput.pressEnter() // enter in the title moves to the description
  await settle()
  await ui.mockInput.typeText("Lots of fur")
  save()

  // Lands in the view the new task belongs to. (The title is also visible in the form, so wait on the list.)
  const frame = await see("[ +1 day ]")
  expect(frame).toContain("Brush corgi")
  expect(frame).toContain("1 task · 2026-10-03")
  expect(await store.list()).toMatchObject([
    { title: "Brush corgi", description: "Lots of fur", status: "todo", targetDate: "2026-10-03" },
  ])
})

test("required fields keep the details view open", async () => {
  await mount()
  await see("Nothing on for today")
  ui.mockInput.pressKey("a")
  await see("New Task")
  await ui.mockInput.typeText("No description")
  save()
  await see("description is required")
  expect(await store.list()).toEqual([])
})

test("edits status, completion and target date in the details view", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")

  ui.mockInput.pressEnter()
  const details = await see("Task #1")
  expect(details).toContain("Around the block")
  const created = formatLocalDateTime((await store.get(1)).createdAt)
  expect(details).toContain(`Created ${created} · Updated ${created}`)
  expect(details).not.toContain(" Completed ")

  // title -> target date -> status
  ui.mockInput.pressTab({ shift: true })
  await settle()
  ui.mockInput.pressTab({ shift: true })
  await settle()
  ui.mockInput.pressArrow("left")
  await see("‹ Done ›")
  await see(" Completed ")
  save()

  expect(await see("[ Reopen ]")).toContain("Walk corgi")
  expect(await store.get(1)).toMatchObject({ status: "done", completionDate: "2026-10-03" })

  // Back to todo and into the future: lands in upcoming.
  ui.mockInput.pressEnter()
  await see("Task #1")
  ui.mockInput.pressTab({ shift: true }) // target date
  await settle()
  ui.mockInput.pressTab({ shift: true }) // completion date
  await settle()
  ui.mockInput.pressTab({ shift: true }) // status
  await settle()
  ui.mockInput.pressArrow("right")
  await see("‹ Todo ›")
  ui.mockInput.pressTab() // target date (completion field is gone)
  await settle()
  ui.mockInput.pressKey("END")
  ui.mockInput.pressKey("BACKSPACE")
  ui.mockInput.pressKey("BACKSPACE")
  await ui.mockInput.typeText("10")
  save()

  await see("[ Pull to today ]")
  const task = await store.get(1)
  expect(task).toMatchObject({ status: "todo", targetDate: "2026-10-10" })
  expect(task.completionDate).toBeUndefined()
})

test("rejects a malformed date", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see("Task #1")
  ui.mockInput.pressTab({ shift: true })
  await settle()
  await ui.mockInput.typeText("x")
  save()
  await see("must be a date")
  expect((await store.get(1)).targetDate).toBe("2026-10-03")
})

test("deletes only from the details view, after confirming", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")

  ui.mockInput.pressKey("d")
  await Bun.sleep(30)
  expect(await store.list()).toHaveLength(1)

  ui.mockInput.pressEnter()
  await see("Task #1")
  ui.mockInput.pressKey("d", { ctrl: true })
  await see("y to confirm")
  ui.mockInput.pressKey("n")
  await gone("y to confirm")
  expect(await store.list()).toHaveLength(1)

  ui.mockInput.pressKey("d", { ctrl: true })
  await see("y to confirm")
  ui.mockInput.pressKey("y")
  await see("Nothing on for today")
  expect(await store.list()).toEqual([])
})

test("esc leaves the details view without saving", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see("Task #1")
  await ui.mockInput.typeText(" changed")
  ui.mockInput.pressEscape()
  await see("Current Tasks")
  expect((await store.get(1)).title).toBe("Walk corgi")
})

test("picks up changes written by another process", async () => {
  await mount()
  await see("Nothing on for today")
  await new TodoStore({ dir: store.dir, now }).add({ title: "From the CLI", description: "x" })
  await see("From the CLI")
})

test("q exits", async () => {
  await mount()
  await see("Current Tasks")
  ui.mockInput.pressKey("q")
  await ui.flush()
  expect(exited).toBe(true)
})
