import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { formatLocalDateTime, shortId, TodoStore } from "@corgiops/todos-core"
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
const tabBack = async (times: number) => {
  for (let i = 0; i < times; i++) {
    ui.mockInput.pressTab({ shift: true })
    await settle()
  }
}

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
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  const task2 = await store.add({ title: "Bathe corgi", description: "Done", status: "done" })
  await mount()
  await see("Walk corgi")

  ui.mockInput.pressKey("+")
  await see("Nothing on for today")
  expect((await store.get(task1.id)).targetDate).toBe("2026-10-04")

  ui.mockInput.pressKey("]")
  await see("Walk corgi")
  ui.mockInput.pressKey("t")
  await see("No upcoming tasks")
  expect((await store.get(task1.id)).targetDate).toBe("2026-10-03")

  ui.mockInput.pressKey("[")
  await see("Walk corgi")
  ui.mockInput.pressKey("[")
  await see("Bathe corgi")
  ui.mockInput.pressKey("r")
  await see("No completed tasks yet")
  expect(await store.get(task2.id)).toMatchObject({ status: "in-progress", targetDate: "2026-10-03" })
})

test("action buttons, cards and tabs respond to the mouse", async () => {
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  const task2 = await store.add({ title: "Feed corgi", description: "Kibble" })
  await mount()
  await see("Feed corgi")

  // Second card's button.
  const rows = ui.captureCharFrame().split("\n")
  const y = rows.findIndex((row) => row.includes("Feed corgi"))
  await ui.mockMouse.click(rows[y]!.indexOf("[ +1 day ]") + 2, y)
  await gone("Feed corgi")
  expect((await store.get(task2.id)).targetDate).toBe("2026-10-04")

  const tab = locate("Upcoming Tasks")
  await ui.mockMouse.click(tab.x + 1, tab.y)
  await see("Feed corgi")
  const back = locate("Current Tasks")
  await ui.mockMouse.click(back.x + 1, back.y)
  await see("Walk corgi")

  // Clicking the selected card opens it.
  const title = locate("Walk corgi")
  await ui.mockMouse.click(title.x, title.y)
  await see(`Task ${shortId(task1.id)}`)
})

test("clicking a card selects it", async () => {
  await store.add({ title: "Walk corgi", description: "Around the block" })
  const task2 = await store.add({ title: "Feed corgi", description: "Kibble" })
  await mount()
  await see("Feed corgi")

  const desc = locate("Kibble")
  await ui.mockMouse.click(desc.x, desc.y)
  await settle()
  ui.mockInput.pressEnter()
  expect(await see(`Task ${shortId(task2.id)}`)).toContain("Kibble")
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
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task1.id)}`)

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
  expect(await store.get(task1.id)).toMatchObject({ targetDate: "2026-10-05", description: "Around the block!" })
})

test("adds, edits and removes custom fields in the details view", async () => {
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task1.id)}`)

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
  expect((await store.get(task1.id)).fields).toEqual([
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
  expect((await store.get(task1.id)).fields).toEqual([])
})

test("editable custom fields save their typed value", async () => {
  const task1 = await store.add({
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
  expect((await store.get(task1.id)).fields[0]!.value).toBe("2026-10-08")

  ui.mockInput.pressEnter()
  await see("Vet · date")
  ui.mockInput.pressTab()
  await settle()
  await ui.mockInput.typeText("x") // ignored
  ui.mockInput.pressKey("END")
  ui.mockInput.pressKey("BACKSPACE")
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
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")

  ui.mockInput.pressEnter()
  const details = await see(`Task ${shortId(task1.id)}`)
  expect(details).toContain("Around the block")
  const created = formatLocalDateTime((await store.get(task1.id)).createdAt)
  expect(details).toContain(`Created ${created} · Updated ${created}`)
  expect(details).not.toContain(" Completed ")

  await tabBack(4) // title -> parent -> id -> target date -> status
  ui.mockInput.pressArrow("left")
  await see("‹ Done ›")
  await see(" Completed ")
  save()

  expect(await see("[ Reopen ]")).toContain("Walk corgi")
  expect(await store.get(task1.id)).toMatchObject({ status: "done", completionDate: "2026-10-03" })

  // Back to todo and into the future: lands in upcoming.
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task1.id)}`)
  await tabBack(5) // parent, id, target date, completion date, status
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
  const task = await store.get(task1.id)
  expect(task).toMatchObject({ status: "todo", targetDate: "2026-10-10" })
  expect(task.completionDate).toBeUndefined()
})

test("rejects an incomplete date", async () => {
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task1.id)}`)
  await tabBack(3) // title -> parent -> id -> target date
  ui.mockInput.pressKey("END")
  ui.mockInput.pressKey("BACKSPACE")
  save()
  await see("must be a date")
  expect((await store.get(task1.id)).targetDate).toBe("2026-10-03")
})

