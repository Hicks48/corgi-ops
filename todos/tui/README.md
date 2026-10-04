# TODOS TUI

## USAGE
The main views of the TUI are the list views presented below. When the TUI is opened it opens the current tasks list view to have the user ready for the day's tasks.

### List views
There are three main list views for managing the tasks: completed tasks, current tasks and upcoming tasks. All the list views are sorted top to bottom scrollable lists of the tasks. Each view has a different set of information and actions shown on the task to best support the purpose of the view.

On each list view there is a sticky footer which shows instructions on how to move between the list views using the `[` `]` keys (or `←` `→`) and the actions available per view. There is also a sticky header which shows the name of the list view: `Completed Tasks`, `Current Tasks` and `Upcoming Tasks`.

#### Current Tasks
The current task list presents the non completed (status is not `done`) tasks to be worked on today (`target-date` is today or earlier). The tasks are sorted by the status showing `in-progress` ones at the top and `todo` ones at the bottom. The data shown for each task on this view is geared towards getting the task done or moving it out of today for the day.

For each task the following fields are shown:
* Status (`todo` or `in-progress` on this view)
* Title (truncated to 1 line)
* Custom fields (truncated to 1 line, only the ones which have `visible-on-lists` as `true`)
* Description (truncated to 3 lines)
* Common action buttons:
    * +1 day (pushes target day by 1 day)

#### Upcoming Tasks
The upcoming tasks view shows all the tasks (status is not `done`) which are coming in the upcoming days (`target-date` greater than today). The tasks are sorted by the `target-date` having the earliest `target-date` at the top. The goal of the view is to provide an overview of the upcoming tasks and easily allow for picking tasks for the current day if needed. 

For each task the following fields are shown:
* Status (`todo` or `in-progress` on this view)
* Title (truncated to 1 line)
* Custom fields (truncated to 1 line, only the ones which have `visible-on-lists` as `true`)
* Description (truncated to 3 lines)
* Common action buttons:
    * Pull to today (moves the tasks `target-date` to today moving it to the current tasks view)

#### Completed Tasks
The completed tasks view shows all the completed tasks (status is `done`) sorted by their `completion-date` having the most recently completed task (latest `completion-date`) at the top. The completed task list allows for viewing completed tasks and reopening them if needed.

For each task the following fields are shown:
* Status (only `done` on this view)
* Title (truncated to 1 line)
* Custom fields (truncated to 1 line, only the ones which have `visible-on-lists` as `true`)
* Description (truncated to 3 lines)
* Common action buttons:
    * Reopen (Marks the status of the task as `in-progress`, unsets the `completion-date` and sets the `target-date` to today)

### Task Details View
The task details view can be entered into from any view. This same view can be used for also editing the task.

The following information is displayed:
* Status (editable)
* Completion date (only present if status is `done`, only editable if status is `done`)
* Target Date (editable)
* Title (not truncated, editable)
* All custom fields (not truncated, editable)
* Subtasks (only if any; status and title of each, with a button to jump to it)
* Description (not truncated, editable)
* Comments (existing tasks only; editable, removable, plus an empty box for a new one)
* Id (short form, not editable, button to copy the full id)
* Parent id (editable, optional; button to jump to the parent task, leaving unsaved edits behind)
* Created timestamp (not editable)
* Updated at timestamp (not editable)

#### Subtasks
A task can be made a subtask of another by filling in the parent task's id in the `Parent` field. The
parent's title is shown on the field once saved. The parent's details view lists its subtasks above the
description.

#### Comments
Comments are text notes for tracking progress on a task, shown oldest first below the description. Each
shows when it was created and, if changed, when it was last edited. Adding, editing and removing comments
is saved together with the rest of the task.

#### Custom Fields
It is possible to add custom fields to the tasks for having more structure than just title and description. A `type` of a custom field defines which properties and options there are available for the field in addition to its `value`. There are following types available in the app for custom fields:

* `text`: A free text field. Has a button to copy to clipboard on task details and list views and the following options:
    * `name: string`: Name of the field. Can not be empty.
    * `editable: boolean`: Specifies if the field can be modified after task creation. Default `true`.
    * `visible-on-lists: boolean`: Specifies if field is shown on the list views (truncated if needed). Default `false`.
    * `textbox: boolean`: Specifies if is multiline textbox or a single line. Default `true` indicating a textbox.
* `link`: A single line text presenting a link. Has buttons to open the link in default browser and copy to clipboard on task details and list views. Has the following options:
    * `name: string`: Name of the field. Can not be empty.
    * `editable: boolean`: Specifies if the field can be modified after task creation. Default `true`.
    * `visible-on-lists: boolean`: Specifies if field is shown on the list views (truncated if needed). Default `false`.
* `date`: A date field which provides format `yyyy-mm-dd`. Has a button to copy to clipboard on task details and list views and the following options:
    * `name: string`: Name of the field. Can not be empty.
    * `editable: boolean`: Specifies if the field can be modified after task creation. Default `true`.
    * `visible-on-lists: boolean`: Specifies if field is shown on the list views (truncated if needed). Default `false`.
* `timestamp`: A timestamp field which provides ISO format. Has a button to copy to clipboard on task details and list views and the following options:
    * `name: string`: Name of the field. Can not be empty.
    * `editable: boolean`: Specifies if the field can be modified after task creation. Default `true`.
    * `visible-on-lists: boolean`: Specifies if field is shown on the list views (truncated if needed). Default `false`.

### Templates
The todos TUI has a concept of templates to make creation of similar tasks easier. Template has most of the same fields as a task with the exception of `status`, `target-date` and `completion-date` as these fields don't make sense on a template. Templates can also have custom fields.

When creating a task there is an option to choose a template from a dropdown and when selected the template will override the values of the task being created with the templates non null values (meaning values which are empty in the template do not override tasks values). Template can only be used when creating a new task not when editing an existing task. An existing task does not have a link to the template which was used for creating it. Templates are just used as a starting point for task creation.

The app allows for entering a list of template and provides the basic CRUD operations. The template list can not be accessed from using the arrow keys as sepcified on the header but instead there is a separate key command to enter the template list where the template details view can be opened and the template can be edited.
