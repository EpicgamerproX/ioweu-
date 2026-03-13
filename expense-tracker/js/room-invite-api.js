import { APP_CONFIG } from "./config.js";

export function normalizeInviteData(group) {
  if (!group) {
    return null;
  }

  const roomId = group.roomId || group.room_key || "";
  const inviteUrl = group.inviteUrl || buildInviteUrl(roomId);

  if (!roomId || !inviteUrl) {
    return null;
  }

  return {
    groupId: group.id,
    roomName: group.name,
    roomId,
    inviteUrl
  };
}

export function buildInviteUrl(roomId) {
  if (!roomId) {
    return "";
  }

  return `${APP_CONFIG.appBaseUrl.replace(/\/$/, "")}/join/${encodeURIComponent(roomId)}`;
}

export function getJoinRouteRoomId(pathname = window.location.pathname) {
  const match = pathname.match(/\/join\/([^/]+)\/?$/);
  if (!match) {
    return "";
  }

  return decodeURIComponent(match[1] || "").trim().toUpperCase();
}

export function clearJoinRoute() {
  const nextUrl = window.location.pathname.includes("/join/")
    ? window.location.pathname.replace(/\/join\/[^/]+\/?$/, "/")
    : window.location.pathname;

  window.history.replaceState({}, "", nextUrl);
}
