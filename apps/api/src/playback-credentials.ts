export type PlaybackCredentials = {
  username: string;
  password: string;
};

export function samePlaybackCredentials(
  left: PlaybackCredentials | null | undefined,
  right: PlaybackCredentials | null | undefined
) {
  if (!left || !right) {
    return false;
  }

  return left.username === right.username && left.password === right.password;
}

export function shouldHonorSharedLive404Cooldown(
  primaryCredentials: PlaybackCredentials | null | undefined,
  fallbackCredentials: PlaybackCredentials | null | undefined
) {
  if (!primaryCredentials) {
    return true;
  }

  if (!fallbackCredentials) {
    return true;
  }

  return samePlaybackCredentials(primaryCredentials, fallbackCredentials);
}
