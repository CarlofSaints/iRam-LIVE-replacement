import type { CAM } from "./types";
import { readJson, writeJson } from "./blob";
import { v4 as uuid } from "uuid";

const KEY = "cams.json";

export async function getCams(): Promise<CAM[]> {
  return readJson<CAM[]>(KEY, []);
}

export async function getCamById(id: string): Promise<CAM | null> {
  const cams = await getCams();
  return cams.find((c) => c.id === id) ?? null;
}

export async function createCam(data: {
  name: string;
  surname: string;
  email: string;
  cell: string;
}): Promise<CAM> {
  const cams = await getCams();
  const cam: CAM = {
    id: uuid(),
    name: data.name.trim(),
    surname: data.surname.trim(),
    email: data.email.trim().toLowerCase(),
    cell: data.cell.trim(),
    active: true,
    createdAt: new Date().toISOString(),
  };
  cams.push(cam);
  await writeJson(KEY, cams);
  return cam;
}

export async function updateCam(
  id: string,
  updates: Partial<Pick<CAM, "name" | "surname" | "email" | "cell" | "active">>
): Promise<CAM> {
  const cams = await getCams();
  const idx = cams.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("CAM not found");
  cams[idx] = { ...cams[idx], ...updates };
  await writeJson(KEY, cams);
  return cams[idx];
}

export async function deleteCam(id: string): Promise<void> {
  const cams = await getCams();
  const filtered = cams.filter((c) => c.id !== id);
  await writeJson(KEY, filtered);
}
