export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(instant: Date | string): Clock {
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  return { now: () => new Date(value.getTime()) };
}

export function advancingClock(start: Date | string, stepMs = 1000): Clock {
  let current = (typeof start === 'string' ? new Date(start) : start).getTime();
  return {
    now: () => {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
  };
}
