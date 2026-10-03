#!/usr/bin/env bun
import { parseArgs } from "node:util"
import {
  STATUS_LABELS,
  STATUSES,
  TodoError,
  TodoStore,
  VIEWS,
  type Status,
  type Task,
  type View,
} from "@corgiops/todos-core"

const USAGE = `corgi-todos - manage todos in ~/.corgiops/todos

Usage:
  corgi-todos list [--view <view>] [--status <status>]
  corgi-todos show <id>
  corgi-todos add --title <text> --description <text> [--status <status>] [--target-date <date>]
  corgi-todos update <id> [--title <text>] [--description <text>] [--status <status>]
                          [--target-date <date>] [--completion-date <date>]
  corgi-todos status <id> <status>
  corgi-todos postpone <id>     Set target date to tomorrow
  corgi-todos pull <id>         Set target date to today
  corgi-todos reopen <id>       Mark a done task in-progress for today
  corgi-todos rm <id>

Options:
  --json        Print JSON instead of text
  -h, --help    Show this help

Views:    ${VIEWS.join(", ")}
Statuses: ${STATUSES.join(", ")}
Dates:    YYYY-MM-DD; target date defaults to today, completion date is set when a task is done`

class UsageError extends Error {}

const parseId = (raw: string | undefined): number => {
  const id = Number(raw)
  if (!raw || !Number.isInteger(id) || id <= 0) throw new UsageError(`invalid task id: ${raw ?? "(missing)"}`)
  return id
}

const parseStatus = (raw: string | undefined): Status => {
  if (!STATUSES.includes(raw as Status)) {
    throw new UsageError(`invalid status: ${raw ?? "(missing)"} (expected ${STATUSES.join(", ")})`)
  }
  return raw as Status
}

const parseView = (raw: string | undefined): View | undefined => {
  if (raw === undefined) return undefined
  if (!VIEWS.includes(raw as View)) throw new UsageError(`invalid view: ${raw} (expected ${VIEWS.join(", ")})`)
  return raw as View
}

const formatLine = (t: Task) =>
  `${String(t.id).padStart(4)}  ${STATUS_LABELS[t.status].padEnd(11)}  ${t.completionDate ?? t.targetDate}  ${t.title}`

const formatDetail = (t: Task) =>
  [
    `#${t.id} ${t.title}`,
    `Status:  ${STATUS_LABELS[t.status]}`,
    `Target:  ${t.targetDate}`,
    ...(t.completionDate ? [`Done:    ${t.completionDate}`] : []),
    `Created: ${t.createdAt}`,
    `Updated: ${t.updatedAt}`,
    "",
    t.description,
  ].join("\n")

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string" },
      view: { type: "string" },
      "target-date": { type: "string" },
      "completion-date": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  })
  const [command, ...args] = positionals
  if (values.help || !command) {
    console.log(USAGE)
    return
  }

  const store = new TodoStore()
  const status = values.status === undefined ? undefined : parseStatus(values.status)
  const view = parseView(values.view)
  const targetDate = values["target-date"]
  const completionDate = values["completion-date"]
  const print = (result: Task | Task[], text: string) => console.log(values.json ? JSON.stringify(result, null, 2) : text)
  const printTask = (task: Task, verb: string) => print(task, `${verb} #${task.id} ${task.title}`)

  switch (command) {
    case "list":
    case "ls": {
      const tasks = await store.list({ status, view })
      print(tasks, tasks.length ? tasks.map(formatLine).join("\n") : "No tasks.")
      return
    }
    case "show": {
      const task = await store.get(parseId(args[0]))
      print(task, formatDetail(task))
      return
    }
    case "add": {
      if (values.title === undefined || values.description === undefined) {
        throw new UsageError("add requires --title and --description")
      }
      const input = { title: values.title, description: values.description, status, targetDate, completionDate }
      printTask(await store.add(input), "Added")
      return
    }
    case "update": {
      const patch = { title: values.title, description: values.description, status, targetDate, completionDate }
      if (Object.values(patch).every((v) => v === undefined)) {
        throw new UsageError("update requires at least one field option")
      }
      printTask(await store.update(parseId(args[0]), patch), "Updated")
      return
    }
    case "status": {
      const task = await store.setStatus(parseId(args[0]), parseStatus(args[1]))
      print(task, `#${task.id} -> ${STATUS_LABELS[task.status]}`)
      return
    }
    case "postpone": {
      const task = await store.postpone(parseId(args[0]))
      print(task, `#${task.id} target -> ${task.targetDate}`)
      return
    }
    case "pull": {
      const task = await store.pullToToday(parseId(args[0]))
      print(task, `#${task.id} target -> ${task.targetDate}`)
      return
    }
    case "reopen": {
      printTask(await store.reopen(parseId(args[0])), "Reopened")
      return
    }
    case "rm":
    case "delete": {
      printTask(await store.remove(parseId(args[0])), "Removed")
      return
    }
    default:
      throw new UsageError(`unknown command: ${command}`)
  }
}

try {
  await main(process.argv.slice(2))
} catch (err) {
  // parseArgs throws TypeError with a code for bad flags.
  const isUsage = err instanceof UsageError || (err as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
  if (!isUsage && !(err instanceof TodoError)) throw err
  console.error(`error: ${(err as Error).message}`)
  if (isUsage) console.error(`\n${USAGE}`)
  process.exit(isUsage ? 2 : 1)
}
