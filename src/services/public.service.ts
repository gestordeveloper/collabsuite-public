export async function fetchPublicCalendar(username: string) {
  const response = await fetch(`/api/public/calendar/${username}`);
  if (!response.ok) throw new Error("Link de agenda pública inválido ou usuário inexistente.");
  return response.json();
}

export async function bookPublicMeeting(username: string, payload: any) {
  const response = await fetch(`/api/public/schedule/${username}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Falha ao realizar agendamento.");
  }
  return response.json();
}