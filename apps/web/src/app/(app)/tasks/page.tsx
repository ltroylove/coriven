import { getTasks } from '@/app/actions/tasks'
import { TasksClient } from './tasks-client'
import type { Task } from '@personal-assistant/types'

export default async function TasksPage() {
  const tasks = await getTasks() as Task[]
  return <TasksClient initialTasks={tasks} />
}
