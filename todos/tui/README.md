# TODOS TUI

## USAGE
The main views of the TUI are the list views presented below. When the TUI is opened it opens the current tasks list view to have the user ready for the days tasks.

### List views
There are three main list views for managing the tasks: completed tasks, current tasks and upcoming tasks. All the list views are sorted top to bottom scrollable lists of the tasks. Each view has a different set of information and actions shown on the task to best support the purpose of the view.

On each list view there is a sticking footer which shows instructions how to move between the lists by using `[]` keys to move `<->` to move between the list views and actions available per view. There is also a sticking header which shows the name of the list view: `Completed Tasks`, `Current Tasks` and `Upcoming Tasks`.

#### Current Tasks
The current task list presents the non completed (status is not `done`) tasks to be worked on today (`target-date` is today or earlier). The tasks are sorted by the status showing `in-progress` ones at the top and `todo` ones at the bottom. The data shown for each task on this view is geared towards getting the task done or moving it out of today for the day.

For each task the following fields are shown:
* Status (`todo` or `in-progress` on this view)
* Title (truncated to 1 line)
* Description (truncated to 3 lines)
* Common action buttons:
    * +1 day (pushes target day by 1 day)

#### Upcoming Tasks
The upcoming tasks view shows all the tasks (status is not `done`) which are coming in the upcoming days (`target-date` greater than today). The tasks are sorted by the `target-date` having the earliest `target-date` at the top. The goal of the view is to provide an overview of the upcoming tasks and easily allow for picking tasks for the current day if needed. 

For each task the following fields are shown:
* Status (`todo` or `in-progress` on this view)
* Title (truncated to 1 line)
* Description (truncated to 3 lines)
* Common action buttons:
    * Pull to today (moves the tasks `target-date` to today moving it to the current tasks view)

#### Completed Tasks
The completed tasks view shows all the completed tasks (status is `done`) sorted by their `completion-date` having the eaerliest `completion-date` at the top. The completed task list allows for viewing completed tasks and repopening them if needed.

For each task the following fields are shown:
* Status (only `done` on this view)
* Title (truncated to 1 line)
* Description (truncated to 3 lines)
* Common action buttons:
    * Reopen (Marks the status of the task as `in-progress`, unsets the `completion-date` and sets the `target-date` to today)

### Task Details View
The task details view can be entered into from any view. This same view can be used for also editing the task.

The following information is displayd:
* Status (editable)
* Completion date (only present if status is `done`, only editable if status is `done`)
* Target Date (editable)
* Title (not truncated, editable)
* Description (not truncated, editable)