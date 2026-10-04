import type { InputRenderable, KeyEvent, TextareaRenderable } from "@opentui/core"
import { useRef, useState } from "react"
import {
  applyTemplate,
  formatLocalDateTime,
  shortId,
  STATUS_LABELS,
  STATUSES,
  type Comment,
  type CommentInput,
  type LocalDate,
  type NewTask,
  type Status,
  type Task,
  type Template,
} from "@corgiops/todos-core"
import { cycle } from "./cycle.ts"
import { DateInput } from "./DateInput.tsx"
import { boxId, DetailsForm, textboxHeight, type FocusId, type FormApi, type FormValues } from "./DetailsForm.tsx"
import type { System } from "./system.ts"
import { STATUS_BADGES, STATUS_COLORS, theme } from "./theme.ts"

export type TaskValues = Required<Pick<NewTask, "title" | "description" | "status" | "targetDate" | "parentId">> &
  Pick<NewTask, "completionDate"> &
  FormValues & {
    /** Whole comment list for `update`; only for an existing task. */
    comments?: CommentInput[]
  }

interface TaskDetailsProps {
  /** Task being viewed/edited; omit to create a new one. */
  task?: Task
  /** The saved task's parent, if it has one. */
  parent?: Task
  /** The saved task's subtasks. */
  subtasks: Task[]
  /** Offered in a picker when creating a task. */
  templates: Template[]
  today: LocalDate
  system: System
  /** Rejecting keeps the view open and shows the error. */
  onSave: (values: TaskValues) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
  /** Opens a parent or subtask. Leaves unsaved edits behind, like closing. */
  onOpenTask: (task: Task) => void
}

const subtaskId = (task: Task): FocusId => `subtask:${task.id}`
const commentId = (comment: Comment): FocusId => `comment:${comment.id}`
const NEW_COMMENT: FocusId = "comment:new"

const PICKER_ROWS = 8

