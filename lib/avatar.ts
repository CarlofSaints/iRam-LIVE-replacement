// Client-safe: no server imports. Read by Sidebar and the account page.

export const AVATAR_ROUTE = "/api/account/avatar";

/** Where the browser loads the signed-in user's picture from.
 *  Avatars are served by a logged-in route because a private Blob store's URLs
 *  cannot be put in an <img>. Pictures saved before that change stored a raw
 *  Blob URL; send those through the route too, so they keep working after the
 *  move to a private store. */
export function avatarSrc(profilePicUrl: string | undefined | null): string | null {
  if (!profilePicUrl) return null;
  if (profilePicUrl.includes(".blob.vercel-storage.com")) return AVATAR_ROUTE;
  return profilePicUrl;
}
