export const taskStatusLabels: Record<string, string> = {
  accepted: 'Принята',
  in_progress: 'В работе',
  in_review: 'На проверке',
  new: 'Новая',
  rework: 'На доработке',
}

export function getTaskStatusLabel(status: string) {
  return taskStatusLabels[status] ?? status
}
