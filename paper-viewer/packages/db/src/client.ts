const dbNotReadyMessage =
  "Prisma client is not generated yet. Task 3 will replace packages/db/src/client.ts with the real Prisma singleton.";

export function createUnavailablePrismaClient() {
  const fail = () => {
    throw new Error(dbNotReadyMessage);
  };

  return new Proxy({}, {
    get() {
      fail();
    },
    set() {
      fail();
      return false;
    },
  }) as never;
}

export const prisma = createUnavailablePrismaClient();