test("date inputs only take YYYY-MM-DD", async () => {
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task1.id)}`)
  await tabBack(3) // title -> parent -> id -> target date
  ui.mockInput.pressKey("END")
  for (let i = 0; i < 10; i++) ui.mockInput.pressKey("BACKSPACE")
  await see("YYYY-MM-DD") // placeholder: empty
  await ui.mockInput.typeText("2026/1x012!")
  await see("2026-10-12")
  save()
  await see("[ Pull to today ]")
  expect((await store.get(task1.id)).targetDate).toBe("2026-10-12")
})

test("deletes only from the details view, after confirming", async () => {
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")

  ui.mockInput.pressKey("d")
  await Bun.sleep(30)
  expect(await store.list()).toHaveLength(1)

  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task1.id)}`)
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
  const task1 = await store.add({ title: "Walk corgi", description: "Around the block" })
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task1.id)}`)
  await ui.mockInput.typeText(" changed")
  ui.mockInput.pressEscape()
  await see("Current Tasks")
  expect((await store.get(task1.id)).title).toBe("Walk corgi")
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

test("p opens templates: add, edit and delete", async () => {
  await mount()
  await see("Nothing on for today")
  ui.mockInput.pressKey("p")
  await see("No templates yet")

  ui.mockInput.pressKey("a")
  await see("New Template")
  await ui.mockInput.typeText("Walk") // title has focus
  ui.mockInput.pressTab({ shift: true }) // name
  await settle()
  save()
  await see("template name is required")
  await ui.mockInput.typeText("Daily walk")
  ui.mockInput.pressKey("n", { ctrl: true })
  await see("New field")
  await ui.mockInput.typeText("Route")
  ui.mockInput.pressEnter()
  await see("Route · text")
  await ui.mockInput.typeText("Park")
  save()

  await see("Fields: Route")
  expect(await store.listTemplates()).toMatchObject([
    { name: "Daily walk", title: "Walk", description: "", fields: [{ name: "Route", value: "Park" }] },
  ])

  const [template] = await store.listTemplates()
  ui.mockInput.pressEnter()
  await see(`Template ${shortId(template!.id)}`)
  ui.mockInput.pressKey("d", { ctrl: true })
  await see('Delete template "Daily walk"? y to confirm')
  ui.mockInput.pressKey("y")
  await see("No templates yet")
  expect(await store.listTemplates()).toEqual([])

  ui.mockInput.pressEscape()
  await see("Nothing on for today")
})

test("a new task can start from a template", async () => {
  await store.addTemplate({
    name: "Walk",
    title: "Walk corgi",
    fields: [
      { type: "link", name: "Route", value: "https://maps.example/park" },
      { type: "text", name: "Notes" },
    ],
  })
  await store.addTemplate({ name: "Groom", title: "Groom corgi", description: "Brush and trim" })
  await mount()
  await see("Nothing on for today")

  ui.mockInput.pressKey("a")
  await see("New Task")
  await ui.mockInput.typeText("Mine")
  ui.mockInput.pressEnter() // description
  await settle()
  await ui.mockInput.typeText("My own description")
  await tabBack(5) // description -> title -> parent -> target date -> status -> template
  ui.mockInput.pressEnter()
  await see("Pick a template")
  ui.mockInput.pressArrow("down")
  await settle()
  ui.mockInput.pressEnter()
  const frame = await see("Route · link")
  expect(frame).toContain("Walk ▾")
  expect(frame).toContain("Walk corgi")
  // Empty template description leaves ours alone.
  expect(frame).toContain("My own description")
  save()

  await see("[ +1 day ]")
  const [task] = await store.list()
  expect(task).toMatchObject({ title: "Walk corgi", description: "My own description" })
  expect(task!.fields.map((f) => [f.name, f.value])).toEqual([
    ["Route", "https://maps.example/park"],
    ["Notes", ""],
  ])

  // Not offered when editing.
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(task!.id)}`)
  expect(ui.captureCharFrame()).not.toContain("Template")
})

