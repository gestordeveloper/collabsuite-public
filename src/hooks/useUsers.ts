import { useEffect, useState } from "react";
import type { User } from "../types";
import { fetchUsers } from "../services/user.service";

export function useUsers() {
  const [users, setUsers] = useState<Partial<User>[]>([]);

  useEffect(() => {
    fetchUsers().then(setUsers).catch(console.error);
  }, []);

  return users;
}