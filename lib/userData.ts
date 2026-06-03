import type { User } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";
import bcrypt from "bcryptjs";

const USERS_KEY = "users.json";

export async function getUsers(): Promise<User[]> {
  return readJson<User[]>(USERS_KEY, []);
}

export async function getUserById(userId: string): Promise<User | null> {
  const users = await getUsers();
  return users.find((u) => u.id === userId) ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const users = await getUsers();
  return (
    users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null
  );
}

export async function createUser(data: {
  name: string;
  email: string;
  password: string;
  role: User["role"];
  forcePasswordChange: boolean;
}): Promise<User> {
  const users = await getUsers();
  if (users.some((u) => u.email.toLowerCase() === data.email.toLowerCase())) {
    throw new Error(`User with email "${data.email}" already exists`);
  }
  const hash = await bcrypt.hash(data.password, 10);
  const user: User = {
    id: uuid(),
    name: data.name,
    email: data.email.toLowerCase(),
    password: hash,
    role: data.role,
    forcePasswordChange: data.forcePasswordChange,
    active: true,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await writeJson(USERS_KEY, users);
  return user;
}

export async function updateUser(
  userId: string,
  updates: Partial<
    Pick<
      User,
      | "name"
      | "email"
      | "role"
      | "active"
      | "forcePasswordChange"
      | "lastLoginAt"
    >
  >
): Promise<User> {
  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");
  users[idx] = { ...users[idx], ...updates };
  await writeJson(USERS_KEY, users);
  return users[idx];
}

export async function setUserPassword(
  userId: string,
  newPassword: string
): Promise<void> {
  const users = await getUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) throw new Error("User not found");
  users[idx].password = await bcrypt.hash(newPassword, 10);
  users[idx].forcePasswordChange = false;
  await writeJson(USERS_KEY, users);
}

export async function deleteUser(userId: string): Promise<void> {
  const users = await getUsers();
  const filtered = users.filter((u) => u.id !== userId);
  await writeJson(USERS_KEY, filtered);
}

export async function verifyPassword(
  user: User,
  plainPassword: string
): Promise<boolean> {
  return bcrypt.compare(plainPassword, user.password);
}