test("sets a parent, copies the id, jumps between parent and subtasks", async () => {
  const parent = await store.add({ title: "Groom corgi", description: "All of it" })
  const child = await store.add({ title: "Brush corgi", description: "Coat" })
  await mount()
  await see("Brush corgi")

  ui.mockInput.pressArrow("down")
  await settle()
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(child.id)}`)
  await tabBack(1) // title -> parent
  await ui.mockInput.typeText(parent.id)
  save()
  await see("[ +1 day ]")
  expect((await store.get(child.id)).parentId).toBe(parent.id)

  ui.mockInput.pressEnter()
  await see("Parent · Groom corgi")
  await tabBack(2) // title -> parent -> id
  ui.mockInput.pressKey("y", { ctrl: true })
  await see("Copied task id")
  expect(effects).toEqual([`copy ${child.id}`])

  await ui.mockInput.typeText("ignored")
  ui.mockInput.pressKey("p", { ctrl: true })
  const frame = await see(`Task ${shortId(parent.id)}`)
  expect(frame).toContain("All of it")
  expect(frame).not.toContain("Parent ·")
  expect(frame).toContain("Subtasks")
  expect(frame).toContain("Brush corgi")

  // title -> subtask, enter opens it.
  ui.mockInput.pressTab()
  await settle()
  ui.mockInput.pressEnter()
  await see(`Task ${shortId(child.id)}`)
  ui.mockInput.pressKey("p", { ctrl: true })
  await see(`Task ${shortId(parent.id)}`)

  // Clicking the subtask's button opens it too.
  const sub = locate("Brush corgi")
  const row = ui.captureCharFrame().split("\n")[sub.y]!
  await ui.mockMouse.click(row.indexOf("[ open ]") + 2, sub.y)
  await see(`Task ${shortId(child.id)}`)
  ui.mockInput.pressKey("p", { ctrl: true })
  await see(`Task ${shortId(parent.id)}`)

  ui.mockInput.pressKey("d", { ctrl: true })
  await see("y to confirm")
  ui.mockInput.pressKey("y")
  await see("has 1 subtask")
})

test("adds, edits and removes comments, saved with the task", async () => {
  const task = await store.add({ title: "Walk corgi", description: "Around the block" })
  await store.addComment(task.id, "Leash found")
  await store.addComment(task.id, "Left home")
  await mount()
  await see("Walk corgi")
  ui.mockInput.pressEnter()
  const frame = await see("Leash found")
  expect(frame).toContain("Comment · 2026-10-03 12:00")

  // title -> description -> first comment
  ui.mockInput.pressTab()
  await settle()
  ui.mockInput.pressTab()
  await settle()
  ui.mockInput.pressKey("x", { ctrl: true })
  await see("Removed comment")
  await gone("Leash found")

  // Now on "Left home": edit it, then add one in the new-comment box.
  ui.mockInput.pressKey("END")
  await ui.mockInput.typeText(" at 9")
  ui.mockInput.pressTab()
  await settle()
  await ui.mockInput.typeText("Back home")
  save()
  await see("[ +1 day ]")
  expect((await store.get(task.id)).comments.map((c) => c.text)).toEqual(["Left home at 9", "Back home"])

  // esc discards a staged removal.
  ui.mockInput.pressEnter()
  await see("Back home")
  ui.mockInput.pressTab()
  await settle()
  ui.mockInput.pressTab()
  await settle()
  ui.mockInput.pressKey("x", { ctrl: true })
  await see("Removed comment")
  ui.mockInput.pressEscape()
  await see("Current Tasks")
  expect((await store.get(task.id)).comments).toHaveLength(2)
})
