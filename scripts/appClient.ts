/* Shared helpers for the local admin scripts — logs in to the deployed app and
   reads the upload index. Credentials come from the environment so nothing is
   ever written to disk:

     $env:IRAM_EMAIL="you@iram.co.za"; $env:IRAM_PASSWORD="…"
*/

export const DEFAULT_APP = "https://i-ram-live-replacement.vercel.app";

export interface Upload {
  id: string;
  clientId: string; clientName: string;
  channelId: string; channelName: string;
  vendorNumber: string; fileName: string;
  uploadDate: string; uploadedByName: string;
  fileType: string; status: string;
  rowCount?: number;
  dateColumns?: string[];
  reportYear?: number; reportMonth?: number; reportWeek?: number;
}

export function appUrl(override?: string): string {
  return (override ?? process.env.IRAM_APP_URL ?? DEFAULT_APP).replace(/\/$/, "");
}

export async function login(app: string): Promise<string> {
  const email = process.env.IRAM_EMAIL, password = process.env.IRAM_PASSWORD;
  if (!email || !password) {
    console.error(
      "Set IRAM_EMAIL and IRAM_PASSWORD first, e.g.\n" +
        '  $env:IRAM_EMAIL="you@iram.co.za"; $env:IRAM_PASSWORD="…"',
    );
    process.exit(1);
  }
  const res = await fetch(`${app}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    console.error(`Login failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const cookie = res.headers.get("set-cookie");
  if (!cookie) {
    console.error("Login succeeded but returned no session cookie.");
    process.exit(1);
  }
  return cookie.split(";")[0];
}

/** Every DISPO load the app has recorded (the index holds successes only). */
export async function getDispoUploads(app: string, cookie: string): Promise<Upload[]> {
  const res = await fetch(`${app}/api/uploads`, { headers: { cookie } });
  if (!res.ok) {
    console.error(`Could not read uploads (${res.status}).`);
    process.exit(1);
  }
  const raw = await res.json();
  const all = (Array.isArray(raw) ? raw : Object.values(raw)) as Upload[];
  return all.filter((u) => u.fileType === "dispo" && u.status === "processed");
}