export function TaskDetails({ task, parent, subtasks, templates, today, system, onSave, onDelete, onClose, onOpenTask }: TaskDetailsProps) {
  const [status, setStatus] = useState<Status>(task?.status ?? "todo")
  const [picking, setPicking] = useState(false)
  const [pickIndex, setPickIndex] = useState(0)
  const [applied, setApplied] = useState<string | null>(null)
  const targetRef = useRef<InputRenderable>(null)
  const completionRef = useRef<InputRenderable>(null)
  const parentRef = useRef<InputRenderable>(null)
  // Removals are staged until save, like custom fields.
  const [comments, setComments] = useState<Comment[]>(task?.comments ?? [])
  const commentRefs = useRef(new Map<string, TextareaRenderable>())
  const newCommentRef = useRef<TextareaRenderable>(null)

  const canPick = !task && templates.length > 0
  const topIds: FocusId[] = [
    ...(canPick ? ["template"] : []),
    "status",
    ...(status === "done" ? ["completionDate"] : []),
    "targetDate",
    ...(task ? ["id"] : []),
    "parent",
  ]

  const save = (values: FormValues) =>
    onSave({
      ...values,
      status,
      targetDate: targetRef.current?.value.trim() ?? "",
      completionDate: status === "done" ? completionRef.current?.value.trim() : undefined,
      parentId: parentRef.current?.value.trim() || null,
      comments: task ? commentValues() : undefined,
    })

  // Read from the widgets at save time; an empty new-comment box adds nothing.
  const commentValues = (): CommentInput[] => {
    const added = newCommentRef.current?.plainText ?? ""
    return [
      ...comments.map((c) => ({ id: c.id, text: commentRefs.current.get(c.id)?.plainText ?? c.text })),
      ...(added.trim() ? [{ text: added }] : []),
    ]
  }

  const removeComment = (api: FormApi, comment: Comment) => {
    const index = comments.indexOf(comment)
    setComments(comments.filter((c) => c !== comment))
    const next = comments[index + 1] ?? comments[index - 1]
    api.setFocus(next ? commentId(next) : NEW_COMMENT)
    api.setNotice("Removed comment (ctrl+s to save, esc to discard)")
  }

  const copyId = (api: FormApi) => {
    if (!task) return
    system.copy(task.id).then(
      () => api.setNotice("Copied task id"),
      (err: Error) => api.setError(err.message),
    )
  }

  const pick = (api: FormApi, template: Template) => {
    api.replace(applyTemplate(api.values(), template))
    setApplied(template.name)
    setPicking(false)
    api.setFocus("title")
  }

  const onKey = (key: KeyEvent, api: FormApi) => {
    if (picking) {
      if (key.name === "escape") return setPicking(false)
      if (key.name === "up" || key.name === "k") return setPickIndex(Math.max(0, pickIndex - 1))
      if (key.name === "down" || key.name === "j") return setPickIndex(Math.min(templates.length - 1, pickIndex + 1))
      if (key.name === "return") return pick(api, templates[pickIndex]!)
      return
    }
    if (api.focus === "template" && (key.name === "return" || key.name === "space")) return setPicking(true)
    if (key.ctrl && key.name === "p" && parent) return onOpenTask(parent)
    const subtask = subtasks.find((t) => subtaskId(t) === api.focus)
    if (subtask && key.name === "return") return onOpenTask(subtask)
    const comment = comments.find((c) => commentId(c) === api.focus)
    if (comment && key.ctrl && key.name === "x") return removeComment(api, comment)
    if (key.ctrl && key.name === "y" && api.focus === "id") return copyId(api)
    if (api.focus === "status" && (key.name === "left" || key.name === "right" || key.name === "space")) {
      setStatus(cycle(STATUSES, status, key.name === "left" ? -1 : 1))
    }
  }

  // Scroll the picker so the highlighted template stays in view.
  const pickStart = Math.max(0, pickIndex - PICKER_ROWS + 1)

  const renderTop = (api: FormApi) => (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1}>
        {canPick ? (
          <box
            title=" Template "
            border
            borderColor={picking ? theme.accent : api.borderColor("template")}
            height={3}
            width={24}
            paddingLeft={1}
            onMouseDown={() => {
              api.setFocus("template")
              setPicking(!picking)
            }}
          >
            <text fg={applied ? theme.text : theme.dim} wrapMode="none" truncate>
              {`${applied ?? "none"} ▾`}
            </text>
          </box>
        ) : null}
        <box
          title=" Status "
          border
          borderColor={api.borderColor("status")}
          height={3}
          width={19}
          paddingLeft={1}
          onMouseDown={() => {
            api.setFocus("status")
            setStatus(cycle(STATUSES, status, 1))
          }}
        >
          <text fg={STATUS_COLORS[status]}>{`‹ ${STATUS_LABELS[status]} ›`}</text>
        </box>
        {status === "done" ? (
          <box
            title=" Completed "
            border
            borderColor={api.borderColor("completionDate")}
            height={3}
            width={18}
            paddingLeft={1}
            onMouseDown={() => api.setFocus("completionDate")}
          >
            <DateInput ref={completionRef} value={task?.completionDate ?? today} focused={api.focused("completionDate")} />
          </box>
        ) : null}
        <box
          title=" Target date "
          border
          borderColor={api.borderColor("targetDate")}
          height={3}
          width={18}
          paddingLeft={1}
          onMouseDown={() => api.setFocus("targetDate")}
        >
          <DateInput ref={targetRef} value={task?.targetDate ?? today} focused={api.focused("targetDate")} />
        </box>
      </box>
      <box flexDirection="row" gap={1}>
        {task ? (
          <box
            title=" Id "
            border
            borderColor={api.borderColor("id")}
            flexDirection="row"
            gap={1}
            height={3}
            width={21}
            paddingLeft={1}
            onMouseDown={() => api.setFocus("id")}
          >
            <text fg={theme.dim}>{shortId(task.id)}</text>
            <box
              onMouseDown={(event) => {
                event.stopPropagation()
                copyId(api)
              }}
            >
              <text fg={api.focus === "id" ? theme.accent : theme.dim}>[ copy ]</text>
            </box>
          </box>
        ) : null}
        <box
          title={parent ? ` Parent · ${parent.title} ` : " Parent "}
          border
          borderColor={api.borderColor("parent")}
          flexDirection="row"
          gap={1}
          height={3}
          flexGrow={1}
          paddingLeft={1}
          onMouseDown={() => api.setFocus("parent")}
        >
          <input
            ref={parentRef}
            value={task?.parentId ?? ""}
            placeholder="Optional; id of the parent task"
            focused={api.focused("parent")}
            flexGrow={1}
          />
          {parent ? (
            <box
              flexShrink={0}
              onMouseDown={(event) => {
                event.stopPropagation()
                onOpenTask(parent)
              }}
            >
              <text fg={api.focus === "parent" ? theme.accent : theme.dim}>[ open ]</text>
            </box>
          ) : null}
        </box>
      </box>
      {picking ? (
        <box
          title=" Pick a template · ↑↓ enter esc "
          border
          borderColor={theme.accent}
          flexDirection="column"
          width={48}
          paddingLeft={1}
        >
          {templates.slice(pickStart, pickStart + PICKER_ROWS).map((t) => (
            <box key={t.id} onMouseDown={() => pick(api, t)} backgroundColor={t === templates[pickIndex] ? theme.accent : undefined}>
              <text fg={t === templates[pickIndex] ? theme.onAccent : theme.text} wrapMode="none" truncate>
                {t.title ? `${t.name} · ${t.title}` : t.name}
              </text>
            </box>
          ))}
        </box>
      ) : null}
    </box>
  )

  const renderSubtasks = (api: FormApi) =>
    subtasks.length ? (
      <box title=" Subtasks " border borderColor={theme.border} flexDirection="column" flexShrink={0} paddingLeft={1} paddingRight={1}>
        {subtasks.map((t) => {
          const id = subtaskId(t)
          const active = api.focused(id)
          return (
            <box
              key={t.id}
              id={boxId(id)}
              flexDirection="row"
              gap={1}
              backgroundColor={active ? theme.accent : undefined}
              onMouseDown={() => api.setFocus(id)}
            >
              <text fg={active ? theme.onAccent : STATUS_COLORS[t.status]} flexShrink={0}>
                {STATUS_BADGES[t.status]}
              </text>
              <text fg={active ? theme.onAccent : theme.text} wrapMode="none" truncate flexGrow={1} flexShrink={1}>
                {t.title}
              </text>
              <box
                flexShrink={0}
                onMouseDown={(event) => {
                  event.stopPropagation()
                  onOpenTask(t)
                }}
              >
                <text fg={active ? theme.onAccent : theme.dim}>[ open ]</text>
              </box>
            </box>
          )
        })}
      </box>
    ) : null

  const renderComments = (api: FormApi) => (
    <>
      {comments.map((c) => {
        const id = commentId(c)
        const edited = c.updatedAt === c.createdAt ? "" : ` · edited ${formatLocalDateTime(c.updatedAt)}`
        return (
          <box
            key={c.id}
            id={boxId(id)}
            title={` Comment · ${formatLocalDateTime(c.createdAt)}${edited} `}
            border
            borderColor={api.borderColor(id)}
            height={textboxHeight(c.text)}
            flexShrink={0}
            paddingLeft={1}
            onMouseDown={() => api.setFocus(id)}
          >
            <textarea
              ref={(widget: TextareaRenderable | null) => {
                if (widget) commentRefs.current.set(c.id, widget)
                else commentRefs.current.delete(c.id)
              }}
              initialValue={c.text}
              focused={api.focused(id)}
              wrapMode="word"
              flexGrow={1}
            />
          </box>
        )
      })}
      <box
        id={boxId(NEW_COMMENT)}
        title=" New comment "
        border
        borderColor={api.borderColor(NEW_COMMENT)}
        height={4}
        flexShrink={0}
        paddingLeft={1}
        onMouseDown={() => api.setFocus(NEW_COMMENT)}
      >
        <textarea
          ref={newCommentRef}
          placeholder="Progress note; saved with ctrl+s"
          focused={api.focused(NEW_COMMENT)}
          wrapMode="word"
          flexGrow={1}
        />
      </box>
    </>
  )

  return (
    <DetailsForm
      header={task ? `Task ${shortId(task.id)}` : "New Task"}
      system={system}
      initial={{ title: task?.title ?? "", description: task?.description ?? "", fields: task?.fields ?? [] }}
      topIds={topIds}
      renderTop={renderTop}
      aboveDescription={{ ids: subtasks.map(subtaskId), render: renderSubtasks }}
      belowDescription={task ? { ids: [...comments.map(commentId), NEW_COMMENT], render: renderComments } : undefined}
      onKey={onKey}
      suspended={picking}
      // Locked once saved; a new non-editable field can still be filled in before the first save.
      isLocked={(f) => !f.editable && task?.fields.some((saved) => saved.name === f.name) === true}
      textPlaceholder="Required"
      onSave={save}
      onDelete={task ? { prompt: `Delete "${task.title}"`, run: onDelete } : undefined}
      onClose={onClose}
      hints={(focus) => [
        ...(canPick ? ["enter pick template"] : []),
        "←→ status",
        ...(focus === "id" ? ["ctrl+y copy id"] : []),
        ...(parent ? ["ctrl+p open parent"] : []),
        ...(focus.startsWith("subtask:") ? ["enter open subtask"] : []),
        ...(focus.startsWith("comment:") && focus !== NEW_COMMENT ? ["ctrl+x remove comment"] : []),
      ]}
      meta={task ? `Created ${formatLocalDateTime(task.createdAt)} · Updated ${formatLocalDateTime(task.updatedAt)}` : undefined}
    />
  )
}
