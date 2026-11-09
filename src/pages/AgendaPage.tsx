import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDashboard } from "@/src/context/dashboard.context";
import { AgendaView } from "@/src/components/agenda/AgendaView";

export function AgendaPage() {
  const { tasks, openNewTask } = useDashboard();
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());

  return (
    <AgendaView
      tasks={tasks}
      currentDate={currentDate}
      setCurrentDate={setCurrentDate}
      onNewTask={() => openNewTask()}
      onTaskClick={(t) => navigate(t.template === "instagram_post" || t.template === "social_post" ? `/instagram?task=${t.id}` : `/task/${t.id}`)}
    />
  );
}